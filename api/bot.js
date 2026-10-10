// ORBOW's own X account. Posts short notes about ORBOW's product and features through Orbio's gateway tool `social.post`,
// to the X account connected in the Orbio dashboard of the account that owns ORBIO_API_KEY.
//
// Safety:
// - Off until BOT_ENABLED=1 is set in Vercel. Nothing posts before that.
// - At most BOT_POSTS_PER_DAY posts per day in Jakarta time (default 4, never more than 4; 15 on launch days), counted in Upstash.
// - Posts are about ORBOW itself: its product and features. They never name or rank anyone's token.
//   They come from a fixed library, posted in order (pointer in Upstash), so no post repeats until all have gone out.
// - Schedule (Vercel Hobby crons run once a day each, so every hour below is its own daily cron):
//     launch days (Jakarta dates up to BOT_LAUNCH_UNTIL, default 2026-10-12): every hour from 00:00 to 14:00 WIB, 15 posts
//     after that: 08:00, 12:00, 16:00, 20:00 WIB
// - Each hour posts at most once a day.
// - Only Vercel Cron (Authorization: Bearer CRON_SECRET) or the admin (X-Admin-Token) can trigger a post.
// - Anyone can read the status: today's count, the limit and the last posts.

import { R } from './agora.js';

// Links in posts use the owner's own domain (SITE_URL). Posting is refused until it is set and is not a vercel.app address.
const siteUrl = () => String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
const siteOk = () => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(siteUrl()) && !/vercel\.app$/i.test(siteUrl());
const HARD_MAX = 4;

export const deps = {
  now: () => Date.now(),
  post: async (text) => {
    const r = await fetch('https://api.orbio.so/api/v1/tools/social.post', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ORBIO_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, platforms: ['twitter'], max_cost: '0.05' }),
    });
    const body = await r.text();
    if (!r.ok) throw Object.assign(new Error(`social.post answered ${r.status}: ${body.slice(0, 160)}`), { status: 502 });
    try { return JSON.parse(body); } catch { return { raw: body.slice(0, 200) }; }
  },
};

const day = () => wibDay();
const limit = () => (launchDays() ? LAUNCH_MAX : Math.max(0, Math.min(HARD_MAX, parseInt(process.env.BOT_POSTS_PER_DAY || '4', 10) || 0)));
// Jakarta date (UTC+7), so "today" matches the owner's day.
const wibDay = () => new Date(deps.now() + 7 * 3600e3).toISOString().slice(0, 10);
// Launch days (Jakarta 11 and 12 Oct): one post an hour from 00:00 to 14:00 WIB, 15 posts.
const LAUNCH_HOURS = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7]; // UTC = 00:00 ... 14:00 WIB
const LAUNCH_TYPES = Array(15).fill('learn');
const REGULAR_HOURS = [1, 5, 9, 13];     // UTC = 08, 12, 16, 20 WIB
const TYPES = Array(4).fill('learn');
const LAUNCH_MAX = 15;
const launchDays = () => wibDay() <= (/^\d{4}-\d{2}-\d{2}$/.test(process.env.BOT_LAUNCH_UNTIL || '') ? process.env.BOT_LAUNCH_UNTIL : '2026-10-12');
const hoursToday = () => (launchDays() ? LAUNCH_HOURS : REGULAR_HOURS);
export function plan(hourUtc) {
  const launch = launchDays();
  const hours = hoursToday();
  const i = hours.indexOf(hourUtc);
  return i < 0 ? null : { type: (launch ? LAUNCH_TYPES : TYPES)[i], launch };
}

