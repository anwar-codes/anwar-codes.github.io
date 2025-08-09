(function(){
'use strict';
try{
  const $=sel=>document.querySelector(sel);
  const on=(el,ev,fn,opt)=>el&&el.addEventListener(ev,fn,opt);

  // Expose fallback handlers for inline onclick
  window.__togglePanel = ()=>togglePanelClick();
  window.__analyze = ()=>onAnalyzeClick();

  let audioCtx, buffer=null, selectedFile=null;
  let startCtxTime=0, startSongTime=0, pausedAt=0, gameState='idle';

  const fileInput = $('#fileInput'), analyzeBtn=$('#analyzeBtn'), playBtn=$('#playBtn'), pauseBtn=$('#pauseBtn'), restartBtn=$('#restartBtn');
  const statusDot=$('#statusDot'), fileNameEl=$('#fileName'), togglePanelBtn=$('#togglePanel'), panel=$('#panel');
  const canvas=$('#game'); const ctx=canvas.getContext('2d',{alpha:false});
  const latencyInput=$('#latencyInput'); const speedInput=$('#speedInput'); const speedVal=$('#speedVal');
  const LANES=4, JUDGE=.85; let W=0,H=0, speedMultiplier=1.0;

  function ensureAudio(){ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }
  function unlockAudio(){
    try{ ensureAudio(); const b=audioCtx.createBuffer(1,1,22050); const s=audioCtx.createBufferSource(); s.buffer=b; s.connect(audioCtx.destination); s.start ? s.start(0) : s.noteOn(0); }catch(e){}
  }
  ['pointerdown','touchstart','mousedown','keydown'].forEach(ev=> on(window,ev,unlockAudio,{passive:false,once:true,capture:true}));

  function setStatus(ok){ statusDot.classList.toggle('st-ok',ok); statusDot.classList.toggle('st-bad',!ok); }
  function setAnalyzeEnabled(v){ if(!analyzeBtn)return; analyzeBtn.disabled=!v; analyzeBtn.classList.toggle('pulse', !!v); }

  function resize(){
    const lanesH = 56 + 8*2;
    const topbarH = document.getElementById('topbar').offsetHeight;
    const panelH = panel.classList.contains('open') ? panel.scrollHeight : 0;
    const hh = topbarH + panelH + lanesH;
    const avail = Math.max(160, window.innerHeight - hh);
    canvas.width = window.innerWidth;
    canvas.height = Math.round(avail);
    W=canvas.width; H=canvas.height;
    draw();
  }
  on(window,'resize',resize);

  function draw(){
    ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
    const laneW=W/LANES, judgeY=H*JUDGE;
    ctx.strokeStyle='#ffffff40'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,judgeY); ctx.lineTo(W,judgeY); ctx.stroke();
    ctx.globalAlpha=.1; for(let i=0;i<LANES;i++){ ctx.fillStyle=['#3b82f6','#22c55e','#eab308','#ef4444'][i]; ctx.fillRect(i*laneW,0,laneW,H); } ctx.globalAlpha=1;
  }

  function afterSelect(){
    selectedFile = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (fileNameEl) fileNameEl.textContent = selectedFile ? ' — ' + selectedFile.name : '';
    buffer = null; setStatus(false);
    setAnalyzeEnabled(!!selectedFile);
    if (playBtn){ playBtn.disabled=true; } if (pauseBtn){ pauseBtn.disabled=true; } if (restartBtn){ restartBtn.disabled=true; }
  }

  function togglePanelClick(){
    if (!panel) return;
    const open = panel.classList.toggle('open');
    panel.setAttribute('aria-expanded', open?'true':'false');
    try{ localStorage.setItem('panelOpen', open?'1':'0'); }catch{}
    resize();
  }

  // multi-event binding for iOS reliability
  ['click','pointerdown','touchstart'].forEach(ev=> on(togglePanelBtn, ev, (e)=>{ e.preventDefault(); togglePanelClick(); }, {passive:false}));

  // Restore open state
  try{ if (localStorage.getItem('panelOpen')==='0') panel.classList.remove('open'); }catch{}

  on(fileInput,'change', afterSelect, {passive:false});

  function decodeArrayBuffer(ab){
    ensureAudio();
    return new Promise((resolve,reject)=>{
      try{
        const p = audioCtx.decodeAudioData(ab, b=>resolve(b), e=>reject(e));
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
      // Minimal generation
      const notes = await generateChart(buffer);
      window.__notes = notes;
      if (playBtn) playBtn.disabled = notes.length===0;
    }catch(err){
      console.error(err); alert('Gagal membuka audio. Coba MP3/WAV/OGG di Chrome iOS terbaru.');
      setAnalyzeEnabled(true); setStatus(false);
    }
  }
  ['click','pointerdown','touchstart'].forEach(ev=> on(analyzeBtn, ev, (e)=>{ e.preventDefault(); unlockAudio(); onAnalyzeClick(); }, {passive:false}));

  function audioTime(){ if(!audioCtx) return 0; return (audioCtx.currentTime-startCtxTime)+startSongTime }
  function startPlayback(){
    if (!buffer) return;
    ensureAudio();
    const offset = (gameState==='paused') ? pausedAt : 0;
    const s = audioCtx.createBufferSource(); const g = audioCtx.createGain();
    s.buffer = buffer; s.connect(g).connect(audioCtx.destination);
    startCtxTime = audioCtx.currentTime; startSongTime = offset;
    s.start(0, offset); s.onended=()=>{ if(gameState==='playing') gameState='ended'; };
    window.__src = s;
    gameState='playing';
  }
  ['click','pointerdown','touchstart'].forEach(ev=> on($('#playBtn'), ev, (e)=>{ e.preventDefault(); startPlayback(); }, {passive:false}));

  async function generateChart(buffer){
    const sr = buffer.sampleRate, chs=buffer.numberOfChannels, len=buffer.length;
    const mono=new Float32Array(len); for(let c=0;c<chs;c++){ const d=buffer.getChannelData(c); for(let i=0;i<len;i++) mono[i]+=d[i]/chs; }
    const hop=512, frame=1024, nFrames=Math.floor((len-frame)/hop); const energy=new Float32Array(nFrames); let idx=0;
    for(let i=0;i<nFrames;i++){ let s=0; for(let j=0;j<frame;j++){ const v=mono[idx+j]; s+=v*v; } energy[i]=Math.log10(1e-12+s); idx+=hop; }
    const mean=energy.reduce((a,b)=>a+b,0)/nFrames; const std=Math.sqrt(energy.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nFrames);
    const norm=Array.from(energy,e=>(e-mean)/(std||1)); const peaks=[];
    for(let i=2;i<nFrames-2;i++){ const v=norm[i]; if(v>1.0 && v>=norm[i-1] && v>=norm[i+1]) peaks.push((i*hop+frame/2)/sr); }
    let bpm=120;if(peaks.length>1){ const IOI=[]; for(let i=1;i<peaks.length;i++) IOI.push(peaks[i]-peaks[i-1]); const hist=new Map();
      for(const d of IOI){ if(d<=0) continue; let b=60/d; while(b<60)b*=2; while(b>180)b/=2; const k=Math.round(b); hist.set(k,(hist.get(k)||0)+1); }
      let best=120,cnt=-1; for(const [k,v] of hist.entries()){ if(v>cnt){cnt=v;best=k;} } bpm=best; }
    const beat=60/bpm, grid=beat/2, times=[]; let last=-999;
    for(const t of peaks){ const q=Math.round(t/grid)*grid; if(q-last>.08){ times.push(q); last=q; } }
    const dur=buffer.duration; return times.filter(t=>t>.5 && t<dur-.2).map((t,i)=>({t,lane:i%4}));
  }

  // Initial
  resize(); setStatus(false); setAnalyzeEnabled(false); draw();

}catch(err){
  console.error('Boot error',err);
  const el = document.getElementById('jsError'); if (el) el.hidden=false;
}})();