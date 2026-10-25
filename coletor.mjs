// Coletor da apuração (TSE → data/live.json), dentro dos limites da divulgação de resultados 2026.
// Regras do TSE: máx. 100 req/s por IP; acima disso, bloqueio de 10 min renovado a cada nova tentativa;
// 404 repetidos também bloqueiam; 304 conta no limite. Por isso:
//  - teto de RPS req/s (padrão 40 = 40% do limite) com no máx. CONC requisições simultâneas;
//  - URLs só a partir do arquivo de configuração (mun-e<ele>-cm.json), código do município com 5 dígitos;
//  - EA15 (<uf>-e<ele>-ab.json) diz quais municípios mudaram; só esses são baixados;
//  - If-None-Match/If-Modified-Since em tudo; 404 de município não é refeito no mesmo ciclo;
//  - ao primeiro 429/403: para tudo por 11 min, sem nenhuma tentativa no meio (tentar renova o bloqueio).
// Uso: node coletor.mjs [eleição=6258] [--once]
import fs from 'fs';
import { put } from '@vercel/blob';
import { fileURLToPath } from 'url';
const ELE = process.argv.find(a => /^\d+$/.test(a)) || '6258', ONCE = process.argv.includes('--once');
const RPS = +(process.env.RPS || 40), CONC = +(process.env.CONC || 8), CICLO = 60e3, PAUSA_BLOQ = 11 * 60e3;
const BASE = `https://resultados.tse.jus.br/oficial/ele2026/${ELE}`, E6 = ELE.padStart(6, '0');
const DIR = fileURLToPath(new URL('./data/', import.meta.url)), MUNRI = JSON.parse(fs.readFileSync(new URL('./data/mun-ri.json', import.meta.url)));
// ordem das regiões = ordem de data/ri.json (o site já tem esse arquivo em cache; o índice substitui o id)
const RI_IDX = new Map(JSON.parse(fs.readFileSync(new URL('./data/ri.json', import.meta.url))).map((r, i) => [String(r.id), i]));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// limitador: janela deslizante de 1 s + semáforo
let stamps = [], ativos = 0, bloqueadoAte = 0, nReq = 0;
class Bloqueio extends Error {}
async function get(url, cache) {
  while (ativos >= CONC || stamps.length >= RPS) {
    await sleep(20); const t = Date.now(); stamps = stamps.filter(s => t - s < 1000);
  }
  if (Date.now() < bloqueadoAte) throw new Bloqueio();
  ativos++; stamps.push(Date.now()); nReq++;
  try {
    const h = {}, c = cache.get(url); if (c) { if (c.etag) h['If-None-Match'] = c.etag; if (c.lm) h['If-Modified-Since'] = c.lm; }
    const r = await fetch(url, { headers: h });
    if (r.status === 429 || r.status === 403) { bloqueadoAte = Date.now() + PAUSA_BLOQ; log(`HTTP ${r.status} → pausa de 11 min`); throw new Bloqueio(); }
    if (r.status === 304) return c.json;
    if (!r.ok) return { erro: r.status };
    const json = await r.json(); cache.set(url, { etag: r.headers.get('etag'), lm: r.headers.get('last-modified'), json }); return json;
  } finally { ativos--; }
}

const num = x => +String(x ?? 0).replace(/\./g, '').replace(',', '.') || 0;
function extrai(j) { // EA20 (-u.json): presidente = carg[0]
  const c = j.carg?.find(c => c.cd == '1') || j.carg?.[0], v = { c13: 0, c22: 0 };
  for (const a of c?.agr || []) for (const p of a.par || []) for (const k of p.cand || []) if (k.n == '13' || k.n == '22') v['c' + k.n] += num(k.vap);
  return { te: num(j.e?.te), est: num(j.e?.est), pst: num(j.s?.pst) / 100, ab: num(j.e?.a), br: num(j.v?.vb), nu: num(j.v?.tvn), ...v, dt: j.dt, ht: j.ht, and: j.and };
}

