// Rhythm Hero Lite v5.2 — Collapsible Panel + MP3 + v5 FULL features
// This file builds upon the v5 FULL logic, adding panel toggle & dynamic layout.

/* ---------- Helpers & elements ---------- */
const $ = (s)=>document.querySelector(s);
const ui = $('#ui');
const panelToggle = $('#panelToggle');
const panelBody = $('#panelBody');
const canvas = $('#game');
const ctx = canvas.getContext('2d', {alpha:false});
const lanesBar = $('#touchLanes');

// Elements reused from v5 FULL
const fileInput = $('#fileInput'), analyzeBtn = $('#analyzeBtn'), playBtn = $('#playBtn'), pauseBtn = $('#pauseBtn'), restartBtn = $('#restartBtn');
const latencyInput = $('#latencyInput'), speedInput = $('#speedInput'), speedVal = $('#speedVal'), calibrateBtn = $('#calibrateBtn'), diffSel = $('#diffSel');
const scoreEl = $('#score'), comboEl = $('#combo'), accEl = $('#acc'), bpmEl = $('#bpm'), noteCountEl = $('#noteCount');
const exportBtn = $('#exportBtn'), importInput = $('#importInput');
const hitSfxInput = $('#hitSfxInput'), missSfxInput = $('#missSfxInput'), hitVolEl = $('#hitVol'), missVolEl = $('#missVol');

/* ---------- Collapsible Panel ---------- */
function setCollapsed(c){
  ui.classList.toggle('collapsed', c);
  panelToggle.setAttribute('aria-expanded', String(!c));
  localStorage.setItem('rh-hero-collapsed', c?'1':'0');
  layout();
}
panelToggle.addEventListener('click', ()=> setCollapsed(!ui.classList.contains('collapsed')));
(function initCollapse(){
  const saved = localStorage.getItem('rh-hero-collapsed');
  setCollapsed(saved === null ? true : saved === '1');
})();

/* ---------- Dynamic Layout ---------- */
function layout(){
  // Compute available height: viewport - header - lanes
  const vh = window.innerHeight;
  const headerH = ui.getBoundingClientRect().height;
  const lanesH = lanesBar.getBoundingClientRect().height;
  const pad = 4;
  const h = Math.max(180, Math.round(vh - headerH - lanesH - pad));
  canvas.width = window.innerWidth;
  canvas.height = h;
  W = canvas.width; H = canvas.height;
}
window.addEventListener('resize', layout);

/* ---------- Game State (v5 FULL core) ---------- */
let audioCtx, buffer, source, musicGain;
let startCtxTime = 0, startSongTime = 0, pausedAt = 0;
let gameState = 'idle'; // idle, ready, playing, paused, ended, calibrating, countdown

let notes = []; // {t, lane, end?}
let speedMultiplier = 1.0;
let hitStats = {score:0, hits:0, total:0, combo:0, maxCombo:0};
const holdsDown = new Map();
const activeHolds = new Map();
let hitSfxBuf = null, missSfxBuf = null;

const LANES = 4;
const JUDGE_LINE_Y_RATIO = 0.85;
let W=0, H=0;

function ensureAudio(){ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }

// SFX loaders
async function loadSfxFromInput(input, setBufferCb){
  if (!input.files || !input.files[0]) return;
  ensureAudio();
  const buf = await audioCtx.decodeAudioData(await input.files[0].arrayBuffer());
  setBufferCb(buf);
}
hitSfxInput?.addEventListener('change', ()=>loadSfxFromInput(hitSfxInput, b=>hitSfxBuf=b));
missSfxInput?.addEventListener('change', ()=>loadSfxFromInput(missSfxInput, b=>missSfxBuf=b));

