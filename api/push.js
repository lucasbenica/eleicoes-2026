// inscrições de push: POST {endpoint, keys} salva, DELETE {endpoint} remove (Upstash Redis via REST, hash "push")
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ erro: 'sem redis' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}, ep = String(b.endpoint || '');
  if (!/^https:\/\//.test(ep) || ep.length > 1000) return res.status(400).json({ erro: 'endpoint' });
  let cmd;
  if (req.method === 'POST') {
    if (!b.keys?.p256dh || !b.keys?.auth) return res.status(400).json({ erro: 'keys' });
    cmd = ['HSET', 'push', ep, JSON.stringify({ endpoint: ep, keys: { p256dh: String(b.keys.p256dh), auth: String(b.keys.auth) } })];
  } else if (req.method === 'DELETE') cmd = ['HDEL', 'push', ep];
  else return res.status(405).end();
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
    if (!r.ok) throw 0;
    res.status(200).json({ ok: true });
  } catch (e) { res.status(502).json({ erro: 'redis' }); }
}
