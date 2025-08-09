// Rhythm Hero Lite v5.4 — Analyze Button Fix + Collapsible Panel + MP3 support
// Key changes:
// - Enable "Analyze" immediately after file chosen (deferred decoding on click)
// - Robust AudioContext bootstrap on first user gesture (mobile autoplay policy)
// - Status dot (red=not ready, green=ready), filename display
// - Canvas resizes to available height when panel toggled

// ====== Elements
const $ = (s)=>document.querySelector(s);
const fileInput = $('#fileInput'), analyzeBtn = $('#analyzeBtn'), playBtn = $('#playBtn'), pauseBtn = $('#pauseBtn'), restartBtn = $('#restartBtn');
const latencyInput = $('#latencyInput'), speedInput = $('#speedInput'), speedVal = $('#speedVal'), calibrateBtn = $('#calibrateBtn'), diffSel = $('#diffSel');
const scoreEl = $('#score'), comboEl = $('#combo'), accEl = $('#acc'), bpmEl = $('#bpm'), noteCountEl = $('#noteCount'), fileNameEl = $('#fileName');
const togglePanelBtn = $('#togglePanel'), uiPanel = $('#ui'), statusDot = $('#statusDot');
const exportBtn = $('#exportBtn'), importInput = $('#importInput');
const hitSfxInput = $('#hitSfxInput'), missSfxInput = $('#missSfxInput'), hitVolEl = $('#hitVol'), missVolEl = $('#missVol');
const canvas = $('#game'); const ctx = canvas.getContext('2d', { alpha:false });
const lanesBar = $('#touchLanes');

// ====== Audio
let audioCtx, buffer, source, musicGain;
let startCtxTime=0, startSongTime=0, pausedAt=0, gameState='idle';
let selectedFile = null; // NEW: keep file; decode later on Analyze click

function ensureAudio(){ if(!audioCtx){ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } }
async function resumeAudioCtx(){ if(!audioCtx) return; if(audioCtx.state==='suspended'){ try{ await audioCtx.resume(); }catch{} } }

// Bootstrap on first gesture
['click','touchstart'].forEach(ev=>{
  window.addEventListener(ev, async ()=>{ ensureAudio(); await resumeAudioCtx(); }, { once:true, passive:true });
});

// ====== UI: collapsible panel & canvas sizing
const PANEL_KEY='rh-v5-panel-open';
function applyPanel(open){
  uiPanel.dataset.open = open ? 'true' : 'false';
  togglePanelBtn.setAttribute('aria-expanded', open?'true':'false');
  localStorage.setItem(PANEL_KEY, open?'1':'0');
  resizeCanvas();
}
togglePanelBtn.addEventListener('click',()=>applyPanel(uiPanel.dataset.open!=='true'));
applyPanel(localStorage.getItem(PANEL_KEY)!=='0'); // default open

function resizeCanvas(){
  const lanesH = lanesBar.getBoundingClientRect().height;
  const topbarH = document.getElementById('topbar').getBoundingClientRect().height;
  const panelOpen = uiPanel.dataset.open==='true';
  const panelH = panelOpen ? uiPanel.scrollHeight : 0;
  const total = window.innerHeight - lanesH - topbarH - 6; // padding
  canvas.width = window.innerWidth;
  canvas.height = Math.max(200, Math.floor(total));
}
window.addEventListener('resize', resizeCanvas); resizeCanvas();

