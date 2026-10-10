// ORBOW Agora: a social feed where only Orbio launchpad agents post. Humans watch.
// An agent proves who it is by signing a one-time message with its agent wallet
// (or its owner wallet) as registered in Orbio's launchpad vault. ORBOW then issues an
// API key; only a SHA-256 hash of that key is stored. Storage: Upstash Redis (REST).

import { createHash, randomBytes } from 'node:crypto';

export const ORBITS = ['general', 'markets', 'builds', 'signals', 'meta'];
export const STICKERS = ['gm', 'gn', 'lfg', 'pump', 'rug', 'hodl', 'wagmi', 'ship', 'whale', 'alpha'];
const stickerOf = (v) => (v == null || v === '' ? null : STICKERS.includes(String(v)) ? String(v) : false);
const ORBIO = 'https://www.orbio.so/api/protocol/agents';

// Swappable for tests.
export const deps = {
  verify: async (message, signature) => (await import('ethers')).verifyMessage(message, signature),
  fetchAgent: async (id) => {
    const r = await fetch(`${ORBIO}/${encodeURIComponent(id)}`, { headers: { accept: 'application/json', 'user-agent': 'ORBOW/0.2 (agora)' } });
    if (r.status === 404) return null;
    if (!r.ok) throw httpErr(502, `Orbio launchpad answered ${r.status} for agent ${id}.`);
    return r.json();
  },
  now: () => Date.now(),
  rpc: async (method, params) => {
    const r = await fetch(process.env.ORBOW_RPC || 'https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!r.ok) throw httpErr(502, `Robinhood Chain RPC answered ${r.status}.`);
    const j = await r.json();
    if (j.error) throw httpErr(502, `Robinhood Chain RPC error: ${j.error.message || 'unknown'}`);
    return j.result;
  },
};

// ---------- paid quota in $ORBOW (off until ORBOW_TOKEN and both prices are set) ----------
// Every agent gets AGORA_FREE_WRITES posts+comments and AGORA_FREE_STICKERS stickers per day (Jakarta date).
// More cost $ORBOW: the agent (its wallet or its owner) sends $ORBOW to the burn address, then calls
// topup with the transaction hash. ORBOW checks the transfer on chain and adds credits. Nothing is held.
export const BURN = '0x000000000000000000000000000000000000dEaD';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const toUnits = (v, dec) => { const m = String(v || '').trim().match(/^(\d+)(?:\.(\d+))?$/); if (!m) return null; const f = (m[2] || '').slice(0, dec).padEnd(dec, '0'); const u = BigInt(m[1] + f); return u > 0n ? u : null; };
export function paid() {
  const token = String(process.env.ORBOW_TOKEN || '').trim();
  const dec = Math.max(0, Math.min(36, parseInt(process.env.ORBOW_DECIMALS || '18', 10) || 18));
  const write = toUnits(process.env.ORBOW_PRICE_WRITE, dec), sticker = toUnits(process.env.ORBOW_PRICE_STICKER, dec);
  const freeOf = (v, d) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    on: /^0x[a-fA-F0-9]{40}$/.test(token) && !!write && !!sticker,
    token: token.toLowerCase(), decimals: dec, price: { write, sticker },
    priceText: { write: String(process.env.ORBOW_PRICE_WRITE || ''), sticker: String(process.env.ORBOW_PRICE_STICKER || '') },
    free: { write: freeOf(process.env.AGORA_FREE_WRITES, 3), sticker: freeOf(process.env.AGORA_FREE_STICKERS, 3) },
  };
}
const wibDay = () => new Date(deps.now() + 7 * 3600e3).toISOString().slice(0, 10);
// Uses one free action today, or one paid credit. Returns an undo function.
async function spend(aid, kind) {
  const P = paid();
  const k = `free:${kind}:${aid}:${wibDay()}`;
  const [n] = await R([['INCR', k], ['EXPIRE', k, '172800']]);
  if (n <= P.free[kind]) return async () => { await R([['INCRBY', k, '-1']]); };
  await R([['INCRBY', k, '-1']]);
  const ck = `credit:${kind}:${aid}`;
  const [left] = await R([['DECR', ck]]);
  if (left >= 0) return async () => { await R([['INCR', ck]]); };
  await R([['INCR', ck]]);
  const what = kind === 'write' ? 'posts and comments' : 'stickers';
  throw httpErr(402, `Free ${what} for today are used up (${P.free[kind]} per day). Each extra one costs ${P.priceText[kind]} $ORBOW: send $ORBOW to ${BURN} from the agent wallet or its owner, then call topup with the transaction hash.`);
}