function playSfx(buf, volume=0.6){
  ensureAudio();
  if (buf){
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = volume;
    src.connect(g).connect(audioCtx.destination);
    src.start(); return true;
  }
  return false;
}
function synthHit(volume=0.7){ ensureAudio(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='triangle'; o.frequency.setValueAtTime(660,t); o.frequency.exponentialRampToValueAtTime(990,t+0.03); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(volume,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+0.08); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.09); }
function synthMiss(volume=0.6){ ensureAudio(); const o=audioCtx.createOscillator(), g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='sawtooth'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(140,t+0.12); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(volume,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.14); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.16); }
function doHitSfx(){ const v=parseFloat(hitVolEl.value||0.7); if(!playSfx(hitSfxBuf,v)) synthHit(v); }
function doMissSfx(){ const v=parseFloat(missVolEl.value||0.6); if(!playSfx(missSfxBuf,v)) synthMiss(v); }

// Inputs
const activeLanes = new Set();
function pressLane(l){ activeLanes.add(l); holdsDown.set(l,true); judgeHit({lane:l}); }
function releaseLane(l){ activeLanes.delete(l); holdsDown.set(l,false); judgeHoldRelease(l); }

lanesBar.addEventListener('touchstart', (e)=>{ const t=e.target.closest('button[data-lane]'); if(!t) return; e.preventDefault(); pressLane(parseInt(t.dataset.lane,10)); });
lanesBar.addEventListener('touchend', (e)=>{ const t=e.target.closest('button[data-lane]'); if(!t) return; e.preventDefault(); releaseLane(parseInt(t.dataset.lane,10)); });
document.addEventListener('keydown', (e)=>{ const m={a:0,s:1,d:2,f:3}; const l=m[e.key.toLowerCase()]; if(l!=null) pressLane(l); });
document.addEventListener('keyup', (e)=>{ const m={a:0,s:1,d:2,f:3}; const l=m[e.key.toLowerCase()]; if(l!=null) releaseLane(l); });

// Tap on canvas
function laneFromX(x){ const laneW=W/LANES; return Math.max(0, Math.min(LANES-1, Math.floor(x/laneW))); }
canvas.addEventListener('mousedown', (e)=>{ const r=canvas.getBoundingClientRect(); pressLane(laneFromX(e.clientX-r.left)); setTimeout(()=>releaseLane(laneFromX(e.clientX-r.left)),40); });
canvas.addEventListener('touchstart', (e)=>{ const t=e.changedTouches[0]; if(!t) return; e.preventDefault(); const r=canvas.getBoundingClientRect(); const lane=laneFromX(t.clientX-r.left); pressLane(lane); setTimeout(()=>releaseLane(lane),40); }, {passive:false});

// MP3-aware loader with friendly errors
fileInput.addEventListener('change', async ()=>{
  if(!fileInput.files[0]) return;
  try{
    ensureAudio();
    buffer = await audioCtx.decodeAudioData(await fileInput.files[0].arrayBuffer());
    analyzeBtn.disabled = false; playBtn.disabled = true; restartBtn.disabled = true; pauseBtn.disabled = true;
  }catch(err){
    alert('Maaf, file tidak bisa dibuka. Coba MP3/WAV/OGG lain atau gunakan browser terbaru (Chrome/Safari/Edge).');
    console.error(err);
  }
});

// Controls
speedInput.addEventListener('input', ()=>{ speedMultiplier=parseFloat(speedInput.value); speedVal.textContent = speedMultiplier.toFixed(2)+'x'; });

analyzeBtn.addEventListener('click', async ()=>{
  if (!buffer) return;
  notes = await generateChart(buffer, diffSel.value);
  noteCountEl.textContent = notes.length;
  playBtn.disabled = false; restartBtn.disabled = true; pauseBtn.disabled = true;
  gameState = 'ready';
});
playBtn.addEventListener('click', ()=>{ if(buffer) startCountdownThenPlay(); });
pauseBtn.addEventListener('click', ()=>{ if (gameState==='playing') stopPlayback(true); });
restartBtn.addEventListener('click', ()=>{ if (buffer){ stopPlayback(false); startCountdownThenPlay(); }});

// Export/Import
exportBtn.addEventListener('click', ()=>{
  const data = { version:'v5.2', notes, meta:{ bpm:bpmEl.textContent } };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='chart.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
});
importInput.addEventListener('change', async ()=>{
  const f = importInput.files?.[0]; if(!f) return;
  try{ const data = JSON.parse(await f.text()); notes = (data.notes||[]).map(n=>({t:n.t,lane:n.lane,end:n.end})).sort((a,b)=>a.t-b.t); noteCountEl.textContent = notes.length; gameState='ready'; playBtn.disabled=false; }
  catch{ alert('File chart tidak valid.'); }
});

/* ---------- Calibration ---------- */
let calState = { running:false, schedule:[], tapTimes:[], startTime:0 };
calibrateBtn.addEventListener('click', ()=>{ if (gameState==='playing') { alert('Jeda/berhenti dulu sebelum kalibrasi.'); return; } startCalibration(); });
function startCalibration(){
  ensureAudio(); gameState='calibrating'; calState.running=true; calState.schedule=[]; calState.tapTimes=[];
  const bpm=120, beat=60/bpm, N=16; const t0=audioCtx.currentTime + 0.6; calState.startTime=t0;
  for (let i=0;i<N;i++){ const t = t0+i*beat; calState.schedule.push(t); playClick(t, (i%4===0)); }
  setTimeout(()=>finishCalibration(), Math.ceil((N*beat+1.0)*1000));
}
function playClick(atTime, strong=false){
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='square'; o.frequency.setValueAtTime(strong?1200:900, atTime);
  g.gain.setValueAtTime(0, atTime); g.gain.linearRampToValueAtTime(strong?0.35:0.25, atTime+0.001); g.gain.exponentialRampToValueAtTime(0.0001, atTime+0.08);
  o.connect(g).connect(audioCtx.destination); o.start(atTime); o.stop(atTime+0.1);
}
function registerCalibrationTap(){ if(!calState.running) return; calState.tapTimes.push(audioCtx.currentTime); }
canvas.addEventListener('click', ()=>{ if (gameState==='calibrating') registerCalibrationTap(); });
function finishCalibration(){
  if (!calState.running) return;
  calState.running=false; gameState='ready';
  const deltas=[];
  for (const tap of calState.tapTimes){
    let best=null, be=1e9; for (const t of calState.schedule){ const e=Math.abs(tap-t); if(e<be){be=e; best=t;} }
    if (best!==null && be<0.25) deltas.push((tap-best)*1000);
  }
  if (deltas.length<6){ alert('Kalibrasi kurang data. Ulangi.'); return; }
  deltas.sort((a,b)=>a-b); const median=deltas[Math.floor(deltas.length/2)]; latencyInput.value = String(Math.round(median/5)*5);
}

/* ---------- Playback ---------- */
let countdownState = { running:false, startAt:0 };
function startCountdownThenPlay(){
  ensureAudio();
  countdownState.running=true; countdownState.startAt=performance.now()/1000; gameState='countdown';
  requestAnimationFrame(loop);
  setTimeout(()=>startPlayback(), 3000);
}
function startPlayback(){
  ensureAudio();
  source = audioCtx.createBufferSource(); musicGain = audioCtx.createGain();
  source.buffer = buffer; source.connect(musicGain).connect(audioCtx.destination);
  const offset = gameState==='paused' ? pausedAt : 0;
  startCtxTime = audioCtx.currentTime; startSongTime = offset;
  source.start(0, offset);
  source.onended = ()=>{ if (gameState==='playing') gameState='ended'; };
  hitStats = {score:0, hits:0, total:notes.length, combo:0, maxCombo:0};
  holdsDown.clear(); activeHolds.clear();
  scoreEl.textContent = 0; comboEl.textContent = 0; accEl.textContent = '0%';
  gameState='playing'; playBtn.disabled = true; pauseBtn.disabled = false; restartBtn.disabled = false;
  requestAnimationFrame(loop);
}
function stopPlayback(pause=false){
  try{ source.stop(); }catch{}
  const elapsed = audioTime();
  if (pause){ gameState='paused'; pausedAt = elapsed; } else { gameState='ready'; pausedAt = 0; }
  playBtn.disabled = false; pauseBtn.disabled = true;
}
function audioTime(){ if (!audioCtx) return 0; return (audioCtx.currentTime - startCtxTime) + startSongTime; }

