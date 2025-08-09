// Rhythm Hero Lite v5.3 (Bugfix for Analyze button)
// Includes collapsible panel + robust MP3/WAV/OGG decode + v5 core features (condensed).

/* ====== DOM ====== */
const $ = (s)=>document.querySelector(s);
const fileInput = $('#fileInput');
const analyzeBtn = $('#analyzeBtn');
const playBtn = $('#playBtn');
const pauseBtn = $('#pauseBtn');
const restartBtn = $('#restartBtn');
const latencyInput = $('#latencyInput');
const speedInput = $('#speedInput');
const speedVal = $('#speedVal');
const calibrateBtn = $('#calibrateBtn');
const diffSel = $('#diffSel');
const scoreEl = $('#score');
const comboEl = $('#combo');
const accEl = $('#acc');
const bpmEl = $('#bpm');
const noteCountEl = $('#noteCount');
const exportBtn = $('#exportBtn');
const importInput = $('#importInput');
const hitSfxInput = $('#hitSfxInput');
const missSfxInput = $('#missSfxInput');
const hitVolEl = $('#hitVol');
const missVolEl = $('#missVol');
const statusDot = $('#statusDot');
const fileNameEl = $('#fileName');

const panel = $('#ui');
const panelToggle = $('#panelToggle');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha:false });

/* ====== Audio ====== */
let audioCtx, buffer, source, musicGain;
let startCtxTime=0, startSongTime=0, pausedAt=0;
let gameState = 'idle'; // idle, ready, playing, paused, ended, calibrating, countdown

function ensureAudio(){ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }

/* ====== UI Collapsible ====== */
(function initPanel(){
  const saved = localStorage.getItem('panel-open');
  const wantOpen = saved===null ? true : saved==='true';
  setPanelOpen(wantOpen);
  panelToggle.addEventListener('click', ()=> setPanelOpen(!panel.classList.contains('open')));
  updateCanvasHeightVar();
  window.addEventListener('resize', updateCanvasHeightVar);
  function setPanelOpen(open){
    if(open){ panel.classList.add('open'); panel.classList.remove('closed'); panelToggle.setAttribute('aria-expanded','true'); panel.setAttribute('aria-hidden','false'); }
    else { panel.classList.remove('open'); panel.classList.add('closed'); panelToggle.setAttribute('aria-expanded','false'); panel.setAttribute('aria-hidden','true'); }
    localStorage.setItem('panel-open', String(open));
    updateCanvasHeightVar();
  }
  function updateCanvasHeightVar(){
    const rect = panel.classList.contains('open') ? panel.getBoundingClientRect() : {height:0};
    document.documentElement.style.setProperty('--uiHeight', rect.height+'px');
    resizeCanvas();
  }
})();

/* ====== SFX ====== */
let hitSfxBuf=null, missSfxBuf=null;
async function loadSfx(input, setBuffer){
  if(!input.files || !input.files[0]) return;
  ensureAudio();
  try{
    const ab = await input.files[0].arrayBuffer();
    const b = await audioCtx.decodeAudioData(ab);
    setBuffer(b);
  }catch{ alert('Gagal memuat SFX. Coba format lain.'); }
}
hitSfxInput?.addEventListener('change', ()=>loadSfx(hitSfxInput,(b)=>hitSfxBuf=b));
missSfxInput?.addEventListener('change', ()=>loadSfx(missSfxInput,(b)=>missSfxBuf=b));
function playSfx(buf, volume=0.6){
  ensureAudio();
  if (buf){
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(audioCtx.destination);
    src.start();
    return true;
  }
  return false;
}
function synthHit(v=0.7){ ensureAudio(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='triangle'; o.frequency.setValueAtTime(660,t); o.frequency.exponentialRampToValueAtTime(990,t+.03); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.08); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.09); }
function synthMiss(v=0.6){ ensureAudio(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='sawtooth'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(140,t+.12); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+.14); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.16); }
function doHitSfx(){ const v=parseFloat(hitVolEl.value||0.7); if(!playSfx(hitSfxBuf,v)) synthHit(v); }
function doMissSfx(){ const v=parseFloat(missVolEl.value||0.6); if(!playSfx(missSfxBuf,v)) synthMiss(v); }

/* ====== File loading (Bugfix: robust enable Analyze) ====== */
fileInput.addEventListener('change', async ()=>{
  const f = fileInput.files?.[0];
  analyzeBtn.disabled = true; playBtn.disabled = true; pauseBtn.disabled = true; restartBtn.disabled = true;
  statusDot.className=''; fileNameEl.textContent='—';
  if(!f){ return; }
  fileNameEl.textContent = f.name;
  try{
    const ab = await f.arrayBuffer();
    ensureAudio();
    buffer = await audioCtx.decodeAudioData(ab);
    statusDot.className='ok'; // green
    analyzeBtn.disabled = false;  // <— ensure clickable after decode success
    gameState='idle';
  }catch(err){
    console.error('Audio decode failed:', err);
    statusDot.className='err';
    alert('Maaf, file tidak bisa dibuka. Coba format MP3/WAV/OGG dan pastikan browser terbaru.');
    buffer = null;
  }
});