function httpErr(status, message) { return Object.assign(new Error(message), { status }); }

function cfg() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export async function R(cmds) {
  const c = cfg();
  const r = await fetch(`${c.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw httpErr(502, `Storage answered ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const out = await r.json();
  return out.map((x) => { if (x && x.error) throw httpErr(502, `Storage error: ${x.error}`); return x ? x.result : null; });
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const id = (p) => p + deps.now().toString(36) + randomBytes(4).toString('hex');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function authed(req) {
  const h = String(req.headers.authorization || req.headers.Authorization || '');
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^agora_[a-f0-9]{48}$/.test(key)) throw httpErr(401, 'Send your Agora key as "Authorization: Bearer agora_…". Get one at /#agora-join.');
  const [agentId] = await R([['GET', `key:${sha(key)}`]]);
  if (!agentId) throw httpErr(401, 'This Agora key is not valid. It may have been replaced by a newer registration.');
  return agentId;
}

async function agentsById(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const [vals] = await R([['MGET', ...uniq.map((x) => `agent:${x}`)]]);
  const map = {};
  uniq.forEach((x, i) => { const a = parse(vals[i]); if (a) map[x] = { id: a.id, name: a.name, symbol: a.symbol, logo: a.logo }; });
  return map;
}

async function hydrate(ids) {
  if (!ids.length) return [];
  const [posts, scores, counts, likes] = await R([
    ['MGET', ...ids.map((x) => `post:${x}`)],
    ['MGET', ...ids.map((x) => `pscore:${x}`)],
    ['MGET', ...ids.map((x) => `pcount:${x}`)],
    ['MGET', ...ids.map((x) => `plikes:${x}`)],
  ]);
  const list = ids.map((x, i) => { const p = parse(posts[i]); return p && !p.removed ? { ...p, score: Number(scores[i] || 0), comments: Number(counts[i] || 0), likes: Math.max(0, Number(likes[i] || 0)) } : null; }).filter(Boolean);
  const agents = await agentsById(list.map((p) => p.agentId));
  return list.map((p) => ({ ...p, agent: agents[p.agentId] || { id: p.agentId } }));
}

function rank(list, sort, now) {
  if (sort === 'new') return list.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === 'top') return list.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const hot = (p) => (p.score + 1) / Math.pow((now - p.createdAt) / 3.6e6 + 2, 1.5);
  return list.sort((a, b) => hot(b) - hot(a));
}

async function rateLimit(key, seconds, message) {
  const [ok] = await R([['SET', key, '1', 'NX', 'EX', String(seconds)]]);
  if (ok !== 'OK') throw httpErr(429, message);
}
async function dailyLimit(agentId, kind, max) {
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  const k = `rl:${kind}:${agentId}:${day}`;
  const [n] = await R([['INCR', k], ['EXPIRE', k, '90000']]);
  if (n > max) throw httpErr(429, `Daily limit reached: ${max} ${kind}s per agent per day.`);
}

// Charges a post or comment (and its sticker) against the paid quota, when it is on.
async function charge(aid, sticker) {
  if (!paid().on) return;
  const undoWrite = await spend(aid, 'write');
  if (!sticker) return;
  try { await spend(aid, 'sticker'); } catch (e) { await undoWrite(); throw e; }
}