// histórico dos últimos snapshots: o delta cobre quem perdeu até JANELA-1 ciclos
const JANELA = 5, hist = []; let ultimoFull = null;
async function publica(nome, obj) {
  const txt = JSON.stringify(obj), f = DIR + nome;
  fs.writeFileSync(f + '.tmp', txt); fs.renameSync(f + '.tmp', f);
  // publica no Vercel Blob (lido pelo site em produção) se houver token
  if (process.env.BLOB_READ_WRITE_TOKEN) await put(nome, txt, { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json' }).catch(e => log('blob:', e.message));
}
const cache = new Map(), mun = new Map(), assinatura = new Map(), naoExiste = new Set();
async function ciclo() {
  const cfg = await get(`${BASE}/config/mun-e${E6}-cm.json`, cache);
  const ufs = cfg.abr.filter(a => a.cd !== 'zz'), lista = ufs.flatMap(a => a.mu.map(m => ({ uf: a.cd, cd: m.cd.padStart(5, '0'), ibge: m.cdi })));
  const br = await get(`${BASE}/dados/br/br-c0001-e${E6}-u.json`, cache);
  // EA15 por UF: decide quais municípios baixar (primeira vez: todos)
  const mudou = new Set();
  await Promise.all(ufs.map(async a => {
    const ab = await get(`${BASE}/dados/${a.cd}/${a.cd}-e${E6}-ab.json`, cache);
    const itens = ab?.abr?.find?.(x => x.cd?.toLowerCase() === a.cd)?.mu || ab?.abr?.flatMap?.(x => x.mu || []) || [];
    if (!itens.length) { for (const m of a.mu) mudou.add(a.cd + m.cd.padStart(5, '0')); return; } // formato inesperado: baixa tudo
    for (const m of itens) { const k = a.cd + String(m.cd).padStart(5, '0'), s = JSON.stringify(m); if (assinatura.get(k) !== s) { assinatura.set(k, s); mudou.add(k) } }
  }));
  const fila = lista.filter(m => (mudou.has(m.uf + m.cd) || !mun.has(m.ibge)) && !naoExiste.has(m.uf + m.cd));
  log(`ciclo: ${fila.length} municípios a atualizar`);
  await Promise.all(fila.map(async m => {
    const j = await get(`${BASE}/dados/${m.uf}/${m.uf}${m.cd}-c0001-e${E6}-u.json`, cache);
    if (j?.erro === 404) { naoExiste.add(m.uf + m.cd); return; }
    if (j && !j.erro) mun.set(m.ibge, extrai(j));
  }));
  // agrega por região imediata
  const ri = {};
  for (const [ibge, d] of mun) {
    const id = MUNRI[ibge]; if (!id) continue;
    const r = ri[id] ??= { te: 0, est: 0, c13: 0, c22: 0, br: 0, nu: 0, ab: 0 };
    for (const k in r) r[k] += d[k];
  }
  // formato compacto: b = [te, est, c13, c22, br, nu, ab] nacional; região = [apurado em 1/10000, c13, c22] na ordem de ri.json
  //  full.json: r = todas as regiões; live.json: d = [índice, …valores] só das que mudaram desde o snapshot `a` (valores absolutos → idempotente)
  const B = extrai(br), s = Math.floor(Date.now() / 1000), b = [B.te, B.est, B.c13, B.c22, B.br, B.nu, B.ab];
  const cur = Array.from({ length: RI_IDX.size }, () => [0, 0, 0]);
  for (const [id, r] of Object.entries(ri)) { const i = RI_IDX.get(id); if (i !== undefined) cur[i] = [r.te ? Math.round(r.est / r.te * 1e4) : 0, r.c13, r.c22]; }
  const base = hist[0], d = [];
  if (base) cur.forEach((v, i) => { if (v.some((x, k) => x !== base.cur[i][k])) d.push(i, ...v) });
  const mudouFull = !ultimoFull || cur.some((v, i) => v.some((x, k) => x !== ultimoFull[i][k]));
  hist.push({ s, cur }); if (hist.length > JANELA) hist.shift();
  const live = { s, a: base ? base.s : s, t: B.ht, b, d }, full = { s, t: B.ht, b, r: cur.flat() };
  await publica('live.json', live);
  if (mudouFull) { await publica('full.json', full); ultimoFull = cur; }
  log(`ok · ${(B.pst * 100).toFixed(2)}% seções · ${mun.size} municípios · ${nReq} req no total`);
}

for (;;) {
  const t = Date.now();
  try { await ciclo(); } catch (e) { if (!(e instanceof Bloqueio)) log('erro:', e.message); }
  if (ONCE) break;
  const espera = Math.max(bloqueadoAte - Date.now(), CICLO - (Date.now() - t), 5e3);
  await sleep(espera);
}
