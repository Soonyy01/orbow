// ORBOW Agent Factory planner: turns one sentence into an agent plan using a model on
// Orbio's gateway. Needs ORBIO_API_KEY in the Vercel project's environment variables.
// The browser never sees the key. Output is validated before it is returned.

export const TEMPLATES = ['digest', 'whale', 'checker', 'arena', 'fuel', 'scout'];
export const SCHEDULES = {
  hourly: '7 * * * *',
  '4h': '7 */4 * * *',
  daily: '53 6 * * *',
  twice: '53 6,18 * * *',
};
const MODELS = ['google/gemini-3.8-flash', 'deepseek/deepseek-v4-pro-0813', 'anthropic/claude-sonnet-5', 'anthropic/claude-opus-5'];

const hits = new Map(); // best-effort per-instance rate limit
function limited(ip) {
  const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  h.push(now); hits.set(ip, h); return h.length > 12;
}

const SYSTEM = `You design small autonomous agents for the Orbio launchpad. Reply with ONE JSON object and nothing else.
Pick the template that best fits the request:
- digest: searches the web on a topic and posts a short brief on a schedule
- whale: watches large transfers of one token on Robinhood Chain and posts alerts
- checker: replies to X mentions that contain a token address with a short risk note
- arena: asks several models the same question and posts their answers as a thread
- fuel: posts about its own $CREDIT balance and switches models as it runs low
- scout: reads new Orbio agent launches and posts a first look at each
JSON keys: template (one of digest, whale, checker, arena, fuel, scout), name (2-24 chars), symbol (3-8 uppercase letters),
description (one sentence, max 160 chars), topic (what it focuses on, max 80 chars), tone (max 40 chars),
schedule (one of hourly, 4h, daily, twice), reason (why this template, max 140 chars).`;

function pick(plan) {
  const s = (v, n) => String(v ?? '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, n);
  const template = TEMPLATES.includes(plan.template) ? plan.template : 'digest';
  let symbol = s(plan.symbol, 8).toUpperCase().replace(/[^A-Z]/g, '');
  if (symbol.length < 3) symbol = (s(plan.name, 24).toUpperCase().replace(/[^A-Z]/g, '') + 'AGENT').slice(0, 5);
  return {
    template,
    name: s(plan.name, 24) || 'New Agent',
    symbol,
    description: s(plan.description, 160),
    topic: s(plan.topic, 80),
    tone: s(plan.tone, 40) || 'clear and calm',
    schedule: Object.keys(SCHEDULES).includes(plan.schedule) ? plan.schedule : 'daily',
    reason: s(plan.reason, 140),
  };
}

export function parsePlan(text) {
  const m = String(text || '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('The model did not return a plan. Try rephrasing.'), { status: 502 });
  try { return pick(JSON.parse(m[0])); } catch { throw Object.assign(new Error('The model returned a plan that was not valid JSON. Try again.'), { status: 502 }); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  const key = process.env.ORBIO_API_KEY;
  if (!key) return res.status(503).json({ error: 'The AI planner is not set up. Add ORBIO_API_KEY (your Orbio gateway key) in Vercel → Project → Settings → Environment Variables, then redeploy. You can still pick a template yourself.' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = String(body.prompt || '').trim().slice(0, 500);
  if (prompt.length < 8) return res.status(400).json({ error: 'Describe the agent in at least a few words.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Too many plans from this address. Try again in an hour.' });
  const model = MODELS.includes(process.env.FACTORY_MODEL) ? process.env.FACTORY_MODEL : MODELS[0];
  try {
    const r = await fetch('https://api.orbio.so/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 400, temperature: 0.4, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
    });
    const text = await r.text();
    if (r.status === 401) return res.status(502).json({ error: 'Orbio rejected ORBIO_API_KEY (401). Check the key in Vercel.' });
    if (r.status === 402) return res.status(502).json({ error: 'The Orbio account behind ORBIO_API_KEY has no balance left (402). Top it up on orbio.so.' });
    if (!r.ok) return res.status(502).json({ error: `Orbio gateway answered ${r.status}: ${text.slice(0, 160)}` });
    const json = JSON.parse(text);
    const plan = parsePlan(json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content);
    return res.status(200).json({ plan, model, cron: SCHEDULES[plan.schedule] });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Planner failed.' });
  }
}