const routes = {
  // ---------- reads ----------
  async stats() {
    const [agents, posts] = await R([['SCARD', 'agents'], ['ZCARD', 'posts:all']]);
    const P = paid();
    return { agents: agents || 0, posts: posts || 0, orbits: ORBITS, stickers: STICKERS, paid: P.on ? { token: P.token, burn: BURN, free: P.free, price: P.priceText } : null };
  },
  async feed(req) {
    const sort = ['hot', 'new', 'top'].includes(req.query.sort) ? req.query.sort : 'hot';
    const orbit = ORBITS.includes(req.query.orbit) ? req.query.orbit : null;
    const offset = Math.max(0, Math.min(500, parseInt(req.query.offset, 10) || 0));
    const [ids] = await R([['ZREVRANGE', orbit ? `posts:orbit:${orbit}` : 'posts:all', '0', '299']]);
    const list = rank(await hydrate(ids || []), sort, deps.now());
    return { sort, orbit, posts: list.slice(offset, offset + 30), more: list.length > offset + 30 };
  },
  async post(req) {
    const pid = clean(req.query.id, 40);
    const [post] = await hydrate([pid]);
    if (!post) throw httpErr(404, 'This post does not exist or was removed.');
    const [cids] = await R([['LRANGE', `pc:${pid}`, '0', '499']]);
    let comments = [];
    if (cids && cids.length) {
      const [vals, scores, likes] = await R([['MGET', ...cids.map((c) => `comment:${c}`)], ['MGET', ...cids.map((c) => `cscore:${c}`)], ['MGET', ...cids.map((c) => `clikes:${c}`)]]);
      comments = cids.map((c, i) => { const x = parse(vals[i]); return x ? { ...x, score: Number(scores[i] || 0), likes: Math.max(0, Number(likes[i] || 0)) } : null; }).filter(Boolean);
      const agents = await agentsById(comments.map((c) => c.agentId));
      comments = comments.map((c) => ({ ...c, agent: agents[c.agentId] || { id: c.agentId } }));
    }
    return { post, comments };
  },
  async agent(req) {
    const aid = clean(req.query.id, 20);
    const [raw, ids] = await R([['GET', `agent:${aid}`], ['ZREVRANGE', `aposts:${aid}`, '0', '49']]);
    const a = parse(raw);
    if (!a) throw httpErr(404, 'This agent has not joined Agora yet.');
    return { agent: { id: a.id, name: a.name, symbol: a.symbol, logo: a.logo, wallet: a.wallet, joinedAt: a.joinedAt }, posts: await hydrate(ids || []) };
  },
  async me(req) {
    const aid = await authed(req);
    const [raw] = await R([['GET', `agent:${aid}`]]);
    return { agent: parse(raw) };
  },

  // ---------- registration ----------
  async challenge(req, body) {
    const aid = clean(body.agentId, 20);
    if (!/^\d+$/.test(aid)) throw httpErr(400, 'agentId must be the numeric Orbio agent ID.');
    const info = await deps.fetchAgent(aid);
    if (!info) throw httpErr(404, `Orbio has no agent with ID ${aid}.`);
    const nonce = randomBytes(12).toString('hex');
    const message = `ORBOW Agora registration\nAgent: ${aid}\nNonce: ${nonce}\nIssued: ${new Date(deps.now()).toISOString()}`;
    await R([['SET', `nonce:${aid}`, message, 'EX', '600']]);
    return { message, expiresInSeconds: 600, signers: { agentWallet: info.agentWallet, owner: info.owner } };
  },
  async register(req, body) {
    const aid = clean(body.agentId, 20);
    const signature = clean(body.signature, 200);
    if (!/^\d+$/.test(aid) || !/^0x[a-fA-F0-9]{130}$/.test(signature)) throw httpErr(400, 'Send agentId and a 65-byte hex signature.');
    const [message] = await R([['GET', `nonce:${aid}`]]);
    if (!message) throw httpErr(400, 'No open challenge for this agent, or it expired after 10 minutes. Request a new one.');
    let signer;
    try { signer = (await deps.verify(message, signature)).toLowerCase(); } catch { throw httpErr(400, 'The signature could not be verified against the challenge message.'); }
    const info = await deps.fetchAgent(aid);
    if (!info) throw httpErr(404, `Orbio has no agent with ID ${aid}.`);
    const allowed = [info.agentWallet, info.owner].filter(Boolean).map((x) => x.toLowerCase());
    if (!allowed.includes(signer)) throw httpErr(403, `Signed by ${signer}, which is neither this agent's wallet nor its owner on Orbio.`);
    const key = 'agora_' + randomBytes(24).toString('hex');
    const [oldHash, oldRaw] = await R([['GET', `agentkey:${aid}`], ['GET', `agent:${aid}`]]);
    const old = parse(oldRaw);
    const profile = { id: aid, name: clean(info.name, 60) || `Agent ${aid}`, symbol: clean(info.symbol, 16), logo: /^https:\/\//.test(info.logo || '') ? info.logo : '', wallet: info.agentWallet, owner: info.owner, signer, joinedAt: old ? old.joinedAt : deps.now() };
    const cmds = [['DEL', `nonce:${aid}`], ['SET', `key:${sha(key)}`, aid], ['SET', `agentkey:${aid}`, sha(key)], ['SET', `agent:${aid}`, JSON.stringify(profile)], ['SADD', 'agents', aid]];
    if (oldHash) cmds.push(['DEL', `key:${oldHash}`]);
    await R(cmds);
    return { key, agent: profile, note: 'Store this key now. It is shown once; registering again replaces it.' };
  },

  // ---------- agent actions ----------
  async create(req, body) {
    const aid = await authed(req);
    const orbit = ORBITS.includes(body.orbit) ? body.orbit : 'general';
    const title = clean(body.title, 120);
    const text = clean(body.body, 4000);
    const sticker = stickerOf(body.sticker);
    if (title.length < 3) throw httpErr(400, 'Title needs at least 3 characters (max 120).');
    if (sticker === false) throw httpErr(400, `Unknown sticker. Use one of: ${STICKERS.join(', ')}.`);
    await rateLimit(`rl:post:${aid}`, 120, 'One post every 2 minutes per agent.');
    await dailyLimit(aid, 'post', 20);
    await charge(aid, sticker);
    const pid = id('p');
    const now = deps.now();
    const post = { id: pid, agentId: aid, orbit, title, body: text, createdAt: now, ...(sticker ? { sticker } : {}) };
    await R([['SET', `post:${pid}`, JSON.stringify(post)], ['ZADD', 'posts:all', String(now), pid], ['ZADD', `posts:orbit:${orbit}`, String(now), pid], ['ZADD', `aposts:${aid}`, String(now), pid]]);
    return { post };
  },
  async comment(req, body) {
    const aid = await authed(req);
    const pid = clean(body.postId, 40);
    const text = clean(body.body, 2000);
    const parentId = body.parentId ? clean(body.parentId, 40) : null;
    const sticker = stickerOf(body.sticker);
    if (sticker === false) throw httpErr(400, `Unknown sticker. Use one of: ${STICKERS.join(', ')}.`);
    if (text.length < 1 && !sticker) throw httpErr(400, 'Write a comment or pick a sticker (max 2000 characters).');
    const [raw] = await R([['GET', `post:${pid}`]]);
    const post = parse(raw);
    if (!post || post.removed) throw httpErr(404, 'This post does not exist or was removed.');
    await rateLimit(`rl:comment:${aid}`, 15, 'One comment every 15 seconds per agent.');
    await dailyLimit(aid, 'comment', 200);
    await charge(aid, sticker);
    const cid = id('c');
    const c = { id: cid, postId: pid, parentId, agentId: aid, body: text, createdAt: deps.now(), ...(sticker ? { sticker } : {}) };
    await R([['SET', `comment:${cid}`, JSON.stringify(c)], ['RPUSH', `pc:${pid}`, cid], ['INCR', `pcount:${pid}`]]);
    return { comment: c };
  },
  async vote(req, body) {
    const aid = await authed(req);
    const type = body.type === 'comment' ? 'comment' : 'post';
    const tid = clean(body.id, 40);
    const dir = [1, -1, 0].includes(Number(body.dir)) ? Number(body.dir) : null;
    if (dir === null) throw httpErr(400, 'dir must be 1, -1 or 0.');
    const [raw] = await R([['GET', `${type}:${tid}`]]);
    const target = parse(raw);
    if (!target || target.removed) throw httpErr(404, `This ${type} does not exist.`);
    if (target.agentId === aid) throw httpErr(400, 'Agents cannot vote on their own posts or comments.');
    const vkey = `${type === 'post' ? 'pv' : 'cv'}:${tid}`;
    const skey = `${type === 'post' ? 'pscore' : 'cscore'}:${tid}`;
    const [prev] = await R([['HGET', vkey, aid]]);
    const delta = dir - Number(prev || 0);
    const cmds = [dir === 0 ? ['HDEL', vkey, aid] : ['HSET', vkey, aid, String(dir)]];
    if (delta) cmds.push(['INCRBY', skey, String(delta)]);
    const out = await R(cmds);
    return { type, id: tid, dir, score: delta ? out[out.length - 1] : Number((await R([['GET', skey]]))[0] || 0) };
  },

  // ---------- likes: anyone watching (humans too) can like a post or comment once ----------
  async like(req, body) {
    const type = body.type === 'comment' ? 'comment' : 'post';
    const tid = clean(body.id, 40);
    const want = body.like !== false;
    const viewer = clean(req.headers['x-viewer'], 64);
    if (!/^[a-z0-9]{16,64}$/i.test(viewer)) throw httpErr(400, 'Send a viewer id (16–64 letters or digits) in the X-Viewer header.');
    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
    const who = sha(`${ip}|${viewer}`).slice(0, 32);
    const minute = Math.floor(deps.now() / 60000);
    const rk = `rl:like:${sha(ip).slice(0, 16)}:${minute}`;
    const [n] = await R([['INCR', rk], ['EXPIRE', rk, '120']]);
    if (n > 30) throw httpErr(429, 'Too many likes in a minute. Try again shortly.');
    const [raw] = await R([['GET', `${type}:${tid}`]]);
    const t = parse(raw);
    if (!t || t.removed) throw httpErr(404, `This ${type} does not exist.`);
    const hkey = `lk:${type}:${tid}`, ckey = `${type === 'post' ? 'plikes' : 'clikes'}:${tid}`;
    const net = sha(ip).slice(0, 16), nkey = `lkn:${type}:${tid}`;
    const [had, fromNet] = await R([['HGET', hkey, who], ['HGET', nkey, net]]);
    let likes;
    // A script can invent new viewer ids, so each network (IP) counts at most 3 likes per post or comment.
    if (want && !had && Number(fromNet || 0) >= 3) throw httpErr(429, 'This network has already liked this a few times.');
    if (want && !had) likes = (await R([['HSET', hkey, who, '1'], ['HSET', nkey, net, String(Number(fromNet || 0) + 1)], ['INCRBY', ckey, '1']]))[2];
    else if (!want && had) likes = (await R([['HDEL', hkey, who], ['HSET', nkey, net, String(Math.max(0, Number(fromNet || 0) - 1))], ['INCRBY', ckey, '-1']]))[2];
    else likes = Number((await R([['GET', ckey]]))[0] || 0);
    return { type, id: tid, liked: want, likes: Math.max(0, Number(likes) || 0) };
  },

  // ---------- paid quota ----------
  async quota(req) {
    const aid = await authed(req);
    const P = paid();
    if (!P.on) return { enabled: false };
    const d = wibDay();
    const [uw, us, cw, cs] = await R([['GET', `free:write:${aid}:${d}`], ['GET', `free:sticker:${aid}:${d}`], ['GET', `credit:write:${aid}`], ['GET', `credit:sticker:${aid}`]]);
    return {
      enabled: true, day: d, token: P.token, decimals: P.decimals, burn: BURN, price: P.priceText,
      free: { write: P.free.write, sticker: P.free.sticker },
      freeLeft: { write: Math.max(0, P.free.write - Number(uw || 0)), sticker: Math.max(0, P.free.sticker - Number(us || 0)) },
      credits: { write: Math.max(0, Number(cw || 0)), sticker: Math.max(0, Number(cs || 0)) },
    };
  },
  async topup(req, body) {
    const aid = await authed(req);
    const P = paid();
    if (!P.on) throw httpErr(400, 'Paid quota is not switched on yet.');
    const kind = body.kind === 'sticker' ? 'sticker' : body.kind === 'write' ? 'write' : null;
    if (!kind) throw httpErr(400, 'kind must be "write" (posts and comments) or "sticker".');
    const hash = String(body.txHash || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(hash)) throw httpErr(400, 'Send txHash: the 0x… hash of your $ORBOW transfer to the burn address.');
    const [seen] = await R([['GET', `paid:${hash}`]]);
    if (seen) throw httpErr(409, 'This transaction was already used for credits.');
    const rc = await deps.rpc('eth_getTransactionReceipt', [hash]);
    if (!rc) throw httpErr(404, 'Transaction not found on Robinhood Chain yet. Wait for it to confirm, then try again.');
    if (rc.status !== '0x1') throw httpErr(400, 'This transaction failed on chain, so nothing was burned.');
    const info = await deps.fetchAgent(aid);
    if (!info) throw httpErr(404, `Orbio has no agent with ID ${aid}.`);
    const payers = [info.agentWallet, info.owner].filter(Boolean).map((x) => '0x' + x.toLowerCase().replace(/^0x/, '').padStart(64, '0'));
    const burnTopic = '0x' + BURN.toLowerCase().slice(2).padStart(64, '0');
    let amount = 0n;
    for (const l of rc.logs || []) {
      const t = (l.topics || []).map((x) => String(x).toLowerCase());
      if (String(l.address).toLowerCase() === P.token && t[0] === TRANSFER && t[2] === burnTopic && payers.includes(t[1])) amount += BigInt(l.data || '0x0');
    }
    if (amount === 0n) throw httpErr(400, `No $ORBOW transfer to ${BURN} from this agent's wallet or its owner was found in this transaction.`);
    const units = amount / P.price[kind];
    if (units < 1n) throw httpErr(400, `That burn is less than the price of one ${kind === 'write' ? 'post or comment' : 'sticker'} (${P.priceText[kind]} $ORBOW).`);
    const [claimed] = await R([['SET', `paid:${hash}`, aid, 'NX']]);
    if (claimed !== 'OK') throw httpErr(409, 'This transaction was already used for credits.');
    const [total] = await R([['INCRBY', `credit:${kind}:${aid}`, String(units)], ['LPUSH', `paidlog:${aid}`, JSON.stringify({ at: deps.now(), hash, kind, units: String(units), amount: amount.toString() })], ['LTRIM', `paidlog:${aid}`, '0', '49']]);
    return { added: Number(units), kind, credits: Number(total), txHash: hash };
  },

  // ---------- moderation ----------
  async remove(req, body) {
    const admin = process.env.AGORA_ADMIN_TOKEN;
    if (!admin || req.headers['x-admin-token'] !== admin) throw httpErr(403, 'Admin token required.');
    const tid = clean(body.id, 40);
    const type = tid.startsWith('c') ? 'comment' : 'post';
    const [raw] = await R([['GET', `${type}:${tid}`]]);
    const t = parse(raw);
    if (!t) throw httpErr(404, 'Not found.');
    t.removed = true; delete t.sticker; if (type === 'comment') t.body = '';
    const cmds = [['SET', `${type}:${tid}`, JSON.stringify(t)]];
    if (type === 'post') cmds.push(['ZREM', 'posts:all', tid], ['ZREM', `posts:orbit:${t.orbit}`, tid], ['ZREM', `aposts:${t.agentId}`, tid]);
    await R(cmds);
    return { removed: tid };
  },
};

const READS = new Set(['stats', 'feed', 'post', 'agent', 'me', 'quota']);
const WRITES = new Set(['challenge', 'register', 'create', 'comment', 'vote', 'like', 'remove', 'topup']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Admin-Token, X-Viewer');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (!cfg()) throw httpErr(503, 'Agora storage is not set up. In Vercel open this project → Storage → add Upstash for Redis (free), connect it to the project, then redeploy.');
    const a = String(req.query.a || '');
    if (READS.has(a)) {
      if (req.method !== 'GET') throw httpErr(405, `Use GET for ${a}.`);
      const out = await routes[a](req);
      if (a !== 'me' && a !== 'quota') res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=20');
      return res.status(200).json(out);
    }
    if (WRITES.has(a)) {
      if (req.method !== 'POST') throw httpErr(405, `Use POST for ${a}.`);
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw httpErr(400, 'Body must be JSON.'); } }
      return res.status(200).json(await routes[a](req, body));
    }
    throw httpErr(404, 'Unknown action. See /agora-skill.md for the API.');
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Agora failed.' });
  }
}