/* ====== Analyze ====== */
let notes=[]; let speedMultiplier=1.0;
let hitStats={score:0,hits:0,total:0,combo:0,maxCombo:0};
speedInput.addEventListener('input',()=>{ speedMultiplier=parseFloat(speedInput.value); speedVal.textContent = speedMultiplier.toFixed(2)+'x'; });

analyzeBtn.addEventListener('click', async ()=>{
  if(!buffer){ alert('Unggah lagu dulu.'); return; }
  analyzeBtn.disabled = true;
  try{
    notes = await generateChart(buffer, diffSel.value);
    noteCountEl.textContent = notes.length;
    hitStats = {score:0,hits:0,total:notes.length,combo:0,maxCombo:0};
    playBtn.disabled = false; restartBtn.disabled = true; pauseBtn.disabled = true;
    gameState = 'ready';
  } catch(e){
    alert('Analisis gagal. Coba ulangi.');
    console.error(e);
  } finally {
    analyzeBtn.disabled = false; // re-enable to allow re-analyze
  }
});

/* ====== Playback & drawing (condensed, from v5) ====== */
const canvasCtx = ctx;
const LANES=4, JUDGE=.85;
let W=0,H=0;
function resizeCanvas(){ canvas.width=innerWidth; canvas.height=Math.max(160, Math.round(innerHeight * 0.62)); W=canvas.width; H=canvas.height; draw(0,'idle',0); }
window.addEventListener('resize', resizeCanvas); resizeCanvas();
const particles=[];
function makeSpark(x,y,color,p=22){const arr=[];for(let i=0;i<14;i++){const a=(Math.PI*2)*i/14+Math.random()*.2;const sp=p*(.5+Math.random());arr.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.18+Math.random()*.12,color})}return {sparks:arr}}
function drawParticles(dt){const c=canvasCtx; c.save();for(let p=particles.length-1;p>=0;p--){const sys=particles[p];let alive=false;for(const s of sys.sparks){s.life-=dt;if(s.life>0){alive=true;s.vy+=80*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;c.globalAlpha=Math.max(0,Math.min(1,s.life*5));c.fillStyle=s.color;c.fillRect(s.x,s.y,2,2)}}if(!alive)particles.splice(p,1)}c.restore()}
function draw(t,mode,dt){const c=canvasCtx; c.fillStyle='#0a0a0a'; c.fillRect(0,0,W,H); const laneW=W/LANES; for(let i=0;i<LANES;i++){c.fillStyle=['var(--lane0)','var(--lane1)','var(--lane2)','var(--lane3)'][i]; c.globalAlpha=.1; c.fillRect(i*laneW,0,laneW,H);} c.globalAlpha=1; const judgeY=H*JUDGE; c.strokeStyle='#ffffff40'; c.lineWidth=3; c.beginPath(); c.moveTo(0,judgeY); c.lineTo(W,judgeY); c.stroke(); if(mode==='playing'){const pxPerSec=350*speedMultiplier,windowAfter=6; for(const n of notes){const d=n.t-t; if(d>windowAfter)break; const y=judgeY - d*pxPerSec; const x=(n.lane+.5)*laneW; const w=laneW*.68; if(n.end!=null){ const endY=judgeY - (n.end-t)*pxPerSec; c.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane]+'AA'; c.fillRect(x-w*.35, Math.min(y,endY), w*.7, Math.abs(endY-y)); } const h=18; const near=Math.abs(y-judgeY)<24; c.shadowBlur=near?18:0; c.shadowColor=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane]; c.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane]; c.fillRect(x-w/2, y-h/2, w, h); } c.fillStyle='#ffffff'; c.globalAlpha=.12; c.fillRect(0,judgeY-40,W,80); c.globalAlpha=1; } else if(mode==='countdown'){const elapsed=performance.now()/1000 - countdownState.startAt; const remain=Math.max(0,3-elapsed); let text= remain>2?'3': remain>1?'2': remain>0?'1':'GO!'; c.fillStyle='#e5e7eb'; c.font='bold 48px system-ui,sans-serif'; c.textAlign='center'; c.fillText(text, W/2, H*.4);} drawParticles(dt); }
function audioTime(){ if(!audioCtx) return 0; return (audioCtx.currentTime-startCtxTime)+startSongTime }
let sourceRef=null, musicGain=null;
function startPlayback(){ ensureAudio(); sourceRef=audioCtx.createBufferSource(); musicGain=audioCtx.createGain(); sourceRef.buffer=buffer; sourceRef.connect(musicGain).connect(audioCtx.destination); const offset=(gameState==='paused')?pausedAt:0; startCtxTime=audioCtx.currentTime; startSongTime=offset; sourceRef.start(0,offset); sourceRef.onended=()=>{ if(gameState==='playing') gameState='ended'; }; hitStats={score:0,hits:0,total:notes.length,combo:0,maxCombo:0}; gameState='playing'; playBtn.disabled=true; pauseBtn.disabled=false; restartBtn.disabled=false; requestAnimationFrame(loop); }
function stopPlayback(pause=false){ try{ sourceRef?.stop(); }catch{} const elapsed=audioTime(); if(pause){ gameState='paused'; pausedAt=elapsed; } else { gameState='ready'; pausedAt=0; } playBtn.disabled=false; pauseBtn.disabled=true; }
let countdownState={running:false,startAt:0};
playBtn.addEventListener('click', ()=>{ if(buffer){ countdownState={running:true,startAt:performance.now()/1000}; gameState='countdown'; requestAnimationFrame(loop); setTimeout(()=>startPlayback(),3000); } });
pauseBtn.addEventListener('click', ()=>{ if(gameState==='playing') stopPlayback(true); });
restartBtn.addEventListener('click', ()=>{ if(buffer){ stopPlayback(false); playBtn.click(); } });

