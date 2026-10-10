// ORBOW Portfolio: which Orbio agent tokens a wallet holds, what they are worth,
// and how much each agent's owner has pulled out of its stake.
// Read-only. Balances come from the Robinhood Chain explorer (Blockscout), with Multicall3 and
// balanceOf batches on Robinhood Chain as fallbacks; agent data from
// Orbio's public launchpad API. Nothing is signed and no key is needed.

const ORBIO = 'https://www.orbio.so/api/protocol/agents';
const RPC = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const PAGE = 200;

let cache = { at: 0, agents: null, orbioMicroUsd: null };

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ORBOW/0.2 (portfolio)' } });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Orbio ${r.status}: ${text.slice(0, 160)}`), { status: 502 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Orbio returned non-JSON'), { status: 502 }); }
}

export async function allAgents() {
  if (cache.agents && Date.now() - cache.at < 120000) return cache;
  const first = await getJson(`${ORBIO}?limit=${PAGE}&offset=0&sort=cap`);
  const total = (first.page && first.page.total) || (first.data || []).length;
  const offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => getJson(`${ORBIO}?limit=${PAGE}&offset=${o}&sort=cap`)));
  const agents = [first, ...rest].flatMap((p) => p.data || []);
  cache = { at: Date.now(), agents, orbioMicroUsd: first.orbioMicroUsd || null };
  return cache;
}

const pad = (addr) => addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const EXPLORER = process.env.ROBINHOOD_EXPLORER_API || 'https://robinhoodchain.blockscout.com/api/v2';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// up to 3 tries on 429 / 5xx (waits 1 s, then 2 s), never past the deadline
async function retrying(fn, deadline, label) {
  let wait = 1000, last;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const retry = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!retry || i === 2 || Date.now() + wait > deadline) break;
      await sleep(wait); wait *= 2;
    }
  }
  throw Object.assign(new Error(`${label}: ${last && last.message}`), { status: last && last.status });
}

async function rpc(body) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`RPC ${r.status}: ${text.slice(0, 120)}`), { status: r.status });
  let j; try { j = JSON.parse(text); } catch { throw new Error('RPC returned non-JSON'); }
  // some RPCs return HTTP 200 with a 429 error inside
  const inner = Array.isArray(j) ? null : j.error;
  if (inner && (inner.code === 429 || /too many|rate limit/i.test(inner.message || ''))) throw Object.assign(new Error(`RPC 429: ${inner.message}`), { status: 429 });
  return j;
}

// 1) Explorer: every ERC-20 the wallet holds, in a few paged requests. Complete list, so absent = 0.
export async function fromExplorer(wallet, deadline) {
  const out = new Map();
  let params = '';
  for (let page = 0; page < 60; page++) {
    const url = `${EXPLORER}/addresses/${wallet}/tokens?type=ERC-20${params}`;
    const j = await retrying(async () => {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ORBOW/0.2 (portfolio)' } });
      const text = await r.text();
      if (r.status === 404) return { items: [], next_page_params: null }; // address never seen on chain
      if (!r.ok) throw Object.assign(new Error(`Explorer ${r.status}: ${text.slice(0, 120)}`), { status: r.status });
      return JSON.parse(text);
    }, deadline, 'explorer');
    for (const it of j.items || []) {
      const t = it.token || {};
      const addr = String(t.address_hash || t.address || '').toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(addr) && it.value != null) out.set(addr, '0x' + BigInt(String(it.value)).toString(16));
    }
    const next = j.next_page_params;
    if (!next) return out;
    params = '&' + new URLSearchParams(Object.entries(next).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  }
  throw new Error('explorer: too many pages');
}

// 2) Multicall3: up to 400 balanceOf calls per eth_call
export async function fromMulticall(wallet, tokens, deadline) {
  const { Interface } = await import('ethers');
  const mc = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
  const data = '0x70a08231' + pad(wallet);
  const out = new Map(); const errors = [];
  for (let i = 0; i < tokens.length; i += 400) {
    const chunk = tokens.slice(i, i + 400);
    const callData = mc.encodeFunctionData('aggregate3', [chunk.map((t) => [t, true, data])]);
    const res = await retrying(() => rpc({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MULTICALL3, data: callData }, 'latest'] }), deadline, 'multicall');
    if (res.error || !res.result || res.result === '0x') throw new Error(`multicall: ${(res.error && res.error.message) || 'no result (Multicall3 missing?)'}`);
    const [results] = mc.decodeFunctionResult('aggregate3', res.result);
    results.forEach((r, k) => {
      if (r.success && r.returnData && r.returnData.length >= 66) out.set(chunk[k].toLowerCase(), '0x' + r.returnData.slice(2, 66));
      else errors.push(`${chunk[k]}: balanceOf failed`);
    });
  }
  return { out, errors };
}

