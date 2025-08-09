(function(){
'use strict';
try{
  const $=s=>document.querySelector(s);
  const on=(el,ev,fn,opt)=>el&&el.addEventListener(ev,fn,opt);

  // ===== Native <details> toggle =====
  const details=$('#panel'), summary=$('#panelSummary');
  // Default CLOSED unless user previously opened
  try{
    const saved = localStorage.getItem('panelOpen');
    if(saved==='1'){ details.setAttribute('open',''); summary.setAttribute('aria-expanded','true'); }
    else { details.removeAttribute('open'); summary.setAttribute('aria-expanded','false'); }
  }catch{}
  on(details,'toggle',()=>{
    const open = details.hasAttribute('open');
    summary.setAttribute('aria-expanded', open?'true':'false');
    try{ localStorage.setItem('panelOpen', open?'1':'0'); }catch{}
    // trigger layout update for canvas
    window.dispatchEvent(new Event('resize'));
  });

  // ===== Core game state =====
  let audioCtx, buffer=null, selectedFile=null, source=null, musicGain=null;
  let startCtxTime=0, startSongTime=0, pausedAt=0, gameState='idle';
  let notes=[]; let firstNoteTime=0;
  let hitSfxBuf=null, missSfxBuf=null;

  const fileInput=$('#fileInput'), analyzeBtn=$('#analyzeBtn'), playBtn=$('#playBtn'), pauseBtn=$('#pauseBtn'), restartBtn=$('#restartBtn');
  const statusDot=$('#statusDot'), fileNameEl=$('#fileName');
  const canvas=$('#game'); const ctx=canvas.getContext('2d',{alpha:false}); const hud=$('#hud');
  const speedInput=$('#speedInput'), speedVal=$('#speedVal'), startSel=$('#startSel'), customStart=$('#customStart'), jumpFirstBtn=$('#jumpFirstBtn');
  const latencyInput=$('#latencyInput'), calibrateBtn=$('#calibrateBtn'), diffSel=$('#diffSel');
  const hitSfxInput=$('#hitSfxInput'), missSfxInput=$('#missSfxInput'), hitVolEl=$('#hitVol'), missVolEl=$('#missVol');
  const exportBtn=$('#exportBtn'), importInput=$('#importInput');
  const LANES=4, JUDGE=.85; let W=0,H=0, speedMultiplier=1.0;

  // ===== Audio helpers =====
  function ensureAudio(){ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }
  function unlockAudio(){ try{ ensureAudio(); const b=audioCtx.createBuffer(1,1,22050); const s=audioCtx.createBufferSource(); s.buffer=b; s.connect(audioCtx.destination); s.start? s.start(0) : s.noteOn(0);}catch(e){} }
  ['pointerdown','touchstart','mousedown','keydown'].forEach(ev=> on(window,ev,unlockAudio,{passive:false,once:true,capture:true}));
  function playSfx(buf,v=.6){ ensureAudio(); if(buf){ const s=audioCtx.createBufferSource(),g=audioCtx.createGain(); s.buffer=buf; g.gain.value=v; s.connect(g).connect(audioCtx.destination); s.start(); return true } return false }
  function synthHit(v=.7){ ensureAudio(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='triangle'; o.frequency.setValueAtTime(660,t); o.frequency.exponentialRampToValueAtTime(990,t+.03); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.08); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.09) }
  function synthMiss(v=.6){ ensureAudio(); const o=audioCtx.createOscillator(),g=audioCtx.createGain(); const t=audioCtx.currentTime; o.type='sawtooth'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(140,t+.12); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(v,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+.14); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+.16) }
  function doHitSfx(){ const v=parseFloat(hitVolEl.value||.7); if(!playSfx(hitSfxBuf,v)) synthHit(v) }
  function doMissSfx(){ const v=parseFloat(missVolEl.value||.6); if(!playSfx(missSfxBuf,v)) synthMiss(v) }
  hitSfxInput?.addEventListener('change', async()=>{ if(!hitSfxInput.files||!hitSfxInput.files[0])return; ensureAudio(); const ab=await hitSfxInput.files[0].arrayBuffer(); hitSfxBuf=await audioCtx.decodeAudioData(ab) });
  missSfxInput?.addEventListener('change', async()=>{ if(!missSfxInput.files||!missSfxInput.files[0])return; ensureAudio(); const ab=await missSfxInput.files[0].arrayBuffer(); missSfxBuf=await audioCtx.decodeAudioData(ab) });

  // ===== UI frame =====
  function setStatus(ok){ statusDot.classList.toggle('st-ok',ok); statusDot.classList.toggle('st-bad',!ok); }
  function setAnalyzeEnabled(v){ analyzeBtn.disabled=!v; analyzeBtn.classList.toggle('pulse',!!v); }
  function resize(){
    const lanesH=56+8*2; const topbarH=document.getElementById('topbar').offsetHeight; const panelH=details.hasAttribute('open')? details.scrollHeight : 0;
    const avail=Math.max(160, window.innerHeight - (topbarH+panelH+lanesH)); canvas.width=window.innerWidth; canvas.height=Math.round(avail); W=canvas.width; H=canvas.height; draw(0);
  }
  on(window,'resize',resize);

  // ===== File + Analyze =====
  on(fileInput,'change',()=>{
    selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (fileNameEl) fileNameEl.textContent = selectedFile ? ' — ' + selectedFile.name : '';
    buffer=null; setStatus(false); setAnalyzeEnabled(!!selectedFile);
    playBtn.disabled = true; pauseBtn.disabled = true; restartBtn.disabled = true; jumpFirstBtn.disabled = true;
    notes=[]; draw(0); setHUD();
  }, {passive:false});

  function decodeArrayBuffer(ab){
    ensureAudio();
    return new Promise((resolve,reject)=>{
      try{
        const p=audioCtx.decodeAudioData(ab, b=>resolve(b), e=>reject(e));
        if (p && typeof p.then==='function'){ p.then(resolve).catch(reject); }
      }catch(err){ reject(err); }
    });
  }

  async function onAnalyzeClick(){
    if (!selectedFile){ alert('Pilih file lagu dulu.'); return; }
    setAnalyzeEnabled(false);
    try{
      const ab = await selectedFile.arrayBuffer();
      buffer = await decodeArrayBuffer(ab);
      setStatus(true);
      notes = (await generateChart(buffer, diffSel.value)).sort((a,b)=>a.t-b.t);
      if (notes.length<1){ notes = (await generateChartEnergy(buffer, diffSel.value)).sort((a,b)=>a.t-b.t); }
      firstNoteTime = notes.length? notes[0].t : 0;
      if (notes.length===0){ alert('Tidak menemukan ketukan. Coba lagu lain atau ubah Kesulitan.'); }
      playBtn.disabled = notes.length===0;
      jumpFirstBtn.disabled = notes.length===0;
      draw(0); setHUD();
    }catch(err){
      console.error(err); alert('Gagal membuka audio. Coba MP3/WAV/OGG atau update browser.');
      setAnalyzeEnabled(true); setStatus(false);
    }
  }
  ['click','pointerdown','touchstart'].forEach(ev=> on(analyzeBtn,ev,(e)=>{e.preventDefault();unlockAudio();onAnalyzeClick();},{passive:false}));

  // ===== Playback =====
  speedInput.addEventListener('input', ()=>{ speedMultiplier=parseFloat(speedInput.value); speedVal.textContent=speedMultiplier.toFixed(2)+'x'; });
  jumpFirstBtn.addEventListener('click', ()=>{
    if (!buffer || !notes.length) return;
    startSongTime = Math.max(0, notes[0].t - 2.0);
    startCtxTime = audioCtx ? audioCtx.currentTime : 0;
    if (gameState!=='playing') startPlayback();
  });

  function audioTime(){ if(!audioCtx) return 0; return (audioCtx.currentTime-startCtxTime)+startSongTime; }
  function startPlayback(){
    if (!buffer) return;
    ensureAudio();
    source = audioCtx.createBufferSource(); musicGain = audioCtx.createGain(); musicGain.gain.value = 1.0;
    source.buffer = buffer; source.connect(musicGain).connect(audioCtx.destination);
    let offset = 0;
    if (startSel.value==='firstlead' && notes.length){ offset = Math.max(0, notes[0].t - 2.0); }
    else if (startSel.value==='custom'){ offset = Math.max(0, parseFloat(customStart.value||0)); }
    if (gameState==='paused'){ offset = pausedAt; }
    startCtxTime = audioCtx.currentTime; startSongTime = offset;
    try{ source.start(0, offset); }catch(e){ console.error(e); }
    source.onended=()=>{ if(gameState==='playing') gameState='ended'; };
    gameState='playing'; playBtn.disabled=true; pauseBtn.disabled=false; restartBtn.disabled=false;
    countdownStart();
    requestAnimationFrame(loop); setHUD();
  }
  function stopPlayback(pause=false){
    try{ source && source.stop(); }catch{}
    const elapsed = audioTime();
    if (pause){ gameState='paused'; pausedAt = elapsed; } else { gameState='ready'; pausedAt=0; }
    playBtn.disabled=false; pauseBtn.disabled=true; setHUD();
  }
  ['click','pointerdown','touchstart'].forEach(ev=> on(playBtn,ev,(e)=>{e.preventDefault();startPlayback();},{passive:false}));
  ['click','pointerdown','touchstart'].forEach(ev=> on(pauseBtn,ev,(e)=>{e.preventDefault();stopPlayback(true);},{passive:false}));
  ['click','pointerdown','touchstart'].forEach(ev=> on(restartBtn,ev,(e)=>{e.preventDefault();stopPlayback(false);startPlayback();},{passive:false}));

  // ===== Input =====
  const holdsDown=new Map(), activeHolds=new Map(), activeLanes=new Set();
  on(document.getElementById('touchLanes'),'touchstart',e=>{const t=e.target.closest('button[data-lane]'); if(!t)return; e.preventDefault(); pressLane(parseInt(t.dataset.lane,10))},{passive:false});
  on(document.getElementById('touchLanes'),'touchend',e=>{const t=e.target.closest('button[data-lane]'); if(!t)return; e.preventDefault(); releaseLane(parseInt(t.dataset.lane,10))},{passive:false});
  on(window,'keydown',e=>{const m={a:0,s:1,d:2,f:3}; const l=m[e.key?.toLowerCase()]; if(l!=null) pressLane(l)});
  on(window,'keyup',e=>{const m={a:0,s:1,d:2,f:3}; const l=m[e.key?.toLowerCase()]; if(l!=null) releaseLane(l)});
  function pressLane(l){ activeLanes.add(l); holdsDown.set(l,true); judgeHit({lane:l}); }
  function releaseLane(l){ activeLanes.delete(l); holdsDown.set(l,false); judgeHoldRelease(l); }

  // ===== Render & loop =====
  const HIT_WINDOWS={perfect:.10,good:.18}; const particles=[];
  function makeSpark(x,y,color){ const arr=[]; for(let i=0;i<14;i++){ const a=(Math.PI*2)*i/14+Math.random()*.2; const sp=22*(.5+Math.random()); arr.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.18+Math.random()*.12,color}) } return {sparks:arr} }
  function drawParticles(dt){ for(let p=particles.length-1;p>=0;p--){ const sys=particles[p]; let alive=false; for(const s of sys.sparks){ s.life-=dt; if(s.life>0){ alive=true; s.vy+=80*dt; s.x+=s.vx*dt; s.y+=s.vy*dt; ctx.globalAlpha=Math.max(0,Math.min(1,s.life*5)); ctx.fillStyle=s.color; ctx.fillRect(s.x,s.y,2,2) } } if(!alive) particles.splice(p,1) } ctx.globalAlpha=1; }
  function draw(t){
    const laneW=W/LANES, judgeY=H*JUDGE;
    ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
    for(let i=0;i<LANES;i++){ ctx.fillStyle=['var(--lane0)','var(--lane1)','var(--lane2)','var(--lane3)'][i]; ctx.globalAlpha=.12; ctx.fillRect(i*laneW,0,laneW,H); }
    ctx.globalAlpha=1;
    ctx.strokeStyle='#ffffff66'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,judgeY); ctx.lineTo(W,judgeY); ctx.stroke();
    const pxPerSec = 350 * speedMultiplier; const windowAfter=12.0;
    for (const n of notes){
      const dtN=n.t - t; if (dtN > windowAfter) break;
      const y = judgeY - dtN * pxPerSec; const x=(n.lane+.5)*laneW; const w=laneW*.7, h=20;
      if(n.end!=null){ const endY=judgeY-(n.end-t)*pxPerSec; ctx.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane]+'AA'; ctx.fillRect(x-w*.35,Math.min(y,endY),w*.7,Math.abs(endY-y)) }
      const near=Math.abs(y-judgeY)<24; ctx.shadowBlur=near?16:0; ctx.shadowColor=['#93c5fd','#86efac','#fde68a','#fca5a5'][n.lane];
      ctx.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][n.lane]; ctx.fillRect(x-w/2,y-h/2,w,h);
    }
    drawParticles(1/60);
    if(countdown.running){ drawCountdown() }
  }
  function loop(){
    if (gameState!=='playing') return;
    const t = audioTime() + parseInt(latencyInput.value||0)/1000;
    draw(t);
    for (let i=notes.length-1;i>=0;i--){
      const n=notes[i];
      if(n.t < t - HIT_WINDOWS.good){ notes.splice(i,1); if(n.end!=null && activeHolds.get(n.lane)) activeHolds.delete(n.lane); doMissSfx(); }
      if(n.end!=null && activeHolds.has(n.lane) && t>=activeHolds.get(n.lane).end-.02){ activeHolds.delete(n.lane); }
    }
    requestAnimationFrame(loop);
  }

  // ===== Judging =====
  function judgeHit({lane}){
    if(gameState!=='playing') return;
    const t = audioTime() + parseInt(latencyInput.value||0)/1000;
    let idx=-1, best=1e9, note=null;
    for(let i=0;i<notes.length;i++){ const n=notes[i]; if(n.lane!==lane) continue; const e=Math.abs(n.t-t); if(e<best){best=e; idx=i; note=n} if(n.t>t+HIT_WINDOWS.good) break; }
    if(idx===-1 || best>HIT_WINDOWS.good){ doMissSfx(); return }
    notes.splice(idx,1);
    doHitSfx();
    const laneW=W/LANES; const x=(lane+.5)*laneW; const y=H*JUDGE; const color=['#93c5fd','#86efac','#fde68a','#fca5a5'][lane];
    const sparks=[]; for(let i=0;i<14;i++){ const a=(Math.PI*2)*i/14+Math.random()*.2; const sp=22*(.5+Math.random()); sparks.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.18+Math.random()*.12,color}) }
    particles.push({sparks});
    if(note.end!=null){ activeHolds.set(lane,{end:note.end,judged:true}); if(!holdsDown.get(lane)) holdsDown.set(lane,true) }
  }
  function judgeHoldRelease(lane){
    if(!activeHolds.has(lane) || gameState!=='playing') return;
    const t = audioTime() + parseInt(latencyInput.value||0)/1000;
    const hold=activeHolds.get(lane);
    if(t<hold.end-.05){ activeHolds.delete(lane); doMissSfx(); } else { activeHolds.delete(lane) }
  }

  // ===== Countdown =====
  const countdown={running:false,start:0};
  function countdownStart(){ countdown.running=true; countdown.start=performance.now()/1000; setTimeout(()=>{countdown.running=false},3200) }
  function drawCountdown(){ const e=performance.now()/1000 - countdown.start; const r=Math.max(0,3-e); let text=r>2?'3':r>1?'2':r>0?'1':'GO!'; const W=canvas.width,H=canvas.height; const ctx=canvas.getContext('2d'); ctx.save(); ctx.fillStyle='#e5e7eb'; ctx.font='bold 48px system-ui,sans-serif'; ctx.textAlign='center'; ctx.fillText(text,W/2,H*.35); ctx.restore() }

  // ===== Calibration =====
  const calState={running:false,schedule:[],tapTimes:[],startTime:0};
  calibrateBtn.addEventListener('click',()=>{ if(gameState==='playing'){ alert('Jeda/berhenti dulu sebelum kalibrasi.'); return } startCalibration() });
  function startCalibration(){ ensureAudio(); calState.running=true; calState.schedule=[]; calState.tapTimes=[]; const bpm=120, beat=60/bpm, N=16; const t0=audioCtx.currentTime+.6; calState.startTime=t0; for(let i=0;i<N;i++){ const t=t0+i*beat; calState.schedule.push(t); playClick(t,i%4===0) } setTimeout(()=>finishCalibration(),Math.ceil((N*beat+1.0)*1000)) }
  function playClick(atTime,strong=false){ const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(strong?1200:900,atTime); g.gain.setValueAtTime(0,atTime); g.gain.linearRampToValueAtTime(strong?.35:.25,atTime+.001); g.gain.exponentialRampToValueAtTime(.0001,atTime+.08); o.connect(g).connect(audioCtx.destination); o.start(atTime); o.stop(atTime+.1) }
  canvas.addEventListener('touchstart',()=>{ if(calState.running) calState.tapTimes.push(audioCtx.currentTime) },{passive:true});
  canvas.addEventListener('mousedown',()=>{ if(calState.running) calState.tapTimes.push(audioCtx.currentTime) });
  function finishCalibration(){ if(!calState.running) return; calState.running=false; const deltas=[]; for(const tap of calState.tapTimes){ let best=null,be=1e9; for(const t of calState.schedule){ const e=Math.abs(tap-t); if(e<be){be=e;best=t} } if(best!==null&&be<.25) deltas.append((tap-best)*1000) } if(deltas.length<6){ alert('Kalibrasi kurang data. Ulangi.'); return } deltas.sort((a,b)=>a-b); const median=deltas[Math.floor(deltas.length/2)]; latencyInput.value=String(Math.round(median/5)*5) }

  // ===== Chart IO =====
  exportBtn.addEventListener('click',()=>{ const data={version:'v6.0.3',notes,meta:{first:firstNoteTime}}; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='chart.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500) });
  importInput.addEventListener('change',async()=>{ const f=importInput.files?.[0]; if(!f)return; try{ const txt=await f.text(); const data=JSON.parse(txt); notes=(data.notes||[]).map(n=>({t:n.t,lane:n.lane,end:n.end})).sort((a,b)=>a.t-b.t); firstNoteTime=notes.length?notes[0].t:0; playBtn.disabled=notes.length===0; jumpFirstBtn.disabled=notes.length===0; setHUD(); }catch{ alert('File chart tidak valid') } });

  // ===== Generators =====
  async function generateChart(buf,difficulty='normal'){
    const sr=buf.sampleRate; const mono=toMono(buf);
    const hop=512, frame=1024;
    const nFrames = Math.max(0, Math.floor((mono.length - frame)/hop));
    const win=new Float32Array(frame); for(let i=0;i<frame;i++) win[i]=.5*(1-Math.cos(2*Math.PI*i/(frame-1)));
    const prevMag=new Float32Array(frame/2+1); const flux=new Float32Array(nFrames); let idx=0;
    for(let i=0;i<nFrames;i++){ const seg=new Float32Array(frame); for(let j=0;j<frame;j++) seg[j]=(mono[idx+j]||0)*win[j]; const N=frame,kmax=N/2; let sf=0; for(let k=0;k<=kmax;k++){ let re=0,im=0; for(let n=0;n<N;n++){ const ang=2*Math.PI*k*n/N; re+=seg[n]*Math.cos(ang); im-=seg[n]*Math.sin(ang) } const mag=Math.sqrt(re*re+im*im); const d=Math.max(0,mag-prevMag[k]); sf+=d; prevMag[k]=mag } flux[i]=Math.log10(1e-8+sf); idx+=hop }
    const mean=flux.reduce((a,b)=>a+b,0)/(nFrames||1); const std=Math.sqrt(flux.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(nFrames||1))||1; const norm=Array.from(flux, e=>(e-mean)/std);
    const thrWin=16; const peaks=[];
    for(let i=thrWin;i<nFrames-thrWin;i++){ let local=0; for(let k=-thrWin;k<=thrWin;k++) local+=norm[i+k]; local/=(2*thrWin+1); const v=norm[i]-local; const isMax=norm[i]>=norm[i-1]&&norm[i]>=norm[i+1]; if(v>.8&&isMax){ const t=(i*hop+frame/2)/sr; peaks.push(t) } }
    const IOI=[]; for(let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]); let bpm=120; if(IOI.length){ const hist=new Map(); for(const d of IOI){ if(d<=0)continue; let b=60/d; while(b<60)b*=2; while(b>190)b/=2; const key=Math.round(b); hist.set(key,(hist.get(key)||0)+1) } let best=120,count=-1; for(const [k,v] of hist.entries()){ if(v>count){count=v;best=k} } bpm=best }
    const beat=60/bpm; let bestOff=0,bestErr=1e9; for(let s=0;s<48;s++){ const off=s*(beat/48); let err=0,cnt=0; for(const t of peaks){ const r=(t-off)%beat; const d=Math.min(r,beat-r); err+=d*d; cnt++ } if(cnt&&err<bestErr){bestErr=err;bestOff=off} }
    let grid=beat/2, keep=1.0; if(difficulty==='easy'){ grid=beat/1; keep=.6 } if(difficulty==='hard'){ grid=beat/4; keep=1.0 }
    const times=[]; let last=-999; for(const t of peaks){ if(Math.random()>keep)continue; const q=Math.round((t-bestOff)/grid)*grid+bestOff; if(q-last>.08){ times.push(q); last=q } }
    function laneForTime(t){ const i=Math.max(0,Math.round(t*sr)); const val=((i*1315423911)>>>0); return val%4 }
    const chart=[]; for(let i=0;i<times.length;i++){ const t=times[i],lane=laneForTime(t); const next=times[i+1]??(t+2*beat); const gap=next-t; let end=null; if(gap>beat*.9 && Math.random()<.35) end=t+Math.min(gap*.8,1.2); chart.push(end?{t,lane,end}:{t,lane}) }
    const dur=buf.duration; return chart.filter(n=>n.t>.5&&n.t<dur-.2).sort((a,b)=>a.t-b.t);
  }
  async function generateChartEnergy(buf,difficulty='normal'){
    const sr=buf.sampleRate; const mono=toMono(buf); const hop=512,frame=1024,nFrames=Math.floor((mono.length-frame)/hop);
    const energy=new Float32Array(nFrames); let idx=0; for(let i=0;i<nFrames;i++){ let s=0; for(let j=0;j<frame;j++){ const v=mono[idx+j]; s+=v*v } energy[i]=Math.log10(1e-12+s); idx+=hop }
    const mean=energy.reduce((a,b)=>a+b,0)/Math.max(1,nFrames); const std=Math.sqrt(energy.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,nFrames))||1;
    const norm=Array.from(energy,e=>(e-mean)/std); const peaks=[]; for(let i=2;i<nFrames-2;i++){ const v=norm[i]; if(v>1.0 && v>=norm[i-1] && v>=norm[i+1]) peaks.push((i*hop+frame/2)/sr) }
    let bpm=120; if(peaks.length>1){ const IOI=[]; for(let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]); const hist=new Map(); for(const d of IOI){ if(d<=0)continue; let b=60/d; while(b<60)b*=2; while(b>180)b/=2; const k=Math.round(b); hist.set(k,(hist.get(k)||0)+1) } let best=120,cnt=-1; for(const [k,v] of hist.entries()){ if(v>cnt){cnt=v;best=k} } bpm=best }
    const beat=60/bpm; let grid=beat/2,keep=1.0; if(difficulty==='easy'){grid=beat/1;keep=.6} if(difficulty==='hard'){grid=beat/4;keep=1.0}
    const times=[]; let last=-999; for(const t of peaks){ const q=Math.round(t/grid)*grid; if(q-last>.08){ times.push(q); last=q } }
    function laneForTime(t){ const i=Math.max(0,Math.round(t*sr)); const val=((i*2654435761)>>>0); return val%4 }
    const dur=buf.duration; return times.filter(t=>t>.5 && t<dur-.2).map((t,i)=>({t,lane:laneForTime(t)})).sort((a,b)=>a.t-b.t);
  }
  function toMono(buf){ const chs=buf.numberOfChannels,len=buf.length,out=new Float32Array(len); for(let c=0;c<chs;c++){ const d=buf.getChannelData(c); for(let i=0;i<len;i++) out[i]+=d[i]/chs } return out }

  // ===== HUD =====
  function setHUD(){ const st=audioCtx?audioCtx.state:'-'; const dur=buffer?buffer.duration.toFixed(2):'-'; const n=notes.length; const f=notes[0]?notes[0].t.toFixed(2):'-'; hud.hidden=false; hud.textContent=`AC:${st}  dur:${dur}s  notes:${n}  first:${f}s`; }

  // ===== Render boot =====
  function draw(t){ const W=canvas.width,H=canvas.height,LANES=4,JUDGE=.85; const laneW=W/LANES, judgeY=H*JUDGE; const pxPerSec=350*speedMultiplier, windowAfter=12.0; const colors=['#3b82f6','#22c55e','#eab308','#ef4444'], glow=['#93c5fd','#86efac','#fde68a','#fca5a5']; const ctx=canvas.getContext('2d'); ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H); for(let i=0;i<LANES;i++){ ctx.fillStyle=colors[i]+'22'; ctx.fillRect(i*laneW,0,laneW,H) } ctx.strokeStyle='#ffffff66'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,judgeY); ctx.lineTo(W,judgeY); ctx.stroke(); ctx.shadowBlur=0; for(const n of notes){ const dt=n.t-t; if(dt>windowAfter) break; const y=judgeY-dt*pxPerSec; const x=(n.lane+.5)*laneW; const w=laneW*.7,h=20; const near=Math.abs(y-judgeY)<24; ctx.shadowBlur=near?16:0; ctx.shadowColor=glow[n.lane]; if(n.end!=null){ const endY=judgeY-(n.end-t)*pxPerSec; ctx.fillStyle=colors[n.lane]+'AA'; ctx.fillRect(x-w*.35,Math.min(y,endY),w*.7,Math.abs(endY-y)) } ctx.fillStyle=colors[n.lane]; ctx.fillRect(x-w/2,y-h/2,w,h) } }
  function loop(){}

  // init sizes & draw once
  window.dispatchEvent(new Event('resize'));
  draw(0);
  setHUD();

}catch(err){ console.error('Boot error',err); }
})();