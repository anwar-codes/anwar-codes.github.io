// Rhythm Hero Lite v5.5 — iOS Chrome Analyze enable fix
let audioCtx, buffer, source, musicGain;
let selectedFile = null;
let startCtxTime=0, startSongTime=0, pausedAt=0, gameState='idle';
const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const statusDot = document.getElementById('statusDot');
const fileNameEl = document.getElementById('fileName');
const latencyInput = document.getElementById('latencyInput');
const speedInput = document.getElementById('speedInput');
const speedVal = document.getElementById('speedVal');
const togglePanel = document.getElementById('togglePanel');
const panel = document.getElementById('panel');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d',{alpha:false});
const LANES=4, JUDGE=.85; let W=0, H=0;

function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function unlockAudio(){
  ensureAudio();
  // create silent buffer to unlock on iOS
  try{
    const b = audioCtx.createBuffer(1, 1, 22050);
    const s = audioCtx.createBufferSource();
    s.buffer = b;
    s.connect(audioCtx.destination);
    if (s.start) s.start(0); else s.noteOn(0);
  }catch(e){}
}
['touchstart','mousedown','pointerdown'].forEach(ev=>{
  window.addEventListener(ev, ()=>{
    unlockAudio();
  }, { once:true, capture:true });
});

// Collapsible panel
togglePanel.addEventListener('click', ()=>{
  panel.classList.toggle('open');
  localStorage.setItem('panelOpen', panel.classList.contains('open') ? '1':'0');
  resize();
});
(function(){
  const v = localStorage.getItem('panelOpen');
  if (v==='0') panel.classList.remove('open');
})();

function resize(){
  const lanesH = 56 + 8*2; // button + padding
  const topbarH = document.getElementById('topbar').offsetHeight;
  const panelH = panel.classList.contains('open') ? panel.scrollHeight : 0;
  const hh = topbarH + panelH + lanesH;
  const avail = Math.max(160, window.innerHeight - hh);
  canvas.width = window.innerWidth;
  canvas.height = Math.round(avail);
  W = canvas.width; H = canvas.height;
  draw();
}
window.addEventListener('resize', resize);

// Status helpers
function setStatus(ok){
  statusDot.classList.toggle('st-ok', ok);
  statusDot.classList.toggle('st-bad', !ok);
}
function setAnalyzeEnabled(v){
  analyzeBtn.disabled = !v;
  if (v) analyzeBtn.classList.add('pulse'); else analyzeBtn.classList.remove('pulse');
}

// File selection => enable Analyze immediately (decoding later on click)
fileInput.addEventListener('change', ()=>{
  selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  fileNameEl.textContent = selectedFile ? ' — ' + selectedFile.name : '';
  setAnalyzeEnabled(!!selectedFile);
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  restartBtn.disabled = true;
  buffer = null;
  setStatus(false);
});

// Robust decode with promise or callback fallback (for iOS WebKit variations)
function decodeArrayBuffer(ab){
  ensureAudio();
  return new Promise((resolve, reject)=>{
    try{
      const p = audioCtx.decodeAudioData(ab, b=>resolve(b), e=>reject(e));
      if (p && typeof p.then === 'function'){
        p.then(resolve).catch(reject);
      }
    }catch(err){ reject(err); }
  });
}

async function analyzeAndBuild(){
  if (!selectedFile){ alert('Pilih file lagu dulu.'); return; }
  setAnalyzeEnabled(false);
  try{
    const ab = await selectedFile.arrayBuffer();
    buffer = await decodeArrayBuffer(ab);
    setStatus(true);
    // Minimal note generation (energy peaks); full generator can be swapped here
    const notes = await generateChart(buffer);
    window.__notes = notes;
    document.getElementById('analyzeBtn').blur();
    playBtn.disabled = notes.length===0;
    restartBtn.disabled = true;
    pauseBtn.disabled = true;
    draw();
  }catch(err){
    console.error('Decode failed:', err);
    alert('Gagal membuka audio. Coba format lain (MP3/WAV/OGG) atau update browser.');
    setAnalyzeEnabled(true);
    setStatus(false);
  }
}

