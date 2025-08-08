// Rhythm Hero Lite
// Minimal Guitar Hero–like game with upload + auto note mapping.
// Author: ChatGPT

const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const latencyInput = document.getElementById('latencyInput');
const speedInput = document.getElementById('speedInput');
const speedVal = document.getElementById('speedVal');
const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');
const accEl = document.getElementById('acc');
const bpmEl = document.getElementById('bpm');
const noteCountEl = document.getElementById('noteCount');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha:false });

let audioCtx, buffer, source, gainNode;
let startCtxTime = 0;
let startSongTime = 0;
let pausedAt = 0;
let gameState = 'idle'; // idle, ready, playing, paused, ended

let notes = []; // {t: seconds, lane: 0..3}
let speedMultiplier = 1.0; // affects visual speed
let hitStats = {score:0, hits:0, total:0, combo:0, maxCombo:0};

// Lanes & layout
const LANES = 4;
const JUDGE_LINE_Y_RATIO = 0.85; // 85% down the screen
let W = 0, H = 0;
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = Math.round(window.innerHeight * 0.62);
  W = canvas.width; H = canvas.height;
}
window.addEventListener('resize', resize);
resize();

// Controls
speedInput.addEventListener('input', ()=>{
  speedMultiplier = parseFloat(speedInput.value);
  speedVal.textContent = speedMultiplier.toFixed(2) + 'x';
});

// Touch/Keyboard input
const activeLanes = new Set();
function pressLane(l){ activeLanes.add(l); judgeHit(l); flashLane(l); }
function releaseLane(l){ activeLanes.delete(l); }

document.getElementById('touchLanes').addEventListener('touchstart', (e)=>{
  const t = e.target.closest('button[data-lane]');
  if (!t) return;
  e.preventDefault();
  pressLane(parseInt(t.dataset.lane,10));
});
document.getElementById('touchLanes').addEventListener('touchend', (e)=>{
  const t = e.target.closest('button[data-lane]');
  if (!t) return;
  e.preventDefault();
  releaseLane(parseInt(t.dataset.lane,10));
});
document.addEventListener('keydown', (e)=>{
  const map = { 'a':0, 's':1, 'd':2, 'f':3 };
  const l = map[e.key.toLowerCase()];
  if (l!=null) pressLane(l);
});
document.addEventListener('keyup', (e)=>{
  const map = { 'a':0, 's':1, 'd':2, 'f':3 };
  const l = map[e.key.toLowerCase()];
  if (l!=null) releaseLane(l);
});

function flashLane(lane){
  // Simple visual feedback on press
}

// Load file
fileInput.addEventListener('change', async ()=>{
  if (!fileInput.files[0]) return;
  const arrayBuf = await fileInput.files[0].arrayBuffer();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  buffer = await audioCtx.decodeAudioData(arrayBuf);
  analyzeBtn.disabled = false;
  playBtn.disabled = true;
  restartBtn.disabled = true;
  pauseBtn.disabled = true;
  gameState = 'idle';
});

analyzeBtn.addEventListener('click', async ()=>{
  if (!buffer) return;
  notes = await generateChart(buffer);
  noteCountEl.textContent = notes.length;
  playBtn.disabled = false;
  restartBtn.disabled = true;
  pauseBtn.disabled = true;
  gameState = 'ready';
});

playBtn.addEventListener('click', ()=>{
  if (!buffer) return;
  startPlayback();
});
pauseBtn.addEventListener('click', ()=>{
  if (gameState!=='playing') return;
  stopPlayback(true); // pause
});
restartBtn.addEventListener('click', ()=>{
  if (!buffer) return;
  stopPlayback(false);
  startPlayback();
});

