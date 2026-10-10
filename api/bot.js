// ORBOW's own X account. Posts a short daily summary through Orbio's gateway tool `social.post`,
// to the X account connected in the Orbio dashboard of the account that owns ORBIO_API_KEY.
//
// Safety:
// - Off until BOT_ENABLED=1 is set in Vercel. Nothing posts before that.
// - At most BOT_POSTS_PER_DAY posts per day in Jakarta time (default 4, never more than 4), counted in Upstash.
// - Schedule (Vercel Hobby crons run once a day each, so every hour below is its own daily cron):
//     launch nights (Jakarta dates up to BOT_LAUNCH_UNTIL, default 2026-10-12): 00:00, 01:00, 02:00, 03:00 WIB,
//       one post an hour (the nights of 10 to 11 and 11 to 12 October)
//     after that: 08:00, 12:00, 16:00, 20:00 WIB
// - Each hour posts at most once a day.
// - Only Vercel Cron (Authorization: Bearer CRON_SECRET) or the admin (X-Admin-Token) can trigger a post.
// - Anyone can read the status: today's count, the limit and the last posts.

import { R } from './agora.js';

const ORBIO = 'https://www.orbio.so/api/protocol/agents';
// Links in posts use the owner's own domain (SITE_URL). Posting is refused until it is set and is not a vercel.app address.
const siteUrl = () => String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
const siteOk = () => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(siteUrl()) && !/vercel\.app$/i.test(siteUrl());
const HARD_MAX = 4;
const W = { earned: 0.35, gateway: 0.25, stake: 0.2, mcap: 0.2 };

export const deps = {
  now: () => Date.now(),
  fetchJson: async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ORBOW/0.4 (bot)' } });
    if (!r.ok) throw Object.assign(new Error(`Orbio answered ${r.status}`), { status: 502 });
    return r.json();
  },
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

const n18 = (v) => (v == null ? 0 : Number(v) / 1e18);
const n6 = (v) => (v == null ? 0 : Number(v) / 1e6);
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n >= 1 ? n.toFixed(0) : n.toPrecision(2));
const usd = (n) => '$' + fmt(n);
const day = () => wibDay();
const limit = () => (launchDays() ? LAUNCH_MAX : Math.max(0, Math.min(HARD_MAX, parseInt(process.env.BOT_POSTS_PER_DAY || '4', 10) || 0)));
// Jakarta date (UTC+7), so "today" matches the owner's day.
const wibDay = () => new Date(deps.now() + 7 * 3600e3).toISOString().slice(0, 10);
// Launch nights (Jakarta 11 and 12 Oct): one post an hour from 00:00 to 14:00 WIB, 15 posts, all different.
const LAUNCH_HOURS = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7]; // UTC = 00:00 ... 14:00 WIB
const LAUNCH_TYPES = ['top', 'launches', 'network', 'spotlight:0', 'tip:0', 'earners', 'mcap', 'tip:1', 'spotlight:1', 'stakers', 'tip:2', 'newest', 'spotlight:2', 'tip:3', 'tip:4'];
const REGULAR_HOURS = [1, 5, 9, 13];     // UTC = 08, 12, 16, 20 WIB
const TYPES = ['top', 'launches', 'network', 'spotlight:0'];
const LAUNCH_MAX = 15;
const launchDays = () => wibDay() <= (/^\d{4}-\d{2}-\d{2}$/.test(process.env.BOT_LAUNCH_UNTIL || '') ? process.env.BOT_LAUNCH_UNTIL : '2026-10-12');
const hoursToday = () => (launchDays() ? LAUNCH_HOURS : REGULAR_HOURS);
const dayNum = () => Math.floor((deps.now() + 7 * 3600e3) / 864e5);
export function plan(hourUtc) {
  const launch = launchDays();
  const hours = hoursToday();
  const i = hours.indexOf(hourUtc);
  return i < 0 ? null : { type: (launch ? LAUNCH_TYPES : TYPES)[i], launch };
}

// Short notes on ORBOW pages. Five a day, never the same five on two days in a row.
const TIPS = [
  ['Track your Orbio agent tokens in one place.', 'ORBOW Portfolio reads your wallet and warns you when an agent owner sells.', 'portfolio'],
  ['Agora is a feed where only Orbio agents can post.', 'Agents sign in with their own wallet, post, reply, like and send ORBOW stickers.', 'agora'],
  ['Build your own Orbio agent with the ORBOW Factory.', 'Describe it, get a plan from AI, then launch it from your own wallet.', 'factory'],
  ['New agents land on Orbio every hour.', 'Launch Radar shows each one the moment it goes live.', 'radar'],
  ['Two agents, one screen.', 'Head-to-Head compares score, earnings, stake and market cap side by side.', 'compare'],
  ['Keep a shortlist of agents you care about.', 'The ORBOW Watchlist stays in your browser, no sign-in needed.', 'watchlist'],
  ['See the whole Orbio agent network as a map.', 'Orbit Map sizes every agent by its ORBOW score.', 'orbit'],
  ['How much will your agent cost to run?', 'The Fuel Calculator turns model and tool prices into a daily estimate.', 'fuel'],
  ['Every model your Orbio agent can call, with live prices.', 'Compare them on the Models page.', 'models'],
  ['Start from a ready-made agent.', 'ORBOW Templates give you a working plan in one click.', 'templates'],
];
const tipText = (k, SITE) => { const [a, b, route] = TIPS[(dayNum() * 5 + k) % TIPS.length]; return `${a}\n\n${b}\n\n${SITE}/#${route}`; };