// 3) Plain JSON-RPC batches of 50, one after another, with backoff
export async function fromBatches(wallet, tokens, deadline) {
  const out = new Map(); const errors = [];
  const call = (token, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: token, data: '0x70a08231' + pad(wallet) }, 'latest'] });
  let failedInRow = 0;
  for (let i = 0; i < tokens.length; i += 50) {
    const chunk = tokens.slice(i, i + 50);
    if (Date.now() > deadline || failedInRow >= 2) { chunk.forEach((t) => errors.push(`${t}: ${failedInRow >= 2 ? 'skipped, RPC keeps refusing' : 'out of time'}`)); continue; }
    try {
      const res = await retrying(() => rpc(chunk.map((t, k) => call(t, k))), deadline, 'batch');
      if (!Array.isArray(res)) throw new Error((res.error && res.error.message) || 'batch not supported');
      for (const item of res) {
        const t = chunk[item.id];
        if (!t) continue;
        if (item.error) errors.push(`${t}: ${item.error.message || 'call failed'}`);
        else out.set(t.toLowerCase(), item.result);
      }
      failedInRow = 0;
    } catch (e) { failedInRow++; chunk.forEach((t) => errors.push(`${t}: ${e.message}`)); }
  }
  return { out, errors };
}

// Balances of every agent token. Tries explorer, then Multicall3, then RPC batches.
export async function balances(wallet, tokens, budgetMs = 50000) {
  const deadline = Date.now() + budgetMs;
  const tried = [];
  try {
    const held = await fromExplorer(wallet, deadline);
    const out = new Map(tokens.map((t) => [t.toLowerCase(), held.get(t.toLowerCase()) || '0x0']));
    return { out, errors: [], source: 'explorer', tried };
  } catch (e) { tried.push(e.message); }
  try {
    const r = await fromMulticall(wallet, tokens, deadline);
    return { ...r, source: 'multicall', tried };
  } catch (e) { tried.push(e.message); }
  const r = await fromBatches(wallet, tokens, deadline);
  return { ...r, errors: [...tried.map((m) => `fallback: ${m}`), ...r.errors], source: 'rpc', tried };
}

const n18 = (v) => (v == null ? null : Number(v) / 1e18);
const n6 = (v) => (v == null ? null : Number(v) / 1e6);

export function summarize(a) {
  const s = a.stake || {};
  const earned = n18(s.stakedWei);
  const withdrawn = n18(s.withdrawnWei) || 0;
  return {
    agentId: String(a.agentId), name: a.name || 'Unnamed agent', symbol: a.symbol || '', logo: a.logo || '', token: a.token,
    owner: a.owner || '', agentWallet: a.agentWallet || '', decimals: a.decimals ?? 18,
    priceUsd: n6(a.price && a.price.priceMicroUsd), marketCapUsd: n6(a.price && a.price.marketCapMicroUsd),
    earned, stillStaked: n18(s.orbioWei), withdrawn,
    exitPct: earned ? Math.min(100, (withdrawn / earned) * 100) : 0,
    gatewayUsd: n6(a.converted && a.converted.usdgAtoms),
    launchedAt: a.launchedAt ? Number(a.launchedAt) * 1000 : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const wallet = String(req.query.wallet || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'Enter a wallet address: 0x followed by 40 hex characters.' });
  try {
    const { agents, orbioMicroUsd } = await allAgents();
    const tokens = agents.map((a) => a.token).filter((t) => /^0x[a-fA-F0-9]{40}$/.test(t || ''));
    const { out, errors, source, tried } = await balances(wallet, tokens);
    const missing = tokens.filter((t) => !out.has(t.toLowerCase())).length;
    // More than 2% unread: a result would be misleading (it could look like an empty wallet), so fail clearly.
    if (missing > Math.max(2, tokens.length * 0.02)) {
      return res.status(502).json({
        error: `Could only read ${tokens.length - missing} of ${tokens.length} token balances from Robinhood Chain, so the portfolio would be incomplete. Try again in a minute.`,
        details: [...tried, ...errors.filter((e) => !e.startsWith('fallback:'))].slice(0, 10), rpc: RPC, explorer: EXPLORER,
      });
    }
    const w = wallet.toLowerCase();
    const holdings = [];
    const owned = [];
    for (const a of agents) {
      const s = summarize(a);
      const hex = out.get((a.token || '').toLowerCase());
      if (hex && hex !== '0x' && BigInt(hex) > 0n) {
        const balance = Number(BigInt(hex)) / 10 ** (s.decimals || 18);
        holdings.push({ ...s, balance, valueUsd: s.priceUsd != null ? balance * s.priceUsd : null });
      }
      if (s.owner.toLowerCase() === w || s.agentWallet.toLowerCase() === w) owned.push(s);
    }
    holdings.sort((x, y) => (y.valueUsd || 0) - (x.valueUsd || 0));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      wallet, scanned: tokens.length, holdings, owned,
      totalUsd: holdings.reduce((t, h) => t + (h.valueUsd || 0), 0),
      orbioUsd: n6(orbioMicroUsd), source, missing, errors: errors.slice(0, 20), errorCount: missing, updatedAt: Date.now(),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Portfolio failed.' });
  }
}