function startPlayback(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  source = audioCtx.createBufferSource();
  gainNode = audioCtx.createGain();
  source.buffer = buffer;
  source.connect(gainNode).connect(audioCtx.destination);

  const offset = gameState==='paused' ? pausedAt : 0;
  startCtxTime = audioCtx.currentTime;
  startSongTime = offset;
  source.start(0, offset);
  source.onended = ()=>{
    if (gameState==='playing') { gameState='ended'; }
  };

  hitStats = {score:0, hits:0, total:notes.length, combo:0, maxCombo:0};
  scoreEl.textContent = 0; comboEl.textContent = 0; accEl.textContent = '0%';
  gameState='playing';
  playBtn.disabled = true; pauseBtn.disabled = false; restartBtn.disabled = false;

  // Begin loop
  requestAnimationFrame(loop);
}

function stopPlayback(pause=false){
  try{ source.stop(); }catch{}
  const elapsed = audioTime();
  if (pause){
    gameState='paused';
    pausedAt = elapsed;
  }else{
    gameState='ready';
    pausedAt = 0;
  }
  playBtn.disabled = false;
  pauseBtn.disabled = true;
}

function audioTime(){
  // song time in seconds since playback start
  if (!audioCtx) return 0;
  return (audioCtx.currentTime - startCtxTime) * 1.0 + startSongTime;
}

function loop(){
  if (gameState!=='playing') return;
  const t = audioTime() + parseInt(latencyInput.value||0)/1000;

  draw(t);
  requestAnimationFrame(loop);
}

// Rendering
function draw(t){
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0,0,W,H);

  // Draw lanes
  const laneW = W / LANES;
  for (let i=0;i<LANES;i++){
    ctx.fillStyle = ['var(--lane0)','var(--lane1)','var(--lane2)','var(--lane3)'][i];
    ctx.globalAlpha = 0.1;
    ctx.fillRect(i*laneW,0,laneW,H);
    ctx.globalAlpha = 1.0;
  }

  // Judge line
  const judgeY = H*JUDGE_LINE_Y_RATIO;
  ctx.strokeStyle = '#ffffff40';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, judgeY);
  ctx.lineTo(W, judgeY);
  ctx.stroke();

  // Note speed: pixels per second
  const pxPerSec = 350 * speedMultiplier;

  // Draw notes in viewport
  const windowBefore = 2.0, windowAfter = 6.0;
  for (const n of notes){
    const dt = n.t - t;
    if (dt < -0.5) continue; // already passed
    if (dt > windowAfter) break;
    const y = judgeY - dt * pxPerSec;
    if (y < -40 || y > H+40) continue;
    const x = (n.lane + 0.1) * laneW;
    const w = laneW*0.8, h = 16;
    ctx.fillStyle = ['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane];
    ctx.fillRect(x - w/2, y - h/2, w, h);
  }

  // HUD overlay
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.12;
  ctx.fillRect(0,judgeY-40,W,80);
  ctx.globalAlpha = 1.0;
}

// Judging
const HIT_WINDOWS = { perfect:0.10, good:0.18 }; // seconds
function judgeHit(lane){
  if (gameState!=='playing') return;
  const t = audioTime() + parseInt(latencyInput.value||0)/1000;
  // Find nearest note in this lane within window
  let idx = -1, bestErr = 1e9;
  for (let i=0;i<notes.length;i++){
    const n = notes[i];
    if (n.lane!==lane) continue;
    const err = Math.abs(n.t - t);
    if (err < bestErr){
      bestErr = err; idx = i;
    }
  }
  if (idx===-1 || bestErr > HIT_WINDOWS.good) {
    // Miss
    hitStats.combo = 0;
    comboEl.textContent = hitStats.combo;
    return;
  }
  // Remove consumed note
  const n = notes.splice(idx,1)[0];
  noteCountEl.textContent = notes.length;
  let add = 0;
  if (bestErr <= HIT_WINDOWS.perfect){ add = 1000; }
  else { add = 500; }
  hitStats.score += add + Math.min(hitStats.combo*5, 500);
  hitStats.combo++;
  hitStats.hits++;
  hitStats.maxCombo = Math.max(hitStats.maxCombo, hitStats.combo);
  scoreEl.textContent = hitStats.score;
  comboEl.textContent = hitStats.combo;
  const acc = hitStats.hits / Math.max(1, hitStats.total) * 100;
  accEl.textContent = acc.toFixed(1) + '%';
}

