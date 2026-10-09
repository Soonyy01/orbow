// ORBOW Portfolio: which Orbio agent tokens a wallet holds, what they are worth,
// and how much each agent's owner has pulled out of its stake.
// Read-only. Balances come from balanceOf calls on Robinhood Chain; agent data from
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

async function rpc(body) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`RPC ${r.status}: ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

// balanceOf(wallet) for every token. Tries JSON-RPC batches first, falls back to single calls.
export async function balances(wallet, tokens) {
  const out = new Map();
  const errors = [];
  const call = (token, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: token, data: '0x70a08231' + pad(wallet) }, 'latest'] });
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100));
  let batchWorks = true;
  for (const chunk of chunks) {
    if (batchWorks) {
      try {
        const res = await rpc(chunk.map((t, i) => call(t, i)));
        if (!Array.isArray(res)) { batchWorks = false; }
        else {
          for (const item of res) {
            const t = chunk[item.id];
            if (item.error) errors.push(`${t}: ${item.error.message || 'call failed'}`);
            else if (t) out.set(t.toLowerCase(), item.result);
          }
          continue;
        }
      } catch (e) { batchWorks = false; errors.push(`batch: ${e.message}`); }
    }
    // single-call fallback, 20 at a time
    for (let i = 0; i < chunk.length; i += 20) {
      await Promise.all(chunk.slice(i, i + 20).map(async (t) => {
        try { const res = await rpc(call(t, 1)); if (res.error) errors.push(`${t}: ${res.error.message}`); else out.set(t.toLowerCase(), res.result); }
        catch (e) { errors.push(`${t}: ${e.message}`); }
      }));
    }
  }
  return { out, errors };
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
    const { out, errors } = await balances(wallet, tokens);
    if (!out.size && errors.length) {
      return res.status(502).json({ error: 'Could not read balances from Robinhood Chain.', details: errors.slice(0, 10), rpc: RPC });
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
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      wallet, scanned: tokens.length, holdings, owned,
      totalUsd: holdings.reduce((t, h) => t + (h.valueUsd || 0), 0),
      orbioUsd: n6(orbioMicroUsd), errors: errors.slice(0, 20), errorCount: errors.length, updatedAt: Date.now(),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Portfolio failed.' });
  }
}
