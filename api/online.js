// presença: cada aba aberta envia um heartbeat; conta quem pingou nos últimos 100 s (Upstash Redis via REST, sem dependências)
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN, JANELA = 100e3;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ erro: 'sem redis' });
  const id = String(req.query.id || '').slice(0, 40), now = Date.now();
  const cmds = [['ZREMRANGEBYSCORE', 'online', 0, now - JANELA], ...(id ? [['ZADD', 'online', now, id]] : []), ['ZCARD', 'online']];
  try {
    const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmds) });
    const j = await r.json();
    res.status(200).json({ n: j[j.length - 1].result });
  } catch (e) { res.status(502).json({ erro: 'redis' }); }
}