// ===== Analysis & Note generation =====

// Utility: downmix to mono Float32Array
function toMono(buffer){
  const chs = buffer.numberOfChannels;
  const len = buffer.length;
  const tmp = new Float32Array(len);
  for (let c=0;c<chs;c++){
    buffer.getChannelData(c).forEach((v,i)=> tmp[i]+=v/chs);
  }
  return tmp;
}

// Short-time energy onset detection + tempo estimate + chart mapping
async function generateChart(buffer){
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);
  const hop = 512, frame = 1024;
  const nFrames = Math.floor((mono.length - frame) / hop);
  const energy = new Float32Array(nFrames);

  // Energy per frame (sum of squares)
  let idx = 0;
  for (let i=0;i<nFrames;i++){
    let sum = 0;
    for (let j=0;j<frame;j++){
      const v = mono[idx + j];
      sum += v*v;
    }
    energy[i] = Math.log10(1e-12 + sum);
    idx += hop;
  }

  // Normalize energy
  const mean = energy.reduce((a,b)=>a+b,0)/nFrames;
  const std = Math.sqrt(energy.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
  const norm = energy.map(e => (e-mean)/(std||1));

  // Peak picking using moving average threshold
  const win = 30;
  const peaks = [];
  for (let i=win;i<nFrames-win;i++){
    let localMean = 0;
    for (let k=-win;k<=win;k++) localMean += norm[i+k];
    localMean /= (2*win+1);
    const v = norm[i] - localMean;
    if (v>1.0 && norm[i]===Math.max(...norm.slice(i-2,i+3))){
      const t = (i*hop + frame/2)/sr;
      peaks.push(t);
    }
  }

  // Inter-onset intervals -> BPM estimate
  const IOI = [];
  for (let i=1;i<peaks.length;i++){
    IOI.push(peaks[i]-peaks[i-1]);
  }
  let bpm = 0;
  if (IOI.length){
    // histogram
    const hist = new Map();
    for (const d of IOI){
      if (d<=0) continue;
      let b = 60/d;
      while (b<60) b*=2; // bring to common tempo range
      while (b>180) b/=2;
      const key = Math.round(b);
      hist.set(key, (hist.get(key)||0)+1);
    }
    let best=0,count=-1;
    for (const [k,v] of hist.entries()){
      if (v>count){ count=v; best=k; }
    }
    bpm = best||120;
  } else bpm = 120;

  document.getElementById('bpm').textContent = bpm;

  // Quantize peaks to grid based on BPM
  const beat = 60 / bpm;
  const grid = beat/2; // 8th notes
  const chartTimes = [];
  for (const t of peaks){
    const q = Math.round(t / grid) * grid;
    if (!chartTimes.length || Math.abs(q - chartTimes[chartTimes.length-1])>0.08){
      chartTimes.push(q);
    }
  }

  // Lane assignment: deterministic hash using local energy
  // Compute zero-crossing rate (rough timbre proxy) to vary lane
  function laneForTime(t){
    const i = Math.max(0, Math.min(mono.length-1, Math.floor(t*sr)));
    const span = Math.floor(0.02*sr);
    let z=0;
    for (let k=1;k<span;k++){
      const a = mono[i-k], b = mono[i-k-1];
      if ((a>=0 && b<0) || (a<0 && b>=0)) z++;
    }
    const val = (z*1315423911 + i) >>> 0;
    return val % 4;
  }

  const chart = chartTimes.map(t => ({ t, lane: laneForTime(t) }));

  // Trim out-of-range and sort
  const dur = buffer.duration;
  const filtered = chart.filter(n => n.t>0.5 && n.t<dur-0.2).sort((a,b)=>a.t-b.t);

  return filtered;
}