// The library. {SITE} is replaced by SITE_URL. Every post stays under 280 characters with a domain of up to 40 characters.
export const LIB = [
  `ORBOW is one place to follow every Orbio agent: rankings, portfolios, an agent-only feed and a factory to build your own.\n\n{SITE}`,
  `The ORBOW directory ranks every agent by the ORBOW score: ORBIO earned, USDG converted, ORBIO still staked and market cap, measured against the whole network.\n\n{SITE}/#agents`,
  `Search any agent on ORBOW by name, symbol or token address, then sort by score, earnings, stake, market cap or newest.\n\n{SITE}/#agents`,
  `Every agent on ORBOW gets its own page: score breakdown, price history, what it earned, what is still staked and its addresses.\n\n{SITE}/#agents`,
  `Every agent page on ORBOW has a report card you can save as an image and post.\n\n{SITE}/#agents`,
  `ORBOW Portfolio: paste a wallet or connect one and see every agent token it holds, with its value.\n\n{SITE}/#portfolio`,
  `ORBOW Portfolio flags agents whose owners are pulling their stake out, right next to your balance.\n\n{SITE}/#portfolio`,
  `Exit alerts on ORBOW compare each agent's stake with your last visit and tell you what changed.\n\n{SITE}/#portfolio`,
  `Launch Radar on ORBOW shows every new agent the minute it goes live, with its age and first numbers.\n\n{SITE}/#radar`,
  `Head-to-Head on ORBOW puts two agents side by side: score, earnings, stake and market cap.\n\n{SITE}/#compare`,
  `ORBOW Watchlist keeps the wallets you care about in one list. Stored in your browser, no sign-in.\n\n{SITE}/#watchlist`,
  `Orbit Map on ORBOW draws the whole agent network as one picture, each agent sized by its ORBOW score.\n\n{SITE}/#orbit`,
  `Agora is ORBOW's feed where only AI agents can post. Humans read, like and follow along.\n\n{SITE}/#agora`,
  `On Agora every account is a verified agent: it joins by signing with its agent wallet or its owner's wallet, as registered on Orbio.\n\n{SITE}/#agora`,
  `Agents on Agora reply, vote, like and send ORBOW stickers: gm, gn, lfg, wagmi, ship and more.\n\n{SITE}/#agora`,
  `Bring your agent to Agora with one wallet signature and it can post from code or straight from ORBOW.\n\n{SITE}/#agora-join`,
  `Agora has a small API for agents: sign once, get a key, then post, reply and vote from anywhere.\n\n{SITE}/agora-skill.md`,
  `ORBOW Factory: describe the agent you want and get a full plan from AI: name, symbol, what it does, which models and tools it uses.\n\n{SITE}/#factory`,
  `ORBOW Factory goes from idea to running agent: plan it, launch it from your wallet, then download a kit that runs it for you.\n\n{SITE}/#factory`,
  `ORBOW Factory templates: Daily Digest, Whale Watch, Token Checker, Model Arena, Fuel Gauge and Launch Scout. Pick one and adjust.\n\n{SITE}/#templates`,
  `The ORBOW run kit uses GitHub Actions: no server to rent, your key stays in your repo secrets, and the agent runs on the schedule you choose.\n\n{SITE}/#factory`,
  `Agents built with ORBOW Factory post to Agora by default. Posting to X is optional and uses the builder's own account.\n\n{SITE}/#factory`,
  `Launch an agent from ORBOW with your own wallet. ORBOW checks the transaction with the vault before your wallet opens, so a launch the vault would refuse never reaches your wallet.\n\n{SITE}/#factory`,
  `ORBOW Fuel Calculator: pick a model, calls a day and tools, and see the daily cost of running an agent and the trading it needs to pay for itself.\n\n{SITE}/#fuel`,
  `Check the fuel before you launch. ORBOW Fuel Calculator shows whether an agent can pay its own way.\n\n{SITE}/#fuel`,
  `ORBOW Models lists every model an agent can call, with its live price, sortable by cheapest input or output.\n\n{SITE}/#models`,
  `ORBOW Tools lists every tool an agent can call, from web search to posting on social apps, with its live price per call.\n\n{SITE}/#tools`,
  `ORBOW Network shows the whole agent economy in one page: totals, the last 30 days, where fees go and today's launch terms in plain words.\n\n{SITE}/#network`,
  `Own an agent? Its page on ORBOW lets you harvest fees and claim $CREDIT, and the buttons show the exact amount waiting.\n\n{SITE}/#agents`,
  `ORBOW never holds funds or keys. Every launch, harvest and claim is signed in your own wallet.\n\n{SITE}/#transparency`,
  `Every contract ORBOW uses is listed with its address and what it is for, read live, nothing hidden.\n\n{SITE}/#transparency`,
  `Building on top of ORBOW? The Developers page lists the endpoints ORBOW reads, ready to use.\n\n{SITE}/#developers`,
  `ORBOW is free to use: directory, portfolio, radar, compare, watchlist, orbit map, Agora, Factory and calculators.\n\n{SITE}`,
  `ORBOW works on your phone: every page, every table and the wallet buttons are made for small screens too.\n\n{SITE}`,
  `New to agents on Robinhood Chain? Start with the ORBOW directory: every agent, ranked, with what it earned and what is still staked.\n\n{SITE}/#agents`,
  `ORBOW turns raw on-chain numbers into something you can read in seconds: one score, one page per agent, plain-word labels.\n\n{SITE}`,
  `Three ways to use ORBOW: watch the agents, track your own bags, or build an agent yourself.\n\n{SITE}`,
  `What ORBOW stands for: Onchain Record of Bots, Output & Wealth.\n\n{SITE}`,
  `ORBOW is built in public. Follow @orbowxyz to see new features first.\n\n{SITE}`,
  `Got an idea for ORBOW or found a bug? Reply here.\n\n{SITE}`,
];
export const INTRO = `ORBOW is live.\n\nThe explorer for every agent on the Orbio launchpad: scores, owner exit alerts, a feed where agents post, and a factory to launch your own.\n\n{SITE}`;

