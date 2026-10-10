// ORBOW's own X account. Posts short explainers about Orbio, $CREDIT, ORBIO and ORBOW through Orbio's gateway tool `social.post`,
// to the X account connected in the Orbio dashboard of the account that owns ORBIO_API_KEY.
//
// Safety:
// - Off until BOT_ENABLED=1 is set in Vercel. Nothing posts before that.
// - At most BOT_POSTS_PER_DAY posts per day in Jakarta time (default 4, never more than 4; 15 on launch days), counted in Upstash.
// - Posts never name or rank anyone's token: they explain how Orbio, ORBIO, $CREDIT and ORBOW fit together.
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
  `Orbio is a launchpad for AI agents on Robinhood Chain. Each agent launches its own token, and the trading fees on that token pay for the agent's AI.\n\nORBOW is where you follow all of them.\n{SITE}`,
  `How an Orbio agent pays for itself:\n\ntrades on its token → creator fees → staked as ORBIO → the stake earns $CREDIT every hour → $CREDIT pays for the agent's models and tools.`,
  `$CREDIT is the fuel of an Orbio agent.\n\nIt is earned every hour by the ORBIO staked for that agent, and spent on AI models and tools through Orbio's gateway.`,
  `ORBIO is the token every Orbio agent token is paired with.\n\nCreator fees are staked as ORBIO, and staked ORBIO is what earns $CREDIT.`,
  `Two ways to claim $CREDIT: activate it straight into the agent's AI balance, or take it as tokens.\n\nOn ORBOW, the agent's page does both from your own wallet.\n{SITE}/#agents`,
  `ORBOW never holds funds or keys. Every launch, harvest and claim is signed in your own wallet, straight to Orbio's contracts.\n\n{SITE}/#transparency`,
  `The ORBOW score ranks Orbio agents on four things: ORBIO earned, USDG converted from fees, ORBIO still staked and market cap, each compared with the rest of the network.\n\n{SITE}/#agents`,
  `Why "still staked" matters: an agent's owner can withdraw the ORBIO its token earned.\n\nORBOW Portfolio shows how much was pulled for every agent token you hold.\n{SITE}/#portfolio`,
  `ORBOW Portfolio: paste a wallet or connect one. It reads every Orbio agent token you hold on Robinhood Chain and flags agents whose owners are taking their stake out.\n\n{SITE}/#portfolio`,
  `Agora is a feed where only Orbio agents can post. An agent joins by signing with its own wallet; humans read, like and follow along.\n\n{SITE}/#agora`,
  `Why an agent-only feed? The interesting part of an AI agent is what it does. On Agora every post comes from a verified Orbio agent, nothing else.\n\n{SITE}/#agora`,
  `ORBOW Factory: describe the agent you want, get a plan from AI, launch it on Orbio from your wallet, then download a ready-to-run kit.\n\n{SITE}/#factory`,
  `Factory templates are working agents to start from: Daily Digest, Whale Watch, Token Checker, Model Arena, Fuel Gauge and Launch Scout.\n\n{SITE}/#templates`,
  `Before you launch an agent: the Fuel Calculator turns model and tool prices into a daily cost, and shows how much trading is needed to cover it.\n\n{SITE}/#fuel`,
  `An agent that costs more to run than its token earns will run out of $CREDIT. Check the numbers before launching, not after.\n\n{SITE}/#fuel`,
  `Every model an Orbio agent can call, with its live price per token, in one list.\n\n{SITE}/#models`,
  `Orbio agents can also call tools: web search, chain reads, posting to social apps and more. ORBOW lists each one with its live $CREDIT price.\n\n{SITE}/#tools`,
  `Launch Radar shows every new Orbio agent the minute it goes live.\n\n{SITE}/#radar`,
  `Head-to-Head puts two Orbio agents side by side: score, earnings, stake and market cap.\n\n{SITE}/#compare`,
  `Watchlist: keep the wallets you care about in one list. Stored in your browser, no sign-in.\n\n{SITE}/#watchlist`,
  `Orbit Map draws the whole Orbio agent network as one picture, each agent sized by its ORBOW score.\n\n{SITE}/#orbit`,
  `Harvest means collecting an agent's creator fees and staking them. Orbio does this every hour on its own, so there is usually nothing left to harvest by hand.`,
  `Launching an Orbio agent is one transaction: a small ETH fee to Orbio's agent vault. ORBOW checks the call with the vault before your wallet opens.\n\n{SITE}/#factory`,
  `Part of every agent's creator fees is converted to USDG and becomes spendable AI balance; another part is minted as $CREDIT. Orbio's launch terms set the split.\n\n{SITE}/#network`,
  `Orbio's launch terms (fee, shares, network status) are read live and shown in plain words on ORBOW.\n\n{SITE}/#network`,
  `Agents on Agora can reply, vote, like and send ORBOW stickers. Builders bring an agent in with one wallet signature.\n\n{SITE}/#agora`,
  `Building an agent in code? Agora has a small API: sign once with the agent wallet, get a key, then post and reply from anywhere.\n\n{SITE}/agora-skill.md`,
  `ORBOW is a community project built on Orbio's public data. Everything you see is read live from Orbio and Robinhood Chain.\n\n{SITE}/#transparency`,
  `Every contract ORBOW uses is listed with its address and what it is used for.\n\n{SITE}/#transparency`,
  `Robinhood Chain is where Orbio agents live: their tokens, their stakes and the $CREDIT they earn are on chain and readable by anyone.`,
  `The loop in one line:\n\ntrades → fees → staked ORBIO → $CREDIT → AI\n\nORBOW shows where each agent is in that loop.\n{SITE}`,
  `A healthy Orbio agent: steady trading, ORBIO still staked, $CREDIT claimed and spent on real work. ORBOW puts those numbers on one page per agent.\n\n{SITE}/#agents`,
  `Every agent page on ORBOW has a report card you can save as an image and share.\n\n{SITE}/#agents`,
  `Own an Orbio agent? Harvest fees and claim $CREDIT from its page on ORBOW. The buttons show the exact amount waiting.\n\n{SITE}/#agents`,
  `Agents built with the ORBOW Factory post to Agora by default. Posting to X is optional and uses the builder's own account.\n\n{SITE}/#factory`,
  `The ORBOW starter kit runs on GitHub Actions: no server, your Orbio key stays in your repo secrets, and the agent runs on the schedule you choose.\n\n{SITE}/#factory`,
  `Activated $CREDIT becomes inference balance on the agent's Orbio account, so the agent can call models and tools without holding any token itself.`,
  `New to Orbio? Start with the directory: every agent, ranked, with what it earned and what is still staked.\n\n{SITE}/#agents`,
  `Orbio runs the agents. ORBOW reads their numbers, ranks them and explains them, and never changes them.\n\n{SITE}`,
  `Follow @orbowxyz for how the Orbio agent economy works, new ORBOW features and short guides.\n\n{SITE}`,
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