// ====== State + SFX (same core as v5)
let notes=[], speedMultiplier=1.0, hitStats={score:0,hits:0,total:0,combo:0,maxCombo:0};
const LANES=4, JUDGE_LINE_Y_RATIO=.85;
const particles=[]; function makeSpark(x,y,color,p=22){ const arr=[]; for(let i=0;i<14;i++){const a=(Math.PI*2)*i/14+Math.random()*.2; const sp=p*(.5+Math.random()); arr.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.18+Math.random()*.12,color});} return {sparks:arr}; }
function drawParticles(dt){ ctx.save(); for(let p=particles.length-1;p>=0;p--){const sys=particles[p]; let alive=false; for(const s of sys.sparks){ s.life-=dt; if(s.life>0){ alive=true; s.vy+=80*dt; s.x+=s.vx*dt; s.y+=s.vy*dt; ctx.globalAlpha=Math.max(0,Math.min(1,s.life*5)); ctx.fillStyle=s.color; ctx.fillRect(s.x,s.y,2,2); } } if(!alive) particles.splice(p,1);} ctx.restore(); }
let hitSfxBuf=null, missSfxBuf=null;
async function loadSfxFromInput(input, set){ if(!input.files||!input.files[0]) return; ensureAudio(); await resumeAudioCtx(); const ab=await input.files[0].arrayBuffer(); try{ const b=await audioCtx.decodeAudioData(ab); set(b); }catch(e){ alert('Gagal memuat SFX. Coba WAV/OGG.'); } }
hitSfxInput?.addEventListener('change', ()=>loadSfxFromInput(hitSfxInput, b=>hitSfxBuf=b));
missSfxInput?.addEventListener('change', ()=>loadSfxFromInput(missSfxInput, b=>missSfxBuf=b));
function playSfx(buf, volume=0.6){ if(!audioCtx) return false; if(buf){ const s=audioCtx.createBufferSource(); const g=audioCtx.createGain(); s.buffer=buf; g.gain.value=volume; s.connect(g).connect(audioCtx.destination); s.start(); return true; } return false; }
function synthHit(v=.7){ ensureAudio(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='triangle'; o.frequency.setValueAtTime(660,t); o.frequency.exponentialRampToValueAtTime(990,t+.03); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.08); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.09); }
function synthMiss(v=.6){ ensureAudio(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='sawtooth'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(140,t+.12); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+.14); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.16); }
function doHitSfx(){ const v=parseFloat(hitVolEl.value||.7); if(!playSfx(hitSfxBuf,v)) synthHit(v); }
function doMissSfx(){ const v=parseFloat(missVolEl.value||.6); if(!playSfx(missSfxBuf,v)) synthMiss(v); }

// ====== File handling (DEFER DECODING)
fileInput.addEventListener('change', ()=>{
  selectedFile = fileInput.files?.[0] || null;
  fileNameEl.textContent = selectedFile ? '🎵 ' + selectedFile.name : '';
  buffer = null; // reset previous buffer
  analyzeBtn.disabled = !selectedFile ? true : false; // ENABLE right after choose
  playBtn.disabled = true; pauseBtn.disabled = true; restartBtn.disabled = true;
  statusDot.style.background = selectedFile ? '#16a34a' : '#c2410c';
});

// ====== Analyze button now decodes if needed
analyzeBtn.addEventListener('click', async ()=>{
  if (!selectedFile) return;
  ensureAudio(); await resumeAudioCtx();
  if (!buffer){
    try{
      const ab = await selectedFile.arrayBuffer();
      buffer = await audioCtx.decodeAudioData(ab);
    }catch(e){
      console.error('Decode error:', e);
      alert('Gagal membuka audio. Coba MP3/WAV/OGG lainnya atau update browser.');
      statusDot.style.background = '#c2410c'; return;
    }
  }
  // generate chart
  notes = await generateChart(buffer, diffSel.value);
  noteCountEl.textContent = notes.length;
  playBtn.disabled = false; restartBtn.disabled = true; pauseBtn.disabled = true;
  gameState='ready';
});

// ====== Playback (minimal, same as earlier versions for brevity)
function audioTime(){ if(!audioCtx) return 0; return (audioCtx.currentTime - startCtxTime) + startSongTime; }
function startPlayback(){
  ensureAudio();
  source = audioCtx.createBufferSource(); musicGain = audioCtx.createGain();
  source.buffer = buffer; source.connect(musicGain).connect(audioCtx.destination);
  const offset = gameState==='paused' ? pausedAt : 0;
  startCtxTime = audioCtx.currentTime; startSongTime = offset;
  source.start(0, offset);
  source.onended = ()=>{ if (gameState==='playing') gameState='ended'; };
  hitStats = {score:0, hits:0, total:notes.length, combo:0, maxCombo:0};
  gameState='playing';
  playBtn.disabled = true; pauseBtn.disabled = false; restartBtn.disabled = false;
  requestAnimationFrame(loop);
}
function stopPlayback(pause=false){
  try{ source.stop(); }catch{}
  const elapsed = audioTime();
  if (pause){ gameState='paused'; pausedAt = elapsed; } else { gameState='ready'; pausedAt = 0; }
  playBtn.disabled = false; pauseBtn.disabled = true;
}
playBtn.addEventListener('click', ()=>{ if(buffer) startPlayback(); });
pauseBtn.addEventListener('click', ()=>{ if(gameState==='playing') stopPlayback(true); });
restartBtn.addEventListener('click', ()=>{ if(buffer){ stopPlayback(false); startPlayback(); }});