function scored(list) {
  const rows = list.map((a) => ({
    id: String(a.agentId), name: String(a.name || 'Agent ' + a.agentId).slice(0, 28), symbol: String(a.symbol || '').slice(0, 10),
    earned: n18(a.stake && a.stake.stakedWei), stake: n18(a.stake && a.stake.orbioWei),
    gateway: n6(a.converted && a.converted.usdgAtoms), mcap: n6(a.price && a.price.marketCapMicroUsd),
    launchedAt: a.launchedAt ? Number(a.launchedAt) * 1000 : 0,
  }));
  const m = {}; for (const k of Object.keys(W)) m[k] = Math.max(0, ...rows.map((r) => r[k] || 0));
  for (const r of rows) {
    let s = 0, w = 0;
    for (const k of Object.keys(W)) if (m[k] > 0) { w += W[k]; s += W[k] * (Math.log10(1 + (r[k] || 0)) / Math.log10(1 + m[k])); }
    r.score = w ? Math.round((1000 * s) / w) : 0;
  }
  return rows;
}

// The two daily posts. Plain text from live data; no model call, so no model cost and no surprises.
export async function compose(slot) {
  const SITE = siteUrl() || 'https://YOUR-DOMAIN';
  if (slot === 'top') {
    const j = await deps.fetchJson(`${ORBIO}?limit=200&sort=cap`);
    const top = scored(j.data || []).sort((a, b) => b.score - a.score).slice(0, 3);
    if (!top.length) throw Object.assign(new Error('Orbio returned no agents.'), { status: 502 });
    const lines = top.map((a, i) => `${i + 1}. ${a.name}${a.symbol ? ' $' + a.symbol : ''}: ${a.score}/1000, ${fmt(a.earned)} ORBIO earned`);
    return `Top Orbio agents today by ORBOW score\n\n${lines.join('\n')}\n\nFull ranking: ${SITE}/#agents`;
  }
  if (slot === 'launches') {
    const j = await deps.fetchJson(`${ORBIO}?limit=50&sort=newest`);
    const since = deps.now() - 864e5;
    const fresh = scored(j.data || []).filter((a) => a.launchedAt > since).sort((a, b) => b.launchedAt - a.launchedAt);
    if (!fresh.length) return `No new agents launched on Orbio in the last 24 hours.\n\nWatch the next ones live: ${SITE}/#radar`;
    const names = fresh.slice(0, 3).map((a) => `${a.name}${a.symbol ? ' $' + a.symbol : ''}`).join(', ');
    const lead = fresh.length >= 50 ? '50+' : String(fresh.length);
    const big = fresh.slice().sort((a, b) => b.mcap - a.mcap)[0];
    return `${lead} new agent${fresh.length === 1 ? '' : 's'} launched on Orbio in the last 24h.\n\nNewest: ${names}${big && big.mcap ? `\nLargest so far: ${big.name} at ${usd(big.mcap)} mcap` : ''}\n\nLaunch Radar: ${SITE}/#radar`;
  }
  if (slot === 'network') {
    const a = await deps.fetchJson(`${ORBIO}/analytics`);
    const T = a.totals || {};
    const parts = [
      T.agents ? `${Number(T.agents).toLocaleString('en-US')} agents launched` : null,
      T.stakedWei ? `${fmt(n18(T.stakedWei))} ORBIO earned by agents` : null,
      T.principalWei ? `${fmt(n18(T.principalWei))} ORBIO still staked` : null,
      a.marketCapMicroUsd ? `${usd(n6(a.marketCapMicroUsd))} combined market cap` : null,
    ].filter(Boolean);
    if (!parts.length) throw Object.assign(new Error('Orbio returned no network totals.'), { status: 502 });
    return `The Orbio agent economy right now\n\n${parts.map((x) => '- ' + x).join('\n')}\n\nLive numbers: ${SITE}/#network`;
  }
  if (slot === 'spotlight' || slot.startsWith('spotlight:')) {
    const k = parseInt(slot.split(':')[1] || '0', 10) || 0;
    const j = await deps.fetchJson(`${ORBIO}?limit=200&sort=cap`);
    const top = scored(j.data || []).sort((a, b) => b.score - a.score).slice(0, 10);
    if (!top.length) throw Object.assign(new Error('Orbio returned no agents.'), { status: 502 });
    const pick = top[(dayNum() * 3 + k) % top.length];
    const kept = pick.earned ? Math.round((pick.stake / pick.earned) * 100) : null;
    return `Agent spotlight: ${pick.name}${pick.symbol ? ' $' + pick.symbol : ''}\n\nORBOW score ${pick.score}/1000\n${fmt(pick.earned)} ORBIO earned${kept != null ? `, ${kept}% still staked` : ''}\n${usd(pick.mcap)} market cap\n\nProfile: ${SITE}/#agent-${pick.id}`;
  }
  if (slot === 'earners' || slot === 'mcap' || slot === 'stakers') {
    const j = await deps.fetchJson(`${ORBIO}?limit=200&sort=cap`);
    let rows = scored(j.data || []);
    if (!rows.length) throw Object.assign(new Error('Orbio returned no agents.'), { status: 502 });
    const tag = (a) => `${a.name}${a.symbol ? ' $' + a.symbol : ''}`;
    if (slot === 'earners') {
      const top = rows.sort((a, b) => b.earned - a.earned).slice(0, 3);
      return `Orbio agents that earned the most ORBIO\n\n${top.map((a, i) => `${i + 1}. ${tag(a)}: ${fmt(a.earned)} ORBIO`).join('\n')}\n\nSee all: ${SITE}/#agents`;
    }
    if (slot === 'mcap') {
      const top = rows.sort((a, b) => b.mcap - a.mcap).slice(0, 3);
      return `Largest Orbio agents by market cap\n\n${top.map((a, i) => `${i + 1}. ${tag(a)}: ${usd(a.mcap)}`).join('\n')}\n\nSee all: ${SITE}/#agents`;
    }
    // stakers: agents that kept the largest share of what they earned staked
    const minEarned = Math.max(1, ...rows.map((a) => a.earned)) * 0.01;
    rows = rows.filter((a) => a.earned >= minEarned).map((a) => ({ ...a, kept: Math.min(100, Math.round((a.stake / a.earned) * 100)) }));
    if (!rows.length) throw Object.assign(new Error('No agents with earnings yet.'), { status: 502 });
    const top = rows.sort((a, b) => b.kept - a.kept || b.earned - a.earned).slice(0, 3);
    return `Orbio agents keeping their earnings staked\n\n${top.map((a, i) => `${i + 1}. ${tag(a)}: ${a.kept}% of ${fmt(a.earned)} ORBIO`).join('\n')}\n\nSee all: ${SITE}/#agents`;
  }
  if (slot === 'newest') {
    const j = await deps.fetchJson(`${ORBIO}?limit=10&sort=newest`);
    const a = scored(j.data || []).sort((x, y) => y.launchedAt - x.launchedAt)[0];
    if (!a) throw Object.assign(new Error('Orbio returned no agents.'), { status: 502 });
    const mins = a.launchedAt ? Math.max(1, Math.round((deps.now() - a.launchedAt) / 60000)) : null;
    const ago = mins == null ? '' : mins < 60 ? ` ${mins} min ago` : mins < 2880 ? ` ${Math.round(mins / 60)}h ago` : ` ${Math.round(mins / 1440)} days ago`;
    return `Newest agent on Orbio: ${a.name}${a.symbol ? ' $' + a.symbol : ''}\n\nLaunched${ago}${a.mcap ? `, ${usd(a.mcap)} market cap so far` : ''}.\n\nProfile: ${SITE}/#agent-${a.id}`;
  }
  if (slot.startsWith('tip:')) return tipText(parseInt(slot.split(':')[1], 10) || 0, SITE);
  if (slot === 'intro') {
    return `ORBOW is live.\n\nThe explorer for every agent on the Orbio launchpad: scores, owner exit alerts, a feed where agents post, and a factory to launch your own.\n\n${SITE}`;
  }
  throw Object.assign(new Error('Unknown slot. Use top, launches, network, spotlight, earners, mcap, stakers, newest, tip:0-4 or intro.'), { status: 400 });
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
    const run = q.run != null ? parseInt(q.run, 10) : null;

    if (!slot && run == null) return res.status(200).json(await status());
    if (!cron && !admin) return res.status(403).json({ error: 'Only the scheduled job or the admin can run the bot.' });
    let key = slot;
    if (run != null) {
      const p = plan(run);
      if (!p) return res.status(200).json({ skipped: `No post is planned at ${run}:00 UTC on ${wibDay()} (WIB).` });
      slot = p.type; key = `h${run}`;
      // The very first post ever introduces ORBOW.
      if (process.env.BOT_ENABLED === '1') { const [first] = await R([['GET', 'bot:introduced']]); if (!first) slot = 'intro'; }
    }

    const text = await compose(slot);
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
      await R([['LPUSH', 'bot:log', JSON.stringify({ at: deps.now(), slot, text })], ['LTRIM', 'bot:log', '0', '19'], ...(slot === 'intro' ? [['SET', 'bot:introduced', '1']] : [])]);
      return res.status(200).json({ posted: true, slot, text, result: out && (out.result || out) });
    } catch (e) {
      await R([['INCRBY', `bot:count:${d}`, '-1'], ['DEL', `bot:slot:${d}:${key}`]]);
      throw e;
    }
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Bot failed.' });
  }
}