/* ---------- Rendering & Judging ---------- */
const particles = [];
function makeSpark(x, y, color, power=22){
  const arr=[]; for (let i=0;i<14;i++){ const a=(Math.PI*2)*i/14 + Math.random()*0.2; const sp=power*(0.5+Math.random()); arr.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.18+Math.random()*0.12,color}); }
  return { sparks:arr };
}
function drawParticles(dt){
  ctx.save();
  for (let p=particles.length-1;p>=0;p--){
    const sys=particles[p]; let alive=false;
    for (const s of sys.sparks){
      s.life -= dt; if (s.life>0){ alive=true; s.vy += 80*dt; s.x += s.vx*dt; s.y += s.vy*dt; ctx.globalAlpha = Math.max(0, Math.min(1, s.life*5)); ctx.fillStyle=s.color; ctx.fillRect(s.x,s.y,2,2); }
    }
    if (!alive) particles.splice(p,1);
  }
  ctx.restore();
}

const HIT_WINDOWS = { perfect:0.10, good:0.18 };
function loop(){
  const now = performance.now()/1000;
  if (!loop._last) loop._last = now;
  const dt = now - loop._last; loop._last = now;
  const mode = gameState;
  let t = 0;
  if (mode==='playing'){ t = audioTime() + parseInt(latencyInput.value||0)/1000; }
  draw(t, mode, dt);
  if (mode==='playing'){
    for (let i=notes.length-1;i>=0;i--){
      const n=notes[i];
      if (n.t < t - HIT_WINDOWS.good){
        notes.splice(i,1);
        if (n.end!=null && activeHolds.get(n.lane)) activeHolds.delete(n.lane);
        hitStats.combo = 0; doMissSfx();
        noteCountEl.textContent = notes.length; comboEl.textContent = hitStats.combo;
      }
    }
    for (const [lane, hold] of Array.from(activeHolds.entries())){
      if (t >= hold.end - 0.02){
        activeHolds.delete(lane);
        hitStats.score += 150; scoreEl.textContent = hitStats.score;
      }
    }
  }
  if (mode==='playing' || mode==='calibrating' || mode==='countdown') requestAnimationFrame(loop);
}
function draw(t, mode, dt){
  ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
  const laneW = W / LANES;
  for (let i=0;i<LANES;i++){
    ctx.fillStyle = ['var(--lane0)','var(--lane1)','var(--lane2)','var(--lane3)'][i];
    ctx.globalAlpha = 0.1; ctx.fillRect(i*laneW,0,laneW,H); ctx.globalAlpha = 1;
  }
  const judgeY = H*JUDGE_LINE_Y_RATIO;
  ctx.strokeStyle='#ffffff40'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,judgeY); ctx.lineTo(W,judgeY); ctx.stroke();

  if (mode==='playing'){
    const pxPerSec = 350 * speedMultiplier; const windowAfter = 6.0;
    for (const n of notes){
      const dtN = n.t - t; if (dtN > windowAfter) break;
      const y = judgeY - dtN * pxPerSec;
      const x = (n.lane + 0.5) * (W / LANES);
      const w = (W/LANES)*0.68;
      if (n.end!=null){
        const endY = judgeY - (n.end - t) * pxPerSec;
        ctx.fillStyle = ['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane] + 'AA';
        ctx.fillRect(x - w*0.35, Math.min(y,endY), w*0.7, Math.abs(endY - y));
      }
      const h = 18; const near = Math.abs(y - judgeY) < 24;
      ctx.shadowBlur = near?18:0; ctx.shadowColor=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane];
      ctx.fillStyle = ['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane];
      ctx.fillRect(x - w/2, y - h/2, w, h);
    }
    ctx.fillStyle='#ffffff'; ctx.globalAlpha=0.12; ctx.fillRect(0,judgeY-40,W,80); ctx.globalAlpha=1;
  } else if (mode==='calibrating'){
    ctx.fillStyle = '#e5e7eb'; ctx.font='16px system-ui, sans-serif'; ctx.fillText('Kalibrasi: dengarkan klik metronom dan tap pada setiap klik.', 12, 26);
  } else if (mode==='countdown'){
    const elapsed = performance.now()/1000 - countdownState.startAt;
    const remain = Math.max(0, 3 - elapsed);
    let text = remain>2 ? '3' : remain>1 ? '2' : remain>0 ? '1' : 'GO!';
    ctx.fillStyle = '#e5e7eb'; ctx.font='bold 48px system-ui, sans-serif'; ctx.textAlign='center'; ctx.fillText(text, W/2, H*0.4);
  }
  drawParticles(dt);
}
function judgeHit({lane}){
  if (gameState!=='playing') return;
  const t = audioTime() + parseInt(latencyInput.value||0)/1000;
  let idx=-1, best=1e9, note=null;
  for (let i=0;i<notes.length;i++){
    const n=notes[i]; if (n.lane!==lane) continue;
    const e=Math.abs(n.t - t);
    if (e<best){ best=e; idx=i; note=n; }
  }
  if (idx===-1 || best>HIT_WINDOWS.good){ hitStats.combo=0; comboEl.textContent=hitStats.combo; doMissSfx(); return; }
  notes.splice(idx,1);
  noteCountEl.textContent = notes.length;
  const perfect = best <= HIT_WINDOWS.perfect;
  const add = perfect ? 1000 : 500;
  hitStats.score += add + Math.min(hitStats.combo*5, 500);
  hitStats.combo++; hitStats.hits++; hitStats.maxCombo = Math.max(hitStats.maxCombo, hitStats.combo);
  scoreEl.textContent = hitStats.score; comboEl.textContent = hitStats.combo;
  const acc = hitStats.hits / Math.max(1, hitStats.total) * 100; accEl.textContent = acc.toFixed(1) + '%';
  doHitSfx();
  if (perfect){ const laneW=W/LANES; const x=(lane+0.5)*laneW; const y=H*JUDGE_LINE_Y_RATIO; particles.push(makeSpark(x,y,['#93c5fd','#86efac','#fde68a','#fca5a5'][lane],26)); }
  if (note.end!=null){ activeHolds.set(lane, { end: note.end, judged:true }); if (!holdsDown.get(lane)) holdsDown.set(lane,true); }
}
function judgeHoldRelease(lane){
  if (!activeHolds.has(lane) || gameState!=='playing') return;
  const t = audioTime() + parseInt(latencyInput.value||0)/1000;
  const hold = activeHolds.get(lane);
  if (t < hold.end - 0.05){ activeHolds.delete(lane); hitStats.combo=0; comboEl.textContent=hitStats.combo; doMissSfx(); }
  else { activeHolds.delete(lane); }
}

/* ---------- Analysis (Spectral Flux + alignment) ---------- */
function toMono(buffer){
  const chs = buffer.numberOfChannels, len=buffer.length; const out=new Float32Array(len);
  for (let c=0;c<chs;c++){ const d=buffer.getChannelData(c); for (let i=0;i<len;i++) out[i]+=d[i]/chs; }
  return out;
}
async function generateChart(buffer, difficulty='normal'){
  const sr=buffer.sampleRate, mono=toMono(buffer);
  const hop=512, frame=1024, nFrames=Math.floor((mono.length-frame)/hop);
  const win=new Float32Array(frame); for (let i=0;i<frame;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(frame-1)));
  const prevMag=new Float32Array(frame/2+1); prevMag.fill(0);
  const flux=new Float32Array(nFrames);
  let idx=0;
  for (let i=0;i<nFrames;i++){
    const seg=new Float32Array(frame); for (let j=0;j<frame;j++) seg[j]=(mono[idx+j]||0)*win[j];
    const N=frame, kmax=N/2; let sf=0;
    for (let k=0;k<=kmax;k++){
      let re=0, im=0;
      for (let n=0;n<N;n++){ const ang=2*Math.PI*k*n/N; re+=seg[n]*Math.cos(ang); im-=seg[n]*Math.sin(ang); }
      const mag=Math.sqrt(re*re+im*im);
      const d=Math.max(0, mag - prevMag[k]); sf+=d; prevMag[k]=mag;
    }
    flux[i]=Math.log10(1e-8+sf); idx+=hop;
  }
  const mean=flux.reduce((a,b)=>a+b,0)/nFrames;
  const std=Math.sqrt(flux.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
  const norm=Array.from(flux, e=>(e-mean)/(std||1));

  const thrWin=16, peaks=[];
  for (let i=thrWin;i<nFrames-thrWin;i++){
    let local=0; for (let k=-thrWin;k<=thrWin;k++) local+=norm[i+k]; local/=(2*thrWin+1);
    const v=norm[i]-local; const isMax=norm[i]>=norm[i-1]&&norm[i]>=norm[i+1];
    if (v>0.8 && isMax){ peaks.push((i*hop + frame/2)/sr); }
  }
  const IOI=[]; for (let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]);
  let bpm=120;
  if (IOI.length){
    const hist=new Map();
    for (const d of IOI){ if (d<=0) continue; let b=60/d; while(b<60) b*=2; while(b>190) b/=2; const key=Math.round(b); hist.set(key,(hist.get(key)||0)+1); }
    let best=120,count=-1; for (const [k,v] of hist.entries()){ if (v>count){count=v; best=k;} } bpm=best;
  }
  bpmEl.textContent = bpm;
  const beat=60/bpm;
  let bestOff=0,bestErr=1e9;
  for (let s=0;s<48;s++){ const off=s*(beat/48); let err=0,cnt=0; for (const t of peaks){ const r=(t-off)%beat; const d=Math.min(r,beat-r); err+=d*d; cnt++; } if (cnt && err<bestErr){ bestErr=err; bestOff=off; } }

  let grid=beat/2, keep=1.0;
  if (difficulty==='easy'){ grid=beat/1; keep=0.6; }
  if (difficulty==='hard'){ grid=beat/4; keep=1.0; }

  const times=[]; let last=-999;
  for (const t of peaks){
    if (Math.random()>keep) continue;
    const q=Math.round((t-bestOff)/grid)*grid + bestOff;
    if (q - last > 0.08){ times.push(q); last=q; }
  }
  function laneForTime(t){
    const i=Math.max(0, Math.min(mono.length-2, Math.floor(t*sr)));
    const span=Math.floor(0.02*sr); let z=0;
    for (let k=1;k<span;k++){ const a=mono[i-k], b=mono[i-k-1]; if ((a>=0&&b<0)||(a<0&&b>=0)) z++; }
    const val=(z*1315423911 + i)>>>0; return val%4;
  }
  const chart=[];
  for (let i=0;i<times.length;i++){
    const t=times[i], lane=laneForTime(t);
    const next=times[i+1] ?? (t + 2*beat);
    const gap = next - t;
    let end=null;
    if (gap > beat*0.9 && Math.random()<0.35) end = t + Math.min(gap*0.8, 1.2);
    chart.push(end ? {t,lane,end} : {t,lane});
  }
  const dur=buffer.duration;
  const filtered=chart.filter(n=>n.t>0.5 && n.t<dur-0.2).sort((a,b)=>a.t-b.t);
  hitStats.total = filtered.length;
  return filtered;
}

// Kick initial layout
layout();
