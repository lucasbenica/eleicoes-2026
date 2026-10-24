// Núcleo compartilhado: dados (simulados ou TSE), layout cartograma e render de pontos.
// TSE (divulgação): https://resultados.tse.jus.br/oficial/ele2026/{ELEICAO}/dados-simplificados/{uf}/{uf}-c0001-e{ELEICAO}-r.json
// Campos usados: e (eleitorado), pst (% seções totalizadas), a (abstenção), vb (brancos), tvn (nulos), cand[{n,vap}]
const UF = [ // sigla, lon, lat, eleitorado, share 13 nos válidos (simulação)
  ['RR',-61.4,2.1,366e3,.24],['AP',-51.6,1.4,550e3,.52],['AM',-64.6,-4.2,2.65e6,.49],['PA',-52.5,-4.0,6.08e6,.55],
  ['AC',-70.5,-9.2,600e3,.30],['RO',-62.8,-10.9,1.2e6,.30],['TO',-48.3,-10.2,1.1e6,.51],['MA',-45.3,-5.0,4.98e6,.71],
  ['PI',-42.8,-7.7,2.6e6,.77],['CE',-39.5,-5.2,6.8e6,.70],['RN',-36.6,-5.8,2.55e6,.65],['PB',-36.8,-7.1,3.1e6,.67],
  ['PE',-37.9,-8.4,7.0e6,.67],['AL',-36.6,-9.6,2.3e6,.59],['SE',-37.4,-10.6,1.7e6,.67],['BA',-41.7,-12.5,11.3e6,.72],
  ['MT',-55.9,-12.6,2.5e6,.35],['GO',-49.6,-15.9,4.9e6,.41],['DF',-47.8,-15.8,2.2e6,.41],['MS',-54.8,-20.5,2.0e6,.40],
  ['MG',-44.6,-18.5,16.3e6,.50],['ES',-40.6,-19.6,2.9e6,.41],['RJ',-42.9,-22.3,12.8e6,.43],['SP',-48.5,-22.2,34.7e6,.45],
  ['PR',-51.6,-24.6,8.5e6,.38],['SC',-50.5,-27.3,5.5e6,.31],['RS',-53.3,-29.8,8.6e6,.43]
];
const CATS = ['c22','c13','br','nu','ab'];
const COLORS = {c22:'#1f6feb',c13:'#e3262d',br:'#ffffff',nu:'#8b9099',ab:'#000000'};
const VPD = +(new URLSearchParams(location.search).get('d') || 10000); // votos por ponto

function rnd(seed){ let s=seed|0; return ()=>{ s=s+0x6D2B79F5|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; } // mulberry32
const R = rnd(42);
const states = UF.map(([uf,lon,lat,e,s13])=>({uf,lon,lat,e,s13:s13+(R()-.5)*.04,ab:.17+R()*.08,off:R()*.25,spd:1.2+R()*.8,n:Math.round(e/VPD)}));

// Simulação: t ∈ [0,1] → progresso por UF
function simulate(t){
  for(const s of states){
    const p = Math.max(0,Math.min(1,(t-s.off)*s.spd*1.35));
    const cnt = s.e*p, ab = cnt*s.ab, comp = cnt-ab, br = comp*.016, nu = comp*.032, val = comp-br-nu;
    Object.assign(s,{p,v:{c22:val*(1-s.s13),c13:val*s.s13,br,nu,ab}});
  }
  return totals();
}
function totals(){
  const T={e:0,cnt:0,c22:0,c13:0,br:0,nu:0,ab:0};
  for(const s of states){ T.e+=s.e; T.cnt+=s.e*s.p; for(const c of CATS) T[c]+=s.v[c]; }
  T.p=T.cnt/T.e; return T;
}
// Adaptador TSE real (requer proxy por CORS)
async function loadTSE(base){
  await Promise.all(states.map(async s=>{
    const j = await (await fetch(`${base}/${s.uf.toLowerCase()}/${s.uf.toLowerCase()}-c0001-e000546-r.json`)).json();
    const num = x=>+String(x||0).replace(/\./g,'');
    const g = n=>num((j.cand.find(c=>c.n==n)||{}).vap);
    s.p = parseFloat(String(j.pst).replace(',','.'))/100;
    s.v = {c22:g(22),c13:g(13),br:num(j.vb),nu:num(j.tvn),ab:num(j.a)};
  }));
  return totals();
}

// Cartograma: cada UF = retângulo de pontos, ancorado no centróide, sobreposições resolvidas
function layout(pad=2){
  const K=4.2, it=states.map(s=>{ const w=Math.ceil(Math.sqrt(s.n*1.1)); return {s,w,h:Math.ceil(s.n/w),x:(s.lon+52)*K,y:-(s.lat+14)*K*1.08,ox:(s.lon+52)*K,oy:-(s.lat+14)*K*1.08}; });
  for(let k=0;k<600;k++){
    for(let i=0;i<it.length;i++) for(let j=i+1;j<it.length;j++){
      const a=it[i],b=it[j],dx=b.x-a.x,dy=b.y-a.y;
      const ox=(a.w+b.w)/2+pad-Math.abs(dx), oy=(a.h+b.h)/2+pad-Math.abs(dy);
      if(ox>0&&oy>0){ if(ox<oy){const m=ox/2*Math.sign(dx||1);a.x-=m;b.x+=m;} else {const m=oy/2*Math.sign(dy||1);a.y-=m;b.y+=m;} }
    }
    for(const a of it){ a.x+=(a.ox-a.x)*.02; a.y+=(a.oy-a.y)*.02; }
  }
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const a of it){ a.x=Math.round(a.x-a.w/2); a.y=Math.round(a.y-a.h/2); x0=Math.min(x0,a.x);y0=Math.min(y0,a.y);x1=Math.max(x1,a.x+a.w);y1=Math.max(y1,a.y+a.h); }
  for(const a of it){ a.x-=x0; a.y-=y0; }
  return {it,W:x1-x0,H:y1-y0};
}