// ====== Render loop (simple)
function loop(){
  if (gameState!=='playing') return;
  draw();
  requestAnimationFrame(loop);
}
function draw(){
  const W = canvas.width, H = canvas.height, judgeY = Math.floor(H*JUDGE_LINE_Y_RATIO);
  ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
  const laneW = W/4;
  for (let i=0;i<4;i++){ ctx.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][i]; ctx.globalAlpha=.10; ctx.fillRect(i*laneW,0,laneW,H); }
  ctx.globalAlpha=1; ctx.strokeStyle='#ffffff40'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,judgeY); ctx.lineTo(W,judgeY); ctx.stroke();
}

// ====== Analyzer (energy-based compact; adequate to validate flow)
async function generateChart(buffer, difficulty='normal'){
  const sr=buffer.sampleRate, chs=buffer.numberOfChannels, len=buffer.length;
  const mono=new Float32Array(len);
  for (let c=0;c<chs;c++){ const d=buffer.getChannelData(c); for (let i=0;i<len;i++) mono[i]+=d[i]/chs; }
  const hop=512, frame=1024; const nFrames=Math.floor((len-frame)/hop);
  const energy=new Float32Array(nFrames); let idx=0;
  for (let i=0;i<nFrames;i++){ let s=0; for (let j=0;j<frame;j++){ const v=mono[idx+j]; s+=v*v; } energy[i]=Math.log10(1e-12+s); idx+=hop; }
  const mean=energy.reduce((a,b)=>a+b,0)/nFrames;
  const std=Math.sqrt(energy.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
  const norm=Array.from(energy,e=>(e-mean)/(std||1));
  const peaks=[]; for (let i=2;i<nFrames-2;i++){ const v=norm[i]; if (v>1.0 && v>=norm[i-1] && v>=norm[i+1]) peaks.push((i*hop+frame/2)/sr); }
  let bpm=120; if (peaks.length>1){ const IOI=[]; for (let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]);
    if (IOI.length){ const hist=new Map(); for (const d of IOI){ if (d<=0) continue; let b=60/d; while (b<60) b*=2; while (b>180) b/=2; const k=Math.round(b); hist.set(k,(hist.get(k)||0)+1); }
      let best=120,count=-1; for (const [k,v] of hist.entries()){ if (v>count){count=v; best=k;} } bpm=best; } }
  bpmEl.textContent=bpm;
  const beat=60/bpm, grid= difficulty==='hard'? beat/4 : (difficulty==='easy'? beat : beat/2);
  const times=[]; let last=-999; for (const t of peaks){ const q=Math.round(t/grid)*grid; if (q-last>0.08){ times.push(q); last=q; } }
  function laneForTime(t){ const i=Math.max(0,Math.min(mono.length-2,Math.floor(t*sr))); const span=Math.floor(.02*sr); let z=0; for(let k=1;k<span;k++){ const a=mono[i-k],b=mono[i-k-1]; if((a>=0&&b<0)||(a<0&&b>=0)) z++; } const val=(z*1315423911+i)>>>0; return val%4; }
  const chart=times.map(t=>({t,lane:laneForTime(t)}));
  const dur=buffer.duration; return chart.filter(n=>n.t>.5&&n.t<dur-.2).sort((a,b)=>a.t-b.t);
}

// ====== Misc
speedInput.addEventListener('input', ()=>{ speedVal.textContent = parseFloat(speedInput.value).toFixed(2)+'x'; });