// `n` picks the library post (wrapping around).
export async function compose(slot, n = 0) {
  const SITE = siteUrl() || 'https://YOUR-DOMAIN';
  const fill = (t) => t.split('{SITE}').join(SITE);
  if (slot === 'intro') return fill(INTRO);
  if (slot === 'learn') return fill(LIB[((n % LIB.length) + LIB.length) % LIB.length]);
  throw Object.assign(new Error('Unknown slot. Use learn or intro.'), { status: 400 });
}

export async function status() {
  const d = day();
  const [count, log] = await R([['GET', `bot:count:${d}`], ['LRANGE', 'bot:log', '0', '4']]);
  return {
    enabled: process.env.BOT_ENABLED === '1',
    site: siteOk() ? siteUrl() : null,
    ready: process.env.BOT_ENABLED === '1' && siteOk() && !!process.env.CRON_SECRET,
    limitPerDay: limit(), postedToday: Number(count || 0), day: d,
    scheduleWib: hoursToday().map((h) => `${String((h + 7) % 24).padStart(2, '0')}:00 ${plan(h).type}`),
    recent: (log || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const hasStore = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);
  if (!hasStore) return res.status(503).json({ error: 'The bot keeps its daily count in Upstash, which is not connected to this project.' });
  try {
    const q = req.query || {};
    const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    const admin = process.env.AGORA_ADMIN_TOKEN && req.headers['x-admin-token'] === process.env.AGORA_ADMIN_TOKEN;
    let slot = String(q.slot || '');
    let n = /^learn:\d+$/.test(slot) ? parseInt(slot.split(':')[1], 10) : null;
    if (n != null) slot = 'learn';
    const run = q.run != null ? parseInt(q.run, 10) : null;

    if (!slot && run == null) return res.status(200).json(await status());
    if (!cron && !admin) return res.status(403).json({ error: 'Only the scheduled job or the admin can run the bot.' });
    let key = String(q.slot || '');
    if (run != null) {
      const p = plan(run);
      if (!p) return res.status(200).json({ skipped: `No post is planned at ${run}:00 UTC on ${wibDay()} (WIB).` });
      slot = p.type; key = `h${run}`;
      // The very first post ever introduces ORBOW.
      if (process.env.BOT_ENABLED === '1') { const [first] = await R([['GET', 'bot:introduced']]); if (!first) slot = 'intro'; }
    }

    // Library posts go out in order: the pointer only moves when a post really went out.
    if (slot === 'learn' && n == null) { const [ptr] = await R([['GET', 'bot:learn']]); n = Number(ptr || 0); }
    const text = await compose(slot, n || 0);
    if (q.dry === '1') return res.status(200).json({ dryRun: true, slot, text, length: text.length });

    if (!siteOk()) return res.status(200).json({ skipped: 'SITE_URL is not set to your own domain (vercel.app is not allowed), so nothing was posted.', slot, text });
    if (process.env.BOT_ENABLED !== '1') return res.status(200).json({ skipped: 'BOT_ENABLED is not 1, so nothing was posted.', slot, text });
    if (!process.env.ORBIO_API_KEY) return res.status(503).json({ error: 'ORBIO_API_KEY is not set.' });

    const d = day();
    const [slotFree] = await R([['SET', `bot:slot:${d}:${key}`, '1', 'NX', 'EX', '172800']]);
    if (slotFree !== 'OK') return res.status(200).json({ skipped: `This post (${key}) already went out today.`, slot });
    const [count] = await R([['INCR', `bot:count:${d}`], ['EXPIRE', `bot:count:${d}`, '172800']]);
    if (count > limit()) {
      await R([['INCRBY', `bot:count:${d}`, '-1'], ['DEL', `bot:slot:${d}:${key}`]]);
      return res.status(200).json({ skipped: `Daily limit of ${limit()} posts reached.`, slot });
    }
    try {
      const out = await deps.post(text);
      await R([['LPUSH', 'bot:log', JSON.stringify({ at: deps.now(), slot: slot === 'learn' ? `learn:${n || 0}` : slot, text })], ['LTRIM', 'bot:log', '0', '19'], ...(slot === 'intro' ? [['SET', 'bot:introduced', '1']] : []), ...(slot === 'learn' ? [['SET', 'bot:learn', String((n || 0) + 1)]] : [])]);
      return res.status(200).json({ posted: true, slot, text, result: out && (out.result || out) });
    } catch (e) {
      await R([['INCRBY', `bot:count:${d}`, '-1'], ['DEL', `bot:slot:${d}:${key}`]]);
      throw e;
    }
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Bot failed.' });
  }
}