// opts: {bg, empty, shape:'sq'|'dot', gap, label, labelFont, frame, colors, onPick}
function DotMap(canvas,opts={}){
  const L=layout(), col={...COLORS,...opts.colors}, dpr=devicePixelRatio||1; let pitch=1;
  function size(){ const w=canvas.clientWidth; pitch=w*dpr/(L.W+2); canvas.width=w*dpr; canvas.height=(L.H+2)*pitch; canvas.style.height=canvas.height/dpr+'px'; }
  function draw(){
    const c=canvas.getContext('2d'), g=pitch*(opts.gap??.18), d=pitch-g;
    c.fillStyle=opts.bg||'#111'; c.fillRect(0,0,canvas.width,canvas.height);
    for(const a of L.it){
      const s=a.s, k=Math.round(s.n*s.p), sum=CATS.reduce((t,c)=>t+s.v[c],0)||1;
      const bounds=[]; let acc=0; for(const ct of CATS){ acc+=s.v[ct]/sum*k; bounds.push(Math.round(acc)); }
      const ox=(a.x+1)*pitch, oy=(a.y+1)*pitch;
      if(opts.frame){ c.strokeStyle=opts.frame; c.lineWidth=dpr; c.strokeRect(ox-g,oy-g,a.w*pitch+g,a.h*pitch+g); }
      for(let i=0,ci=0;i<s.n;i++){
        while(ci<5&&i>=bounds[ci]) ci++;
        c.fillStyle = ci<5 ? col[CATS[ci]] : (opts.empty||'#2a2d33');
        const x=ox+(i%a.w)*pitch, y=oy+Math.floor(i/a.w)*pitch;
        if(opts.shape==='dot'){ c.beginPath(); c.arc(x+d/2,y+d/2,d/2,0,7); c.fill(); } else c.fillRect(x,y,d,d);
      }
      if(opts.label){
        const fs=Math.max(9*dpr,Math.min(a.w,a.h)*pitch*.32); c.font=`700 ${fs}px ${opts.labelFont||'system-ui'}`;
        c.textAlign='center'; c.textBaseline='middle'; const cx=ox+a.w*pitch/2, cy=oy+a.h*pitch/2;
        c.lineWidth=3*dpr; c.strokeStyle=opts.labelStroke||'rgba(0,0,0,.6)'; c.strokeText(s.uf,cx,cy);
        c.fillStyle=opts.label; c.fillText(s.uf,cx,cy);
      }
    }
  }
  canvas.addEventListener('click',e=>{
    if(!opts.onPick) return; const r=canvas.getBoundingClientRect(), x=(e.clientX-r.left)*dpr/pitch-1, y=(e.clientY-r.top)*dpr/pitch-1;
    const a=L.it.find(a=>x>=a.x-1&&x<=a.x+a.w+1&&y>=a.y-1&&y<=a.y+a.h+1); opts.onPick(a&&a.s);
  });
  addEventListener('resize',()=>{size();draw();}); size();
  return {draw};
}

// Loop de simulação (90s de apuração, pausa 6s, reinicia)
function run(update,dur=90){
  const t0=performance.now();
  (function f(){ const t=((performance.now()-t0)/1000)%(dur+6)/dur; update(simulate(Math.min(1,t))); setTimeout(f,250); })();
}
const fmt=n=>Math.round(n).toLocaleString('pt-BR'), pct=(n,d=1)=>(n*100).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