function loop(){ const now=performance.now()/1000; if(!loop._last) loop._last=now; const dt=now-loop._last; loop._last=now; const mode=gameState; let t=0; if(mode==='playing'){ t=audioTime()+parseInt(latencyInput.value||0)/1000; // auto-miss
  const goodWin=.18;
  for(let i=notes.length-1;i>=0;i--){ const n=notes[i]; if(n.t < t - goodWin){ notes.splice(i,1); hitStats.combo=0; doMissSfx(); noteCountEl.textContent=notes.length; comboEl.textContent=hitStats.combo; } }
} draw(t, mode, dt); if(mode==='playing'||mode==='countdown') requestAnimationFrame(loop); }

/* ====== Input (tap on canvas & lane buttons) ====== */
function laneFromX(x){ const laneW=W/LANES; return Math.max(0, Math.min(LANES-1, Math.floor(x/laneW))); }
function handleTapClientXY(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const lane = laneFromX(clientX - rect.left);
  judgeHit({lane});
}
canvas.addEventListener('mousedown', (e)=>handleTapClientXY(e.clientX,e.clientY));
canvas.addEventListener('touchstart', (e)=>{ const t=e.changedTouches[0]; if(!t) return; e.preventDefault(); handleTapClientXY(t.clientX,t.clientY); }, {passive:false});
document.getElementById('touchLanes').addEventListener('touchstart', (e)=>{
  const t = e.target.closest('button[data-lane]'); if (!t) return; e.preventDefault(); judgeHit({lane:parseInt(t.dataset.lane,10)});
});

/* ====== Judging (short) ====== */
const HIT_WINDOWS={perfect:.10,good:.18};
function judgeHit({lane}){
  if (gameState!=='playing') return;
  const t = audioTime() + parseInt(latencyInput.value||0)/1000;
  let idx = -1, bestErr = 1e9, note=null;
  for (let i=0;i<notes.length;i++){
    const n = notes[i]; if (n.lane!==lane) continue;
    const err = Math.abs(n.t - t);
    if (err < bestErr){ bestErr = err; idx=i; note=n; }
  }
  if (idx===-1 || bestErr > HIT_WINDOWS.good) {
    hitStats.combo = 0; comboEl.textContent = hitStats.combo; doMissSfx(); return;
  }
  notes.splice(idx,1);
  noteCountEl.textContent = notes.length;
  const perfect = bestErr <= HIT_WINDOWS.perfect;
  const add = perfect ? 1000 : 500;
  hitStats.score += add + Math.min(hitStats.combo*5, 500);
  hitStats.combo++; hitStats.hits++; hitStats.maxCombo = Math.max(hitStats.maxCombo, hitStats.combo);
  scoreEl.textContent = hitStats.score; comboEl.textContent = hitStats.combo;
  const acc = hitStats.hits / Math.max(1, hitStats.total) * 100; accEl.textContent = acc.toFixed(1) + '%';
  doHitSfx();
  if (perfect){
    const laneW=W/LANES; const x=(lane+0.5)*laneW; const y=H*JUDGE; particles.push(makeSpark(x,y,['#93c5fd','#86efac','#fde68a','#fca5a5'][lane],26));
  }
}

