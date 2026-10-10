// ORBOW read-only relay over Orbio's public launchpad API and the gateway's model/tool catalogue.
// Only the documented public read paths are allowed. Responses are cached for 60 s
// at the edge so ORBOW never hammers Orbio.

const ALLOWED = [
  /^agents(\?[\w=&.%,-]*)?$/,                      // list, with limit/offset/sort/q/wallet
  /^agents\/terms$/,
  /^agents\/analytics$/,
  /^agents\/[A-Za-z0-9]{1,80}$/,                    // one agent by vault id or token address
  /^agents\/[A-Za-z0-9]{1,80}\/chart\?range=(1h|4h|1d)$/,
  /^v1\/(models|tools)$/,                          // gateway catalogue: models and tool prices
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET is supported.' });
  }

  const p = String(req.query.p || '');
  if (!ALLOWED.some((re) => re.test(p))) {
    return res.status(400).json({ error: 'Path not allowed. See /#developers for the supported reads.' });
  }

  // Gateway catalogue lives on api.orbio.so. If the owner set ORBIO_API_KEY it is sent from the server only.
  const gateway = p.startsWith('v1/');
  const url = gateway ? `https://api.orbio.so/api/${p}` : `https://www.orbio.so/api/protocol/${p}`;
  const headers = { accept: 'application/json', 'user-agent': 'ORBOW/0.3 (read-only community explorer)' };
  if (gateway && process.env.ORBIO_API_KEY) headers.authorization = `Bearer ${process.env.ORBIO_API_KEY}`;
  try {
    const upstream = await fetch(url, { headers });
    const body = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', upstream.ok ? (gateway ? 's-maxage=600, stale-while-revalidate=3600' : 's-maxage=60, stale-while-revalidate=300') : 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(upstream.status).send(body);
  } catch (err) {
    return res.status(502).json({ error: gateway ? 'The Orbio gateway did not answer. Try again in a minute.' : 'Orbio launchpad did not answer. Try again in a minute.' });
  }
}