analyzeBtn.addEventListener('click', ()=>{
  // On iOS, user gesture is guaranteed here; unlock and start decoding
  unlockAudio();
  analyzeAndBuild();
});

// Playback (simplified; keeps focus on Analyze fix)
function audioTime(){ if(!audioCtx) return 0; return (audioCtx.currentTime-startCtxTime)+startSongTime }
function startPlayback(){
  if (!buffer) return;
  ensureAudio();
  const offset = (gameState==='paused') ? pausedAt : 0;
  source = audioCtx.createBufferSource();
  musicGain = audioCtx.createGain();
  source.buffer = buffer;
  source.connect(musicGain).connect(audioCtx.destination);
  startCtxTime = audioCtx.currentTime; startSongTime = offset;
  source.start(0, offset);
  source.onended = ()=>{ if (gameState==='playing') gameState='ended'; };
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
playBtn.addEventListener('click', ()=> startPlayback());
pauseBtn.addEventListener('click', ()=> stopPlayback(true));
restartBtn.addEventListener('click', ()=>{ stopPlayback(false); startPlayback(); });

// Energy-based simple analyzer (compact)
async function generateChart(buffer){
  const sr = buffer.sampleRate;
  const chs = buffer.numberOfChannels;
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c=0;c<chs;c++){ const d=buffer.getChannelData(c); for (let i=0;i<len;i++) mono[i]+=d[i]/chs; }
  const hop=512, frame=1024, nFrames = Math.floor((len-frame)/hop);
  const energy = new Float32Array(nFrames);
  let idx=0; for (let i=0;i<nFrames;i++){ let s=0; for (let j=0;j<frame;j++){ const v=mono[idx+j]; s+=v*v; } energy[i]=Math.log10(1e-12+s); idx+=hop; }
  const mean = energy.reduce((a,b)=>a+b,0)/nFrames;
  const std = Math.sqrt(energy.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
  const norm = Array.from(energy, e=>(e-mean)/(std||1));
  const peaks = [];
  for (let i=2;i<nFrames-2;i++){
    const v = norm[i];
    if (v>1.0 && v>=norm[i-1] && v>=norm[i+1]) peaks.push((i*hop+frame/2)/sr);
  }
  // quick quantize to 1/8 grid
  let bpm=120;
  if (peaks.length>1){
    const IOI=[]; for (let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]);
    const hist=new Map();
    for (const d of IOI){ if (d<=0) continue; let b=60/d; while(b<60)b*=2; while(b>180)b/=2; const k=Math.round(b); hist.set(k,(hist.get(k)||0)+1); }
    let best=120,cnt=-1; for (const [k,v] of hist.entries()){ if (v>cnt){cnt=v;best=k;} } bpm=best;
  }
  const beat=60/bpm, grid=beat/2;
  const times=[]; let last=-999;
  for (const t of peaks){ const q=Math.round(t/grid)*grid; if (q-last>0.08){ times.push(q); last=q; } }
  const dur = buffer.duration;
  return times.filter(t=>t>0.5 && t<dur-0.2).map((t,i)=>({t, lane:i%4}));
}

// Minimal draw/loop so you can verify Analyze enables
function draw(){
  ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const laneW = canvas.width / LANES; const judgeY = canvas.height*JUDGE;
  ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, judgeY); ctx.lineTo(canvas.width, judgeY); ctx.stroke();
  ctx.globalAlpha=.1; for(let i=0;i<LANES;i++){ ctx.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][i]; ctx.fillRect(i*laneW,0,laneW,canvas.height); } ctx.globalAlpha=1;
}
function loop(){ if (gameState!=='playing') return; draw(); requestAnimationFrame(loop); }

// Init
resize(); setStatus(false); setAnalyzeEnabled(false);