/* ====== Analysis: spectral-flux (condensed) ====== */
function toMono(buffer){
  const chs = buffer.numberOfChannels; const len = buffer.length;
  const tmp = new Float32Array(len);
  for (let c=0;c<chs;c++){ buffer.getChannelData(c).forEach((v,i)=> tmp[i]+=v/chs); }
  return tmp;
}
async function generateChart(buffer, difficulty='normal'){
  const sr = buffer.sampleRate; const mono = toMono(buffer);
  const hop = 512, frame = 1024; const nFrames = Math.floor((mono.length - frame) / hop);
  const win = new Float32Array(frame); for (let i=0;i<frame;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(frame-1)));
  const prevMag = new Float32Array(frame/2+1); prevMag.fill(0);
  const flux = new Float32Array(nFrames); let idx=0;
  for (let i=0;i<nFrames;i++){
    const seg = new Float32Array(frame);
    for (let j=0;j<frame;j++) seg[j] = (mono[idx+j]||0) * win[j];
    const N=frame, kmax=N/2; let sf=0;
    for (let k=0;k<=kmax;k++){
      let re=0, im=0;
      for (let n=0;n<N;n++){ const ang=2*Math.PI*k*n/N; re += seg[n]*Math.cos(ang); im -= seg[n]*Math.sin(ang); }
      const mag=Math.sqrt(re*re+im*im);
      const d=Math.max(0, mag-prevMag[k]); sf+=d; prevMag[k]=mag;
    }
    flux[i]=Math.log10(1e-8+sf); idx+=hop;
  }
  const mean = flux.reduce((a,b)=>a+b,0)/nFrames;
  const std = Math.sqrt(flux.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
  const norm = Array.from(flux, e=>(e-mean)/(std||1));

  const thrWin = 16; const peaks=[];
  for (let i=thrWin;i<nFrames-thrWin;i++){
    let local=0; for (let k=-thrWin;k<=thrWin;k++) local += norm[i+k];
    local /= (2*thrWin+1);
    const v = norm[i] - local;
    const isMax = norm[i]>=norm[i-1] && norm[i]>=norm[i+1];
    if (v>0.8 && isMax){ const t = (i*hop + frame/2)/sr; peaks.push(t); }
  }

  const IOI=[]; for (let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]);
  let bpm=120;
  if (IOI.length){
    const hist=new Map();
    for (const d of IOI){
      if (d<=0) continue; let b=60/d;
      while (b<60) b*=2; while (b>190) b/=2;
      const key=Math.round(b); hist.set(key,(hist.get(key)||0)+1);
    }
    let best=120,count=-1; for (const [k,v] of hist.entries()){ if(v>count){ count=v; best=k; } } bpm=best;
  }
  bpmEl.textContent = bpm;

  const beat = 60/bpm; // phase align
  let bestOff=0, bestErr=1e9;
  for (let s=0;s<48;s++){
    const off=s*(beat/48); let err=0,cnt=0;
    for (const t of peaks){ const r=(t-off)%beat; const d=Math.min(r,beat-r); err+=d*d; cnt++; }
    if (cnt && err<bestErr){ bestErr=err; bestOff=off; }
  }

  let grid=beat/2, keep=1.0;
  if (difficulty==='easy'){ grid=beat/1; keep=0.6; }
  if (difficulty==='hard'){ grid=beat/4; keep=1.0; }

  const times=[]; let last=-999;
  for (const t of peaks){
    if (Math.random()>keep) continue;
    const q = Math.round((t - bestOff) / grid) * grid + bestOff;
    if (q - last > 0.08){ times.push(q); last=q; }
  }

  function laneForTime(t){
    const i = Math.max(0, Math.min(mono.length-2, Math.floor(t*sr)));
    const span = Math.floor(0.02*sr);
    let z=0; for (let k=1;k<span;k++){ const a=mono[i-k], b=mono[i-k-1]; if ((a>=0&&b<0)||(a<0&&b>=0)) z++; }
    const val = (z*1315423911 + i) >>> 0; return val % 4;
  }

  const chart=[];
  for (let i=0;i<times.length;i++){
    const t = times[i]; const lane=laneForTime(t);
    const next = times[i+1] ?? (t + 2*beat);
    const gap = next - t;
    let end=null; if (gap > beat*0.9 && Math.random()<0.35) end = t + Math.min(gap*0.8, 1.2);
    chart.push(end?{t,lane,end}:{t,lane});
  }
  const dur = buffer.duration;
  return chart.filter(n=>n.t>0.5 && n.t<dur-0.2).sort((a,b)=>a.t-b.t);
}
