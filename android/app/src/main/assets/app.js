'use strict';

// FretSense Multi-Instrument v5 — guitar, keyboard, ukulele and violin modes run on-device.
// Guitar Isolation offers a fully offline fast DSP mode and an optional on-device
// HT-Demucs 6-stem AI mode whose runtime + model are downloaded once and cached.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_TO_SHARP = {Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};
const OPEN_STRING_MIDI = {6:40,5:45,4:50,3:55,2:59,1:64};
const OPEN_STRING_NAMES = {6:'E',5:'A',4:'D',3:'G',2:'B',1:'E'};
const INSTRUMENTS = {
  guitar:{key:'guitar',name:'Guitar',short:'GTR',tuning:'E A D G B E',melodyView:'6-string tab',strings:[{id:1,name:'e',midi:64},{id:2,name:'B',midi:59},{id:3,name:'G',midi:55},{id:4,name:'D',midi:50},{id:5,name:'A',midi:45},{id:6,name:'E',midi:40}],maxFret:17,capo:true,rhythm:'strum',note:'Standard guitar mode: chord diagrams, capo shapes, six-string melody tabs and strumming guidance.'},
  keyboard:{key:'keyboard',name:'Keyboard',short:'KEY',tuning:'Chromatic',melodyView:'note + octave timeline',strings:[],maxFret:0,capo:false,rhythm:'keys',note:'Keyboard mode shows chord tones, note names with octaves and scale keys instead of string tabs.'},
  ukulele:{key:'ukulele',name:'Ukulele',short:'UKE',tuning:'G C E A',melodyView:'4-string tab',strings:[{id:1,name:'A',midi:69},{id:2,name:'E',midi:64},{id:3,name:'C',midi:60},{id:4,name:'G',midi:67}],maxFret:15,capo:true,rhythm:'strum',note:'Ukulele mode uses common re-entrant G–C–E–A tuning with ukulele chord shapes and four-string tabs.'},
  violin:{key:'violin',name:'Violin',short:'VLN',tuning:'G D A E',melodyView:'4-string position guide',strings:[{id:1,name:'E',midi:76},{id:2,name:'A',midi:69},{id:3,name:'D',midi:62},{id:4,name:'G',midi:55}],maxFret:12,capo:false,rhythm:'bow',note:'Violin mode maps melody notes to G–D–A–E strings. Position numbers represent semitone distance from the open string, not traditional frets.'}
};
function instrumentProfile(){return INSTRUMENTS[state.instrument]||INSTRUMENTS.guitar;}

const ANALYSIS_SR = 11025;
const ANALYSIS_FFT = 2048;
const ANALYSIS_HOP = 2048;
const AI_MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx';
const ORT_JS_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.wasm';

const state = {
  platform:'android', song:null, songId:null, audioFile:null, audioBuffer:null,
  audioObjectUrl:null, transpose:0, capo:0, loopA:null, loopB:null, loop:false,
  editIndex:null, live:null, tuner:null, analysisFrames:null, monoAnalysis:null,
  isolationUrls:[], aiSession:null, aiModelReady:false, analysisRunId:0, instrument:localStorage.getItem('fs_instrument')||'guitar'
};

function fmtTime(sec){ sec=Math.max(0,Number(sec)||0); const m=Math.floor(sec/60), s=Math.floor(sec%60); return `${m}:${String(s).padStart(2,'0')}`; }
function escapeHtml(s){ return String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]||m)); }
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function nextPaint(){return new Promise(r=>requestAnimationFrame(()=>r()));}
function parseChord(c){ const m=String(c||'').trim().match(/^([A-G](?:#|b)?)(m7|maj7|m|7)?$/); if(!m)return null; const root=FLAT_TO_SHARP[m[1]]||m[1]; return {pc:NOTES.indexOf(root),quality:m[2]||''}; }
function transposeChord(c,n){ const p=parseChord(c); if(!p)return c; return NOTES[(p.pc+n+120)%12]+p.quality; }
function currentTimeline(){return state.song?.timeline||[];}
function displayedChord(c){return transposeChord(c,state.transpose||0);} // Sounding chord after optional key transpose.
function playableChord(c){
  const sounding=displayedChord(c);
  const p=instrumentProfile();
  return p.capo&&state.capo ? transposeChord(sounding,-state.capo) : sounding;
}
function median(a){if(!a.length)return 0; const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}

// ---------- Navigation ----------
const pages = {analyze:'Analyze Song',instrument:'Instrument',practice:'Practice',strumming:'Rhythm Studio',isolation:'Guitar Isolation',capo:'Capo',transpose:'Transpose',live:'Live Chord',tuner:'Tuner',metronome:'Metronome',scales:'Scale Finder',library:'My Songs',connection:'Offline Engine'};
$$('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
function showView(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.remove('active'));
  const view=$('#view-'+name); if(view)view.classList.add('active');
  $('#pageTitle').textContent=pages[name]||name;
  if(name==='instrument')renderInstrumentView();
  if(name==='library')loadLibrary();
  if(name==='practice')syncPractice();
  if(name==='strumming')renderStrummingStudio();
  if(name==='isolation')checkIsolationStatus();
  if(name==='connection')refreshOfflineStatus();
}
$('#serverDot').classList.add('ok');
$('#serverStatus').textContent='On-device engine ready';
$('#platformBadge').textContent='MULTI v5.2.2';


// ---------- Instrument mode ----------
function chordToneNames(chord){
  const p=parseChord(chord); if(!p)return [];
  let ints=[0,4,7];
  if(p.quality==='m')ints=[0,3,7];
  else if(p.quality==='7')ints=[0,4,7,10];
  else if(p.quality==='m7')ints=[0,3,7,10];
  else if(p.quality==='maj7')ints=[0,4,7,11];
  return ints.map(i=>NOTES[(p.pc+i)%12]);
}
function midiLabel(m){return `${NOTES[(m+120)%12]}${Math.floor(m/12)-1}`;}
function setInstrument(key){
  if(!INSTRUMENTS[key])return;
  state.instrument=key; localStorage.setItem('fs_instrument',key);
  renderInstrumentView(); applyInstrumentUi();
  if(state.song){ renderTimeline(); renderCommon(); renderAnalysisExtras(); findSmartCapo(); updateCurrentChord(); renderStrummingStudio(); if($('#scaleRoot')?.value)renderScale($('#scaleRoot').value,$('#scaleType').value); }
  if(typeof refreshTransposeCapoControl==='function'){refreshTransposeCapoControl();updateTransposeTool();}
}
function renderInstrumentView(){
  const p=instrumentProfile();
  $$('.instrument-card').forEach(c=>c.classList.toggle('active',c.dataset.instrument===state.instrument));
  if($('#instrumentActiveName'))$('#instrumentActiveName').textContent=p.name;
  if($('#instrumentTuning'))$('#instrumentTuning').textContent=p.tuning;
  if($('#instrumentMelodyView'))$('#instrumentMelodyView').textContent=p.melodyView;
  if($('#instrumentNote'))$('#instrumentNote').textContent=p.note;
  if($('#currentInstrumentBadge'))$('#currentInstrumentBadge').textContent=p.name.toUpperCase();
}
function applyInstrumentUi(){
  const p=instrumentProfile();
  if($('#melodyToolDescription'))$('#melodyToolDescription').textContent=p.key==='keyboard'?'Choose a short section and convert the detected melody into note names and octaves.':p.key==='violin'?'Choose a short section and map melody notes to violin strings and playable positions.':`Choose a short section and estimate single-note ${p.name.toLowerCase()} positions.`;
  if($('#tabPanelHeading'))$('#tabPanelHeading').textContent=p.key==='keyboard'?'Estimated keyboard melody notes':`Estimated ${p.name.toLowerCase()} positions`;
  if($('#liveChordHeading'))$('#liveChordHeading').textContent=`Let the microphone listen to your ${p.name.toLowerCase()}.`;
  if($('#scaleHeading'))$('#scaleHeading').textContent=p.key==='keyboard'?'See scale notes across the keyboard.':`See notes across the ${p.name.toLowerCase()} layout.`;
  if($('#openScaleBtn'))$('#openScaleBtn').textContent=p.key==='keyboard'?'Open keyboard':p.key==='violin'?'Open fingerboard':'Open fretboard';
  if($('#tabAccuracyNote'))$('#tabAccuracyNote').textContent=p.key==='violin'?'Pitch tracking is an estimate. Violin position numbers are semitone locations from the open string and may need fingering adjustment.':'Pitch tracking is an estimate and dense mixes can still confuse melody detection.';
  const capoBtn=$('.nav-btn[data-view="capo"]'); if(capoBtn)capoBtn.classList.toggle('instrument-limited',!p.capo);
  renderInstrumentView();
}
$$('.instrument-card').forEach(c=>c.addEventListener('click',()=>setInstrument(c.dataset.instrument)));
$('#instrumentQuick')?.addEventListener('click',()=>showView('instrument'));
applyInstrumentUi();

// ---------- IndexedDB ----------
let dbPromise=null;
function openDb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open('fretsense_standalone_v4',2);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('songs'))db.createObjectStore('songs',{keyPath:'id'});
      if(!db.objectStoreNames.contains('models'))db.createObjectStore('models',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function dbPut(store,value){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function dbGet(store,key){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function dbAll(store){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
async function dbDelete(store,key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

// ---------- File selection ----------
const drop=$('#dropzone'), fileInput=$('#audioFile');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f){try{fileInput.files=e.dataTransfer.files}catch{} setPickedFile(f);}});
fileInput.addEventListener('change',()=>{if(fileInput.files[0])setPickedFile(fileInput.files[0]);});
function setPickedFile(f){
  state.audioFile=f;
  drop.querySelector('strong').textContent=f.name;
  $('#songTitle').value=f.name.replace(/\.[^.]+$/,'');
  prepareForFreshAnalysis(f);
}

function clearSongWorkspace(){
  state.song=null; state.songId=null; state.transpose=0; state.capo=0; state.loopA=null; state.loopB=null; state.loop=false; state.editIndex=null; state.analysisFrames=null; state.monoAnalysis=null;
  const player=$('#audioPlayer');
  if(player){ player.pause(); player.removeAttribute('src'); player.load(); player.playbackRate=1; player.currentTime=0; }
  if(state.audioObjectUrl){ URL.revokeObjectURL(state.audioObjectUrl); state.audioObjectUrl=null; }
  clearIsolationUrls();
  $('#emptyCurrent').classList.remove('hidden'); $('#currentSummary').classList.add('hidden'); $('#analysisWorkspace').classList.add('hidden');
  $('#currentTitle').textContent='—'; $('#keyStat').textContent='—'; $('#bpmStat').textContent='—'; $('#capoStat').textContent='—'; $('#durationStat').textContent='—';
  $('#commonChords').innerHTML=''; $('#timeline').innerHTML=''; $('#strumPattern').textContent='—'; $('#strumMiniGrid').innerHTML=''; $('#strumNote').textContent=''; $('#scaleSuggestion').textContent='—'; $('#scaleNotes').innerHTML='';
  $('#nowChord').textContent='—'; $('#nextChord').textContent='—'; $('#shapeNow').textContent='—'; $('#chordDiagram').innerHTML=''; $('#loopReadout').textContent='A — / B —'; $('#transposeValue').textContent='ORIGINAL';
  $('#practiceHint').textContent='Analyze or open a saved song first.'; $('#practiceCurrent').textContent='—'; $('#practiceNext').textContent='—';
  $('#tabPanel')?.classList.add('hidden'); if($('#tabOutput'))$('#tabOutput').textContent=''; if($('#stemPlayers'))$('#stemPlayers').innerHTML=''; if($('#isolationStatus'))$('#isolationStatus').innerHTML='';
}

function prepareForFreshAnalysis(file){
  clearSongWorkspace();
  if(file){ state.audioFile=file; drop.querySelector('strong').textContent=file.name; }
}

// ---------- Audio decode / resample ----------
async function decodeFile(file){
  const raw=await file.arrayBuffer();
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  try{return await ctx.decodeAudioData(raw.slice(0));}finally{ctx.close().catch(()=>{});}
}
function resampleChannel(src,srcRate,targetRate){
  if(srcRate===targetRate)return Float32Array.from(src);
  const n=Math.max(1,Math.floor(src.length*targetRate/srcRate)),out=new Float32Array(n),ratio=srcRate/targetRate;
  for(let i=0;i<n;i++){const x=i*ratio,j=Math.floor(x),f=x-j;out[i]=(src[j]||0)*(1-f)+(src[Math.min(j+1,src.length-1)]||0)*f;}
  return out;
}
function monoAtRate(buf,targetRate){
  const channels=[];for(let c=0;c<buf.numberOfChannels;c++)channels.push(resampleChannel(buf.getChannelData(c),buf.sampleRate,targetRate));
  const n=channels[0].length,out=new Float32Array(n),k=1/channels.length;
  for(let c=0;c<channels.length;c++){const a=channels[c];for(let i=0;i<n;i++)out[i]+=a[i]*k;}
  return out;
}
function stereoAt44100(buf){
  const l=resampleChannel(buf.getChannelData(0),buf.sampleRate,44100);
  const r=resampleChannel(buf.getChannelData(Math.min(1,buf.numberOfChannels-1)),buf.sampleRate,44100);
  return [l,r];
}

// ---------- FFT / chroma ----------
const hannCache=new Map();
function hann(n){if(hannCache.has(n))return hannCache.get(n);const w=new Float32Array(n);for(let i=0;i<n;i++)w[i]=.5-.5*Math.cos(2*Math.PI*i/(n-1));hannCache.set(n,w);return w;}
function fft(re,im){
  const n=re.length; let j=0;
  for(let i=1;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wlr=Math.cos(ang),wli=Math.sin(ang);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let k=0;k<len/2;k++){const uR=re[i+k],uI=im[i+k],vR=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vI=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=uR+vR;im[i+k]=uI+vI;re[i+k+len/2]=uR-vR;im[i+k+len/2]=uI-vI;const nwr=wr*wlr-wi*wli;wi=wr*wli+wi*wlr;wr=nwr;}}}
}
function frameChroma(samples,start,sr,n=ANALYSIS_FFT){
  const re=new Float32Array(n),im=new Float32Array(n),w=hann(n);
  let rms=0;for(let i=0;i<n;i++){const x=samples[start+i]||0;re[i]=x*w[i];rms+=x*x;}fft(re,im);
  const chr=new Float64Array(12),bass=new Float64Array(12),mags=new Float64Array(n/2);
  for(let k=2;k<n/2;k++)mags[k]=Math.hypot(re[k],im[k]);
  let peakMag=0,peakFreq=0;
  for(let k=3;k<n/2-1;k++){
    const freq=k*sr/n;if(freq<55||freq>1900)continue;
    const mag=mags[k];if(mag<=0)continue;
    const isPeak=mag>=mags[k-1]&&mag>=mags[k+1];
    const wt=Math.pow(mag,.42)*(isPeak?1:.22);
    const midi=Math.round(69+12*Math.log2(freq/440)),pc=((midi%12)+12)%12;
    chr[pc]+=wt;
    if(freq<=330)bass[pc]+=wt*Math.pow(330/Math.max(freq,55),.18);
    if(freq>=75&&freq<=1200&&mag>peakMag){peakMag=mag;peakFreq=freq;}
  }
  const norm=chr.reduce((a,b)=>a+b,0)||1,bnorm=bass.reduce((a,b)=>a+b,0)||1;
  return{chroma:Array.from(chr,x=>x/norm),bassChroma:Array.from(bass,x=>x/bnorm),rms:Math.sqrt(rms/n),peakFreq};
}
async function extractChromaFrames(samples,sr,onProgress){
  const frames=[];const total=Math.max(1,Math.floor((samples.length-ANALYSIS_FFT)/ANALYSIS_HOP)+1);
  for(let f=0;f<total;f++){const start=f*ANALYSIS_HOP,info=frameChroma(samples,start,sr);frames.push({...info,time:(start+ANALYSIS_FFT/2)/sr});if(f%28===0){onProgress?.(f/total);await nextPaint();}}
  return frames;
}

// ---------- BPM ----------
function estimateBpm(samples,sr){
  const hop=256,win=1024,n=Math.max(1,Math.floor((samples.length-win)/hop));const env=new Float32Array(n);let prev=0;
  for(let f=0;f<n;f++){let e=0;const st=f*hop;for(let i=1;i<win;i+=2){const d=(samples[st+i]||0)-(samples[st+i-1]||0);e+=d*d;}e=Math.sqrt(e/(win/2));const onset=Math.max(0,e-prev*.92);env[f]=onset;prev=e;}
  const mean=env.reduce((a,b)=>a+b,0)/env.length;for(let i=0;i<env.length;i++)env[i]=Math.max(0,env[i]-mean*.45);
  let bestBpm=100,best=-Infinity;for(let bpm=55;bpm<=190;bpm+=.5){const lag=Math.round((60/bpm)*sr/hop);if(lag<1||lag>=env.length)continue;let sum=0,a2=0,b2=0;for(let i=lag;i<env.length;i++){const a=env[i],b=env[i-lag];sum+=a*b;a2+=a*a;b2+=b*b;}let score=sum/Math.sqrt((a2||1)*(b2||1));if(bpm>=70&&bpm<=150)score*=1.025;if(score>best){best=score;bestBpm=bpm;}}
  if(bestBpm>155)bestBpm/=2;if(bestBpm<65)bestBpm*=2;return Math.round(bestBpm*10)/10;
}

function estimateBeatPhase(samples,sr,bpm){
  const beat=60/Math.max(1,bpm),hop=256,win=1024,points=[];let prev=0;
  for(let st=0;st+win<samples.length;st+=hop){
    let e=0;for(let i=1;i<win;i+=2){const d=(samples[st+i]||0)-(samples[st+i-1]||0);e+=d*d;}
    e=Math.sqrt(e/(win/2));const onset=Math.max(0,e-prev*.90);prev=e;points.push({t:st/sr,o:onset});
  }
  const vals=points.map(p=>p.o),thr=median(vals)*1.9,bins=32,hist=Array(bins).fill(0);
  for(const p of points){if(p.o<thr)continue;const phase=((p.t%beat)+beat)%beat,bi=Math.floor(phase/beat*bins)%bins;hist[bi]+=p.o;}
  let best=0;for(let i=1;i<bins;i++)if(hist[i]>hist[best])best=i;
  return ((best+.5)/bins)*beat;
}

// ---------- Key ----------
const MAJOR_PROFILE=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function corr(a,b){const am=a.reduce((x,y)=>x+y,0)/a.length,bm=b.reduce((x,y)=>x+y,0)/b.length;let num=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-am,y=b[i]-bm;num+=x*y;da+=x*x;db+=y*y;}return num/Math.sqrt((da||1)*(db||1));}
function estimateKey(frames){const sum=Array(12).fill(0);frames.forEach(fr=>fr.chroma.forEach((v,i)=>sum[i]+=v*Math.max(.1,fr.rms)));let best={root:'C',mode:'major',score:-9};for(let r=0;r<12;r++){for(const [mode,p] of [['major',MAJOR_PROFILE],['minor',MINOR_PROFILE]]){const rot=Array.from({length:12},(_,i)=>p[(i-r+12)%12]),s=corr(sum,rot);if(s>best.score)best={root:NOTES[r],mode,score:s};}}return best;}

// ---------- Chords ----------
const CHORD_TEMPLATES=[['',[0,4,7]],['m',[0,3,7]],['7',[0,4,7,10]],['m7',[0,3,7,10]]];
function keyChordBonus(keyInfo,rootPc,quality){
  if(!keyInfo)return 0;
  const kp=NOTES.indexOf(FLAT_TO_SHARP[keyInfo.root]||keyInfo.root);if(kp<0)return 0;
  const rel=(rootPc-kp+12)%12;
  if(keyInfo.mode==='major'){
    const triads={0:'',2:'m',4:'m',5:'',7:'',9:'m'};
    if(triads[rel]===quality)return .060;
    if(rel===7&&quality==='7')return .065;
    if([0,2,4,5,7,9,11].includes(rel))return .018;
  }else{
    const triads={0:'m',3:'',5:'m',7:'m',8:'',10:''};
    if(triads[rel]===quality)return .060;
    if(rel===7&&(quality===''||quality==='7'))return .045;
    if([0,2,3,5,7,8,10].includes(rel))return .018;
  }
  return 0;
}
function chordCandidates(chroma,bassChroma=null,keyInfo=null){
  const bass=bassChroma||Array(12).fill(0),out=[];
  for(let r=0;r<12;r++)for(const [q,ints] of CHORD_TEMPLATES){
    let pos=0;ints.forEach((iv,k)=>{const weights=(q==='7'||q==='m7')?[1.24,1.02,.86,.58]:[1.24,1.04,.88];pos+=chroma[(r+iv)%12]*(weights[k]||.7);});
    let outside=0;for(let i=0;i<12;i++)if(!ints.includes((i-r+12)%12))outside+=chroma[i];
    const rootBass=bass[r]||0,fifthBass=bass[(r+7)%12]||0;
    const complexity=(q==='7'||q==='m7')?.075:0;
    const score=pos-outside*.34+rootBass*.22+fifthBass*.035+keyChordBonus(keyInfo,r,q)-complexity;
    out.push({chord:NOTES[r]+q,score});
  }
  return out.sort((a,b)=>b.score-a.score);
}
function chordForRange(frames,start,end,keyInfo,previousChord=null){
  const selected=frames.filter(fr=>fr.time>=start&&fr.time<end);
  if(!selected.length){const near=frames.reduce((a,b)=>Math.abs(b.time-(start+end)/2)<Math.abs(a.time-(start+end)/2)?b:a,frames[0]);const c=chordCandidates(near.chroma,near.bassChroma,keyInfo);return{chord:c[0].chord,confidence:.25};}
  const c=Array(12).fill(0),bass=Array(12).fill(0);let wsum=0;
  for(const fr of selected){const w=clamp(fr.rms*7,.12,1);wsum+=w;fr.chroma.forEach((v,i)=>c[i]+=v*w);(fr.bassChroma||[]).forEach((v,i)=>bass[i]+=v*w);}
  for(let i=0;i<12;i++){c[i]/=wsum||1;bass[i]/=wsum||1;}
  const cand=chordCandidates(c,bass,keyInfo),best=cand[0],second=cand[1];
  let chosen=best;
  if(previousChord){const prev=cand.find(x=>simplifyChord(x.chord)===simplifyChord(previousChord));if(prev&&best.score-prev.score<.045)chosen=prev;}
  const ref=chosen===best?second:best,diff=chosen.score-ref.score;
  return{chord:chosen.chord,confidence:clamp(.48+Math.max(0,diff)*3.1,.35,.96)};
}
function simplifyChord(c){const p=parseChord(c);if(!p)return c;if(p.quality==='m7')return NOTES[p.pc]+'m';if(p.quality==='7')return NOTES[p.pc];return c;}
function detectTimeline(frames,bpm,duration,keyInfo,beatPhase=0){
  const beat=60/Math.max(1,bpm),beats=[];
  let grid=Math.max(0,beatPhase-beat*.12),prev=null;if(grid>beat*.35)grid=0;
  for(let t=grid;t<duration;t+=beat){
    const start=Math.max(0,t-beat*.08),end=Math.min(duration,t+beat*.92),hit=chordForRange(frames,start,end,keyInfo,prev);
    if(['7','m7'].includes(parseChord(hit.chord)?.quality)&&hit.confidence<.76)hit.chord=simplifyChord(hit.chord);
    beats.push({...hit,start:t,end:Math.min(duration,t+beat)});prev=hit.chord;
  }
  for(let pass=0;pass<2;pass++)for(let i=1;i<beats.length-1;i++){
    const a=simplifyChord(beats[i-1].chord),b=simplifyChord(beats[i].chord),c=simplifyChord(beats[i+1].chord);
    if(a===c&&b!==a&&beats[i].confidence<.82){beats[i].chord=beats[i-1].chord;beats[i].confidence=(beats[i-1].confidence+beats[i+1].confidence)/2;}
  }
  for(let i=0;i<beats.length;i++){const q=parseChord(beats[i].chord)?.quality;if(q==='7'||q==='m7'){const fam=simplifyChord(beats[i].chord),left=i>0&&simplifyChord(beats[i-1].chord)===fam,right=i+1<beats.length&&simplifyChord(beats[i+1].chord)===fam;if(!left&&!right)beats[i].chord=fam;}}
  const seg=[];for(const b of beats){const last=seg.at(-1);if(last&&simplifyChord(last.chord)===simplifyChord(b.chord)){last.end=b.end;last.confidence=(last.confidence+b.confidence)/2;}else seg.push({...b});}
  for(let i=1;i<seg.length-1;i++)if(seg[i].end-seg[i].start<=beat*1.06&&seg[i].confidence<.66){const L=seg[i-1],R=seg[i+1];if(simplifyChord(L.chord)===simplifyChord(R.chord)||Math.max(L.confidence,R.confidence)-seg[i].confidence>.14){if(L.confidence>=R.confidence||simplifyChord(L.chord)===simplifyChord(R.chord)){L.end=seg[i].end;seg.splice(i,1);i--;}else{R.start=seg[i].start;seg.splice(i,1);i--;}}}
  return seg;
}
function commonChords(timeline){const m=new Map();timeline.forEach(s=>{const c=simplifyChord(s.chord);m.set(c,(m.get(c)||0)+(s.end-s.start));});return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);}

// ---------- Rhythm / strumming attack grid ----------
function estimateOnsetGrid(samples,sr,bpm){
  const safeBpm=clamp(Number(bpm)||100,40,240);
  const beat=60/safeBpm,sub=beat/4,slots=16;
  const acc=Array(slots).fill(0);
  const hop=Math.max(64,Math.round(sr*sub/4)),win=Math.max(128,hop*2);
  let prev=0;const peaks=[];
  for(let st=0;st+win<samples.length;st+=hop){
    let e=0,n=0;
    for(let i=1;i<win;i+=4){const d=(samples[st+i]||0)-(samples[st+i-1]||0);e+=d*d;n++;}
    e=Math.sqrt(e/Math.max(1,n));
    const onset=Math.max(0,e-prev*.88);prev=e;
    peaks.push({t:st/sr,o:onset});
  }
  if(!peaks.length){
    const grid=['D','-','-','-','D','-','-','-','D','-','-','-','D','-','-','-'];
    return{pattern:grid.join(' '),grid,subdivision:'16th-note',confidence:.35,note:'Not enough rhythmic information was detected, so a basic quarter-note guide is shown.'};
  }
  const vals=peaks.map(x=>x.o).filter(Number.isFinite);
  const threshold=Math.max(1e-8,median(vals)*2.15);
  for(const p of peaks){
    if(!Number.isFinite(p.o)||p.o<threshold)continue;
    const phase=((p.t%(beat*4))+(beat*4))%(beat*4);
    const slot=Math.round(phase/sub)%slots;
    acc[slot]+=p.o;
  }
  const mx=Math.max(...acc,1e-8),strength=acc.map(v=>v/mx);
  const active=strength.map((v,i)=>v>(i%4===0?.18:.30));
  if(active.filter(Boolean).length<3)[0,4,8,12].forEach(i=>active[i]=true);
  const eighthOnly=active.every((v,i)=>!v||i%2===0);
  const subdivision=eighthOnly?'8th-note':'16th-note';
  const grid=active.map((v,i)=>v?(i%2===0?'D':'U'):'-');
  const confidence=clamp(.45+(active.filter(Boolean).length/16)*.35,.45,.88);
  return{pattern:grid.join(' '),grid,subdivision,confidence,note:'Attack rhythm is measured locally. D/U is a playable picking suggestion, not a guaranteed reconstruction of the performer’s exact hand direction.'};
}

// ---------- Full local analysis ----------
async function analyzeSelectedSong(file,title){
  const runId=++state.analysisRunId;
  updateAnalyzeProgress('Decoding audio…',8); const buf=await decodeFile(file); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); state.audioBuffer=buf; await nextPaint();
  updateAnalyzeProgress('Preparing local audio…',18); const mono=monoAtRate(buf,ANALYSIS_SR); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); state.monoAnalysis=mono; await nextPaint();
  updateAnalyzeProgress('Finding tempo…',26); const bpm=estimateBpm(mono,ANALYSIS_SR); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); await nextPaint();
  updateAnalyzeProgress('Reading harmony…',34); const frames=await extractChromaFrames(mono,ANALYSIS_SR,p=>updateAnalyzeProgress('Reading harmony…',34+p*38)); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); state.analysisFrames=frames;
  updateAnalyzeProgress('Detecting key and chords…',76); const key=estimateKey(frames),beatPhase=estimateBeatPhase(mono,ANALYSIS_SR,bpm),timeline=detectTimeline(frames,bpm,buf.duration,key,beatPhase),common=commonChords(timeline); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); await nextPaint();
  updateAnalyzeProgress('Mapping strumming attacks…',88); const strumming=estimateOnsetGrid(mono,ANALYSIS_SR,bpm); if(runId!==state.analysisRunId) throw new Error('Analysis cancelled.'); await nextPaint();
  const id=Date.now(); const result={id,title:title||file.name.replace(/\.[^.]+$/,''),filename:file.name,duration:buf.duration,bpm,key:{root:key.root,mode:key.mode,confidence:clamp((key.score+1)/2,.35,.96)},timeline,common_chords:common,strumming,created_at:new Date().toISOString()};
  updateAnalyzeProgress('Saving analysis…',96); await saveSongRecord(result,file); updateAnalyzeProgress('Done',100); return result;
}
function updateAnalyzeProgress(text,pct){const bar=$('#analyzeProgress');bar.querySelector('span').textContent=text;bar.querySelector('div').style.width=`${clamp(pct,0,100)}%`;}

$('#analyzeBtn').onclick=async()=>{
  const f=fileInput.files[0]||state.audioFile; if(!f) return alert('Choose an audio file first.');
  prepareForFreshAnalysis(f);
  $('#analyzeProgress').classList.remove('hidden'); $('#analyzeBtn').disabled=true;
  try{ const result=await analyzeSelectedSong(f,$('#songTitle').value.trim()); setSong(result,{file:f,buffer:state.audioBuffer}); }
  catch(e){ if(String(e?.message||e).includes('cancelled')) return; console.error(e); alert('Could not analyze this audio on the phone. '+(e?.message||e)); }
  finally{ setTimeout(()=>$('#analyzeProgress').classList.add('hidden'),400); $('#analyzeBtn').disabled=false; }
};

async function saveSongRecord(song,file){try{await dbPut('songs',{id:song.id,title:song.title,analysis:song,audio:file});}catch(e){console.warn('Library save failed',e);}}

function setSong(data,opts={}){
  state.song=data.analysis||data;state.songId=state.song.id||data.id;state.audioFile=opts.file||state.audioFile;state.audioBuffer=opts.buffer||state.audioBuffer;state.transpose=0;state.capo=0;state.loopA=state.loopB=null;state.loop=false;
  $('#emptyCurrent').classList.add('hidden');$('#currentSummary').classList.remove('hidden');$('#analysisWorkspace').classList.remove('hidden');
  $('#currentTitle').textContent=state.song.title||'Song';$('#keyStat').textContent=`${state.song.key.root} ${state.song.key.mode}`;$('#bpmStat').textContent=Math.round(state.song.bpm||0);$('#durationStat').textContent=fmtTime(state.song.duration);$('#transposeValue').textContent='ORIGINAL';
  if(state.audioObjectUrl)URL.revokeObjectURL(state.audioObjectUrl);if(state.audioFile){state.audioObjectUrl=URL.createObjectURL(state.audioFile);$('#audioPlayer').src=state.audioObjectUrl;}
  $('#audioPlayer').playbackRate=1;$('#speedSelect').value='1';renderCommon();renderTimeline();renderAnalysisExtras();updateLoopReadout();syncPractice();renderStrummingStudio();findSmartCapo();syncSongToTransposeTool();checkIsolationStatus();
}
function renderCommon(){$('#commonChords').innerHTML=(state.song?.common_chords||[]).map(c=>`<span class="chip">${escapeHtml(playableChord(c))}</span>`).join('');}
function renderTimeline(){
  const tl=currentTimeline();
  $('#timeline').innerHTML=tl.map((s,i)=>{
    const sounding=displayedChord(s.chord),play=playableChord(s.chord),diff=play!==sounding;
    return `<div class="timeline-card" data-i="${i}"><strong>${escapeHtml(play)}</strong>${diff?`<em class="sounding-chord">sounds ${escapeHtml(sounding)}</em>`:''}<span>${fmtTime(s.start)} – ${fmtTime(s.end)}</span><small>${Math.round((s.confidence||0)*100)}% confidence</small></div>`;
  }).join('');
  $$('.timeline-card').forEach(el=>el.onclick=()=>openEdit(Number(el.dataset.i)));updateCurrentChord();
}
function renderAnalysisExtras(){if(!state.song)return;const root=transposeChord(state.song.key.root,state.transpose||0),mode=state.song.key.mode,scale=mode==='minor'?'minor_pentatonic':'major_pentatonic';$('#keyStat').textContent=`${root} ${mode}`;$('#scaleSuggestion').textContent=`${root} ${mode==='minor'?'Minor':'Major'} Pentatonic`;const notes=localScale(root,scale);$('#scaleNotes').innerHTML=notes.map(n=>`<span class="chip">${n}</span>`).join('');const st=state.song.strumming||{};$('#strumPattern').textContent=st.pattern||'—';$('#strumNote').textContent=st.note||'';renderStrumGrid($('#strumMiniGrid'),st.grid||[],true);}

// ---------- Player / loops ----------
const player=$('#audioPlayer');
player.addEventListener('timeupdate',()=>{if(state.loop&&state.loopA!=null&&state.loopB!=null&&player.currentTime>=state.loopB){player.currentTime=state.loopA;player.play();}updateCurrentChord();syncPractice();});
$('#speedSelect').onchange=e=>player.playbackRate=Number(e.target.value);
$('#setA').onclick=()=>{state.loopA=player.currentTime;updateLoopReadout()};$('#setB').onclick=()=>{state.loopB=player.currentTime;if(state.loopA!=null&&state.loopB<state.loopA)[state.loopA,state.loopB]=[state.loopB,state.loopA];updateLoopReadout()};
$('#toggleLoop').onclick=()=>{state.loop=!state.loop;$('#toggleLoop').textContent=state.loop?'Loop On':'Loop Off';$('#toggleLoop').classList.toggle('active',state.loop)};
$('#clearLoop').onclick=()=>{state.loopA=state.loopB=null;state.loop=false;$('#toggleLoop').textContent='Loop Off';updateLoopReadout()};
function updateLoopReadout(){$('#loopReadout').textContent=`A ${state.loopA==null?'—':fmtTime(state.loopA)} / B ${state.loopB==null?'—':fmtTime(state.loopB)}`;}
function getActiveIndex(){const t=player.currentTime||0,arr=currentTimeline();let idx=arr.findIndex(s=>t>=s.start&&t<s.end);if(idx<0&&arr.length){idx=0;for(let i=0;i<arr.length;i++)if(arr[i].start<=t)idx=i;}return idx;}
function updateCurrentChord(){
  const idx=getActiveIndex(),arr=currentTimeline();
  $$('.timeline-card').forEach((c,i)=>c.classList.toggle('active',i===idx));
  if(idx<0||!arr[idx])return;
  const sounding=displayedChord(arr[idx].chord),play=playableChord(arr[idx].chord);
  const nextSounding=arr[idx+1]?displayedChord(arr[idx+1].chord):'—';
  const nextPlay=arr[idx+1]?playableChord(arr[idx+1].chord):'—';
  $('#nowChord').textContent=play; $('#nextChord').textContent=nextPlay;
  const p=instrumentProfile();
  if(p.key==='keyboard') $('#shapeNow').textContent=(chordToneNames(play).join(' · ')||play);
  else if(p.key==='violin') $('#shapeNow').textContent='Arpeggio: '+(chordToneNames(play).join(' · ')||play);
  else if(state.capo) $('#shapeNow').textContent=`Play ${play} shape · sounds ${sounding} (capo ${state.capo})`;
  else if(state.transpose) $('#shapeNow').textContent=`Play ${play} · key transpose ${state.transpose>0?'+':''}${state.transpose}`;
  else $('#shapeNow').textContent=`Play ${play} (original)`;
  // Main diagram follows what the player physically plays.
  renderChordDiagram(play);
}

function openEdit(i){state.editIndex=i;const s=currentTimeline()[i];$('#editTime').textContent=`${fmtTime(s.start)} – ${fmtTime(s.end)}`;$('#editChordInput').value=s.chord;$('#editDialog').showModal();}
$('#saveChordEdit').addEventListener('click',async e=>{e.preventDefault();const c=$('#editChordInput').value.trim();if(!parseChord(c))return alert('Use a chord like C, F#m, Bb, Am7, E7 or Cmaj7.');currentTimeline()[state.editIndex].chord=c;renderTimeline();state.song.common_chords=commonChords(currentTimeline());renderCommon();await persistCurrentAnalysis();$('#editDialog').close();findSmartCapo();});
async function persistCurrentAnalysis(){if(!state.songId)return;const rec=await dbGet('songs',state.songId).catch(()=>null);if(rec){rec.analysis=state.song;rec.title=state.song.title;await dbPut('songs',rec).catch(()=>{});}}
function refreshActiveTransposeDisplay(){
  if(!state.song)return;
  const p=instrumentProfile();
  let label='ORIGINAL';
  if(state.transpose!==0 && p.capo && state.capo) label=`${state.transpose>0?'+':''}${state.transpose} · CAPO ${state.capo}`;
  else if(state.transpose!==0) label=state.transpose>0?`+${state.transpose}`:`${state.transpose}`;
  else if(p.capo && state.capo) label=`CAPO ${state.capo}`;
  if($('#transposeValue'))$('#transposeValue').textContent=label;
  renderCommon(); renderTimeline(); renderAnalysisExtras(); updateCurrentChord(); syncPractice(); findSmartCapo();
}
function changeSongTranspose(n){state.transpose=clamp(Number(n)||0,-11,11);trValue=state.transpose;refreshActiveTransposeDisplay();updateTransposeTool();}

// ---------- Capo ----------
const EASY_DEFAULT=['C','D','E','G','A','Am','Dm','Em'];
function localCapoOptions(chords,allowed=EASY_DEFAULT){const set=new Set(allowed),opts=[];for(let capo=0;capo<=11;capo++){const shapes=chords.map(c=>transposeChord(c,-capo)),easy=shapes.filter(c=>set.has(c)).length;opts.push({capo,shapes,easy_ratio:chords.length?easy/chords.length:0});}return opts.sort((a,b)=>b.easy_ratio-a.easy_ratio||a.capo-b.capo);}
function findSmartCapo(){
  const p=instrumentProfile(),originalChords=[...(state.song?.common_chords||[])].slice(0,8),chords=originalChords.map(displayedChord);
  if(!chords.length)return;
  if(!p.capo){
    state.capo=0; $('#capoStat').textContent='—';
    $('#bestCapoHeading').textContent=`${p.name} does not use a capo`;
    $('#capoOptions').innerHTML='<div class="capo-option"><strong>Original chords stay unchanged</strong><div class="muted">Use the Transpose tool if you intentionally want to change key.</div></div>';
    updateCurrentChord(); return;
  }
  state.capo=clamp(Number(state.capo)||0,0,12);
  $('#capoStat').textContent=state.capo===0?'No':state.capo;
  $('#bestCapoHeading').textContent='Choose where you want to place the capo';
  const options=Array.from({length:13},(_,i)=>`<option value="${i}" ${state.capo===i?'selected':''}>${i===0?'No capo':`Fret ${i}`}</option>`).join('');
  const shapes=chords.map(c=>transposeChord(c,-state.capo));
  $('#capoOptions').innerHTML=`
    <label class="manual-capo-label">Capo position<select id="analysisCapoSelect">${options}</select></label>
    <div class="capo-original"><span>ORIGINAL SONG CHORDS</span><strong>${originalChords.map(escapeHtml).join(' · ')}</strong></div>
    ${state.transpose!==0?`<div class="capo-original"><span>ACTIVE TRANSPOSED CHORDS (${state.transpose>0?'+':''}${state.transpose})</span><strong>${chords.map(escapeHtml).join(' · ')}</strong></div>`:''}
    <div class="capo-shapes"><span>PLAY THESE SHAPES</span><strong>${shapes.map(escapeHtml).join(' · ')}</strong></div>
    <p class="muted">Original chords are kept as the source. When you transpose, the active chords and capo shapes update together.</p>`;
  $('#analysisCapoSelect')?.addEventListener('change',e=>{
    state.capo=Number(e.target.value)||0;
    $('#capoStat').textContent=state.capo===0?'No':state.capo;
    if($('#transposeCapo'))$('#transposeCapo').value=String(state.capo);
    refreshActiveTransposeDisplay(); updateTransposeTool();
  });
  updateCurrentChord();
}
$('#findCapoBtn').onclick=()=>{
  const p=instrumentProfile();
  if(!p.capo){$('#capoFinderResults').innerHTML=`<div class="result-card best"><strong>${escapeHtml(p.name)}</strong><span>This instrument does not use a capo.</span><span>Use Transpose instead.</span></div>`;return;}
  const chords=$('#capoInput').value.trim().split(/[\s,]+/).filter(Boolean);
  if(!chords.length)return alert('Enter the original song chords first.');
  const capo=Number($('#capoManualSelect')?.value||0);
  const shapes=chords.map(c=>transposeChord(c,-capo));
  $('#capoFinderResults').innerHTML=`<div class="result-card best"><strong>${capo?`Capo fret ${capo}`:'No capo'}</strong><span>Original: ${chords.map(escapeHtml).join(' · ')}</span><span>Play: ${shapes.map(escapeHtml).join(' · ')}</span></div>`;
  if(state.song){state.capo=capo;$('#capoStat').textContent=capo===0?'No':capo;if($('#transposeCapo'))$('#transposeCapo').value=String(capo);refreshActiveTransposeDisplay();updateTransposeTool();}
};

// ---------- Chord diagrams ----------
const CHORD_SHAPES={C:['x','3','2','0','1','0'],D:['x','x','0','2','3','2'],E:['0','2','2','1','0','0'],F:['1','3','3','2','1','1'],G:['3','2','0','0','0','3'],A:['x','0','2','2','2','0'],B:['x','2','4','4','4','2'],Am:['x','0','2','2','1','0'],Dm:['x','x','0','2','3','1'],Em:['0','2','2','0','0','0'],Bm:['x','2','4','4','3','2'],Fm:['1','3','3','1','1','1'],E7:['0','2','0','1','0','0'],A7:['x','0','2','0','2','0'],D7:['x','x','0','2','1','2'],Cmaj7:['x','3','2','0','0','0'],Am7:['x','0','2','0','1','0'],Em7:['0','2','0','0','0','0']};
const UKE_SHAPES={C:['0','0','0','3'],D:['2','2','2','0'],E:['1','4','0','2'],F:['2','0','1','0'],G:['0','2','3','2'],A:['2','1','0','0'],B:['4','3','2','2'],Am:['2','0','0','0'],Dm:['2','2','1','0'],Em:['0','4','3','2'],Bm:['4','2','2','2'],A7:['0','1','0','0'],D7:['2','0','2','0'],E7:['1','2','0','2']};

function guitarMovableSpec(chord){
  // Preserve familiar open-position shapes whenever we already have one.
  if(CHORD_SHAPES[chord]) return {frets:CHORD_SHAPES[chord],startFret:1,label:'Open / standard shape'};
  const p=parseChord(chord); if(!p)return null;
  const q=p.quality||'';
  const patterns={
    '':{E:[0,2,2,1,0,0],A:['x',0,2,2,2,0]},
    'm':{E:[0,2,2,0,0,0],A:['x',0,2,2,1,0]},
    '7':{E:[0,2,0,1,0,0],A:['x',0,2,0,2,0]},
    'm7':{E:[0,2,0,0,0,0],A:['x',0,2,0,1,0]},
    'maj7':{E:[0,2,1,1,0,0],A:['x',0,2,1,2,0]}
  };
  const family=patterns[q]; if(!family)return null;
  const candidates=[];
  const defs=[{name:'E-shape barre',rootPc:4,rel:family.E},{name:'A-shape barre',rootPc:9,rel:family.A}];
  defs.forEach(d=>{
    const base=(p.pc-d.rootPc+12)%12;
    const frets=d.rel.map(v=>v==='x'?'x':base+Number(v));
    const positives=frets.filter(v=>v!=='x'&&Number(v)>0).map(Number);
    const max=Math.max(0,...positives),min=Math.min(...positives,99);
    // Prefer lower positions and compact diagrams.
    const score=(base===0?0:base)+Math.max(0,max-min)*.12;
    candidates.push({frets,startFret:(base===0?1:base),label:d.name,score,base});
  });
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]||null;
}

function renderStringShape(shape,stringNames,opts={}){
  const numeric=shape.filter(f=>f!=='x'&&Number(f)>0).map(Number);
  const maxFret=Math.max(0,...numeric),minFret=Math.min(...numeric,99);
  let startFret=Number(opts.startFret)||1;
  if(maxFret<=4&&minFret<=1)startFret=1;
  else if(minFret!==99)startFret=Math.max(1,Math.min(startFret,minFret));
  const visibleFrets=4;
  let html=`<div class="active-diagram-meta"><span>${escapeHtml(opts.chord||'')}</span>${startFret>1?`<small>FRET ${startFret}</small>`:''}</div>`;
  html+=`<div class="diagram-grid instrument-diagram" style="grid-template-columns:repeat(${shape.length},22px)">`;
  shape.forEach((f,i)=>{
    html+=`<div class="string"><span style="position:absolute;top:-18px;left:7px;font-size:10px;color:#9da3ad">${escapeHtml(stringNames[i]||'')}</span>`;
    for(let k=1;k<=visibleFrets;k++)html+=`<div class="fret-line" style="top:${k*22}px"></div>`;
    if(f!=='x'&&f!=='0'){
      const actual=Number(f),row=actual-startFret+1;
      if(row>=1&&row<=visibleFrets)html+=`<div class="fret-dot" style="left:0;top:${(row-.5)*22}px"></div>`;
    }
    html+='</div>';
  });
  html+='</div>';
  html+=`<div class="shape-numbers">${shape.map(escapeHtml).join(' · ')}</div>`;
  if(opts.label)html+=`<div class="diagram-shape-label">${escapeHtml(opts.label)}</div>`;
  return html;
}

function renderChordDiagram(chord){
  const p=instrumentProfile();
  if(p.key==='keyboard'){
    const tones=chordToneNames(chord); $('#chordDiagram').innerHTML=`<div class="instrument-theory"><span>ACTIVE CHORD · ${escapeHtml(chord)}</span><strong>${tones.map(escapeHtml).join(' · ')||'—'}</strong><small>Play these notes together or arpeggiate them.</small></div>`; return;
  }
  if(p.key==='violin'){
    const tones=chordToneNames(chord); $('#chordDiagram').innerHTML=`<div class="instrument-theory"><span>ACTIVE CHORD · ${escapeHtml(chord)}</span><strong>${tones.map(escapeHtml).join(' · ')||'—'}</strong><small>Violin mode treats detected chords as arpeggio / double-stop reference tones.</small></div>`; return;
  }
  if(p.key==='ukulele'){
    const shape=UKE_SHAPES[chord];
    if(!shape){$('#chordDiagram').innerHTML=`<div class="muted"><b>${escapeHtml(chord)}</b> is the active chord. No built-in ukulele diagram is available for this voicing yet.</div>`;return;}
    $('#chordDiagram').innerHTML=renderStringShape(shape,['G','C','E','A'],{chord,label:'Active ukulele chord'}); return;
  }
  const spec=guitarMovableSpec(chord);
  if(!spec){$('#chordDiagram').innerHTML=`<div class="muted"><b>${escapeHtml(chord)}</b> is the active chord. No built-in guitar diagram is available for this chord quality.</div>`;return;}
  $('#chordDiagram').innerHTML=renderStringShape(spec.frets,['E','A','D','G','B','e'],{chord,startFret:spec.startFret,label:spec.label});
}

// ---------- Melody tab beta ----------
function estimatePitchAtTime(samples,sr,time){
  const n=2048;
  const start=clamp(Math.floor(time*sr - n/2),0,Math.max(0,samples.length-n));
  const seg=samples.subarray(start,start+n);
  let mean=0; for(let i=0;i<seg.length;i++) mean+=seg[i]; mean/=Math.max(1,seg.length);
  const x=new Float32Array(seg.length); let rms=0;
  for(let i=0;i<seg.length;i++){ const v=seg[i]-mean; x[i]=v; rms+=v*v; }
  rms=Math.sqrt(rms/x.length); if(rms<0.012) return null;
  const minLag=Math.floor(sr/1200), maxLag=Math.min(Math.floor(sr/70), x.length-2);
  let bestLag=-1, bestCorr=0;
  for(let lag=minLag; lag<=maxLag; lag++){
    let sum=0,a=0,b=0;
    for(let i=0;i<x.length-lag;i++){ const xi=x[i], yi=x[i+lag]; sum+=xi*yi; a+=xi*xi; b+=yi*yi; }
    const corr=sum/Math.sqrt((a||1)*(b||1));
    if(corr>bestCorr){ bestCorr=corr; bestLag=lag; }
  }
  if(bestLag<0||bestCorr<0.58) return null;
  const cAt=(lag)=>{ let sum=0,a=0,b=0; for(let i=0;i<x.length-lag;i++){ const xi=x[i], yi=x[i+lag]; sum+=xi*yi; a+=xi*xi; b+=yi*yi; } return sum/Math.sqrt((a||1)*(b||1)); };
  const l=Math.max(minLag,bestLag-1), r=Math.min(maxLag,bestLag+1);
  const y1=cAt(l), y2=cAt(bestLag), y3=cAt(r);
  const denom=(y1 - 2*y2 + y3);
  const shift=Math.abs(denom)>1e-6 ? 0.5*(y1-y3)/denom : 0;
  const refined=bestLag + clamp(shift,-1,1);
  const freq=sr/refined;
  return (freq>=70 && freq<=1200) ? {freq,confidence:bestCorr,rms} : null;
}
function smoothMidiSeries(items){
  if(items.length<3) return items;
  for(let i=1;i<items.length-1;i++){
    const prev=items[i-1]?.midi, cur=items[i]?.midi, next=items[i+1]?.midi;
    if(prev!=null && next!=null && Math.abs(prev-next)<=1 && Math.abs(cur-prev)>=2 && Math.abs(cur-next)>=2) items[i].midi=Math.round((prev+next)/2);
  }
  return items;
}
function bestInstrumentPosition(midi,prev){
  const p=instrumentProfile(); if(p.key==='keyboard')return null;
  let best=null;
  for(const st of p.strings){const pos=midi-st.midi;if(pos<0||pos>p.maxFret)continue;const score=pos*.07+(prev?Math.abs(pos-prev.fret)*.26+Math.abs(st.id-prev.string)*.48:0);if(!best||score<best.score)best={string:st.id,stringName:st.name,fret:pos,score};}
  return best;
}
function buildKeyboardMelody(segments){
  if(!segments.length)return 'No stable melody notes detected in this section.';
  const notes=smoothMidiSeries(segments.map(s=>({...s}))).slice(0,64);
  const lines=[]; let group=[];
  for(const n of notes){group.push(`${fmtTime(n.start)}  ${midiLabel(n.midi)}`); if(group.length===8){lines.push(group.join('   '));group=[];}}
  if(group.length)lines.push(group.join('   '));
  return `KEYBOARD MELODY\n\n${lines.join('\\n')}\n\nPlay the note names from left to right. The number is the octave.`;
}
function buildTabFromSegments(segments,start,end){
  if(!segments.length) return 'No stable lead or melody notes detected in this section.';
  const p=instrumentProfile(); if(p.key==='keyboard')return buildKeyboardMelody(segments);
  const notes=smoothMidiSeries(segments.map(s=>({...s}))); let prevPos=null;
  const placed=notes.map(n=>{const pos=bestInstrumentPosition(n.midi,prevPos);prevPos=pos||prevPos;return pos?{...n,...pos}:null;}).filter(Boolean);
  if(!placed.length)return `The melody is outside the practical ${p.name.toLowerCase()} range for this section.`;
  const lines={}; p.strings.forEach(st=>lines[st.id]=`${st.name}|`); let cursor=start;
  placed.slice(0,64).forEach(n=>{const unit=.12,lead=Math.max(1,Math.round((n.start-cursor)/unit)),hold=Math.max(1,Math.round((n.end-n.start)/unit)),posStr=String(n.fret);for(const st of p.strings){lines[st.id]+='-'.repeat(lead);lines[st.id]+=st.id===n.string?posStr+'-'.repeat(Math.max(0,hold*2-posStr.length)):'-'.repeat(Math.max(posStr.length,hold*2));}cursor=n.end;});
  p.strings.forEach(st=>lines[st.id]+='|');
  const legend=placed.slice(0,10).map(n=>`${fmtTime(n.start)} ${midiLabel(n.midi)} · ${n.stringName} string · ${p.key==='violin'?'position':'fret'} ${n.fret}`).join('\\n');
  const help=p.key==='violin'?'Position number = semitones above the open string. Use it as a pitch-location guide, then choose comfortable violin fingering.':'0 = open string; number = fret.';
  return p.strings.map(st=>lines[st.id]).join('\\n')+`\n\n${p.name.toUpperCase()} MELODY GUIDE\n${legend}\n\n${help}`;
}
$('#tabBtn').onclick=async()=>{
  if(!state.song||!state.monoAnalysis) return alert('Analyze a song first.');
  let start=Number($('#tabStart').value)||0, end=Number($('#tabEnd').value)||Math.min(start+20,state.song.duration);
  end=Math.min(end,start+30,state.song.duration);
  $('#tabBtn').disabled=true; $('#tabBtn').textContent='Estimating…';
  try{
    const step=.08, raw=[];
    for(let t=start; t<end; t+=step){
      const p=estimatePitchAtTime(state.monoAnalysis,ANALYSIS_SR,t);
      if(p){ const midi=Math.round(69+12*Math.log2(p.freq/440)); if(midi>=40&&midi<=88) raw.push({time:t,midi,confidence:p.confidence}); }
      if(raw.length%24===0) await nextPaint();
    }
    const segments=[];
    for(const item of raw){
      const last=segments[segments.length-1];
      if(last && item.time-last.end<.18 && Math.abs(item.midi-last.midi)<=1){
        last.end=item.time;
        last.midi=Math.round((last.midi+item.midi)/2);
        last.hits=(last.hits||1)+1;
      }else{
        segments.push({start:item.time,end:item.time+step,midi:item.midi,hits:1});
      }
    }
    const filtered=segments.filter(s=>s.hits>=2 || (s.end-s.start)>=.16);
    $('#tabOutput').textContent=buildTabFromSegments(filtered,start,end);
    $('#tabPanel').classList.remove('hidden');
  }catch(e){ alert(e.message); }
  finally{ $('#tabBtn').disabled=false; $('#tabBtn').textContent='Generate Tab'; }
};
$('#copyTab').onclick=()=>navigator.clipboard?.writeText($('#tabOutput').textContent||'');

// ---------- Strumming studio ----------
let strumTrainerTimer=null,strumTrainerIndex=0,strumTrainerRate=1;
function renderStrumGrid(el,tokens,compact=false){if(!el)return;if(!tokens.length){el.innerHTML='<span class="muted">No pattern loaded.</span>';return;}const p=instrumentProfile();el.innerHTML=tokens.map((t,i)=>{let label=t;if(p.rhythm==='keys'&&t!=='-')label='●';if(p.rhythm==='bow'&&t==='D')label='DB';if(p.rhythm==='bow'&&t==='U')label='UB';return `<div class="strum-slot ${t==='-'?'rest':t==='D'?'down':'up'}" data-slot="${i}"><span>${escapeHtml(label)}</span>${compact?'':`<small>${i+1}</small>`}</div>`;}).join('');}
function renderStrummingStudio(){const st=state.song?.strumming;if(!state.song||!st){$('#strumSongHint').textContent='Analyze or open a song first.';renderStrumGrid($('#strumStudioGrid'),[]);return;}const p=instrumentProfile();$('#strumSongHint').textContent=`${state.song.title} · ${p.rhythm==='bow'?'bowing':p.rhythm==='keys'?'key-attack':'strumming'} rhythm guide`;$('#strumSubdivision').textContent=st.subdivision;$('#strumConfidence').textContent=`${Math.round(st.confidence*100)}%`;$('#strumTempo').textContent=`${Math.round(state.song.bpm)} BPM`;renderStrumGrid($('#strumStudioGrid'),st.grid||[]);$('#strumBeatLabels').innerHTML=(st.grid||[]).map((_,i)=>`<span>${['1','e','&','a','2','e','&','a','3','e','&','a','4','e','&','a'][i]||''}</span>`).join('');$('#strumStudioNote').textContent=p.rhythm==='bow'?'DB/UB = suggested down-bow / up-bow motion derived from the attack grid.':p.rhythm==='keys'?'Dots mark detected rhythmic attacks; use them as keyboard rhythm cues.':st.note;}
$('#openStrumBtn').onclick=()=>showView('strumming');
$('#strumTrainerToggle').onclick=()=>{if(strumTrainerTimer){clearInterval(strumTrainerTimer);strumTrainerTimer=null;$('#strumTrainerToggle').textContent='Start Pattern Trainer';$$('#strumStudioGrid .strum-slot').forEach(x=>x.classList.remove('playing'));return;}if(!state.song)return alert('Analyze a song first.');const slots=state.song.strumming.grid.length,bpm=state.song.bpm;strumTrainerIndex=0;strumTrainerTimer=setInterval(()=>{const els=$$('#strumStudioGrid .strum-slot');els.forEach(x=>x.classList.remove('playing'));if(els[strumTrainerIndex])els[strumTrainerIndex].classList.add('playing');strumTrainerIndex=(strumTrainerIndex+1)%slots;},(60/bpm/4)*1000/strumTrainerRate);$('#strumTrainerToggle').textContent='Stop Pattern Trainer';};
$$('.strumRate').forEach(b=>b.onclick=()=>{strumTrainerRate=Number(b.dataset.rate);$$('.strumRate').forEach(x=>x.classList.toggle('active',x===b));if(strumTrainerTimer){clearInterval(strumTrainerTimer);strumTrainerTimer=null;$('#strumTrainerToggle').click();}});

// ---------- Practice ----------
function syncPractice(){if(!state.song){$('#practiceHint').textContent='Analyze or open a saved song first.';$('#practiceCurrent').textContent=$('#practiceNext').textContent='—';return;}const p=instrumentProfile();$('#practiceHint').textContent=`${state.song.title} · ${Math.round(player.playbackRate*100)}% speed${p.capo&&state.capo?` · capo ${state.capo}`:''}`;const i=getActiveIndex(),tl=currentTimeline();$('#practiceCurrent').textContent=tl[i]?playableChord(tl[i].chord):'—';$('#practiceNext').textContent=tl[i+1]?playableChord(tl[i+1].chord):'—';}
$('#practicePlay').onclick=()=>{if(!state.song)return alert('Analyze or open a saved song first.');player.paused?player.play():player.pause();};$$('.rateBtn').forEach(b=>b.onclick=()=>{player.playbackRate=Number(b.dataset.rate);$('#speedSelect').value=String(player.playbackRate);syncPractice();});

// ---------- Transpose ----------
let trValue=0;
function refreshTransposeCapoControl(){
  const p=instrumentProfile(),sel=$('#transposeCapo');if(!sel)return;
  sel.disabled=!p.capo;if(!p.capo)sel.value='0';
  $('#transposeCapoHint').textContent=p.capo?`${p.name}: choose a capo fret. If you transpose the song, the active chords and shapes update together.`:`${p.name} does not use a capo; key transpose updates the active notes directly.`;
}
function updateTransposeTool(){
  const original=$('#transposeInput').value.trim().split(/[\s,]+/).filter(Boolean),p=instrumentProfile();
  const capo=p.capo?Number($('#transposeCapo')?.value||0):0;
  const sounding=original.map(c=>transposeChord(c,trValue));
  const shapes=p.capo?sounding.map(c=>transposeChord(c,-capo)):sounding;
  $('#trBigValue').textContent=trValue>0?`+${trValue}`:trValue;
  if($('#originalChordResult'))$('#originalChordResult').textContent=original.join(' · ')||'—';
  $('#transposeResult').textContent=trValue===0?'No key change — original key':sounding.join(' · ');
  $('#transposeShapeResult').textContent=p.capo?(capo?`Capo fret ${capo}: play ${shapes.join(' · ')}`:`No capo: play ${shapes.join(' · ')}`):`Play ${shapes.join(' · ')}`;
}
function syncSongToTransposeTool(){
  if(!state.song)return;
  const original=(state.song.common_chords||[]).join(' ');
  if(original)$('#transposeInput').value=original;
  trValue=state.transpose||0;
  if($('#transposeCapo'))$('#transposeCapo').value=String(instrumentProfile().capo?state.capo:0);
  refreshTransposeCapoControl(); updateTransposeTool();
}
$('#trDown').onclick=()=>{trValue=clamp(trValue-1,-11,11);if(state.song){state.transpose=trValue;refreshActiveTransposeDisplay();}updateTransposeTool();};
$('#trUp').onclick=()=>{trValue=clamp(trValue+1,-11,11);if(state.song){state.transpose=trValue;refreshActiveTransposeDisplay();}updateTransposeTool();};
$('#transposeInput').oninput=updateTransposeTool;
$('#transposeCapo')?.addEventListener('change',e=>{const p=instrumentProfile();if(p.capo&&state.song){state.capo=Number(e.target.value)||0;$('#capoStat').textContent=state.capo===0?'No':state.capo;refreshActiveTransposeDisplay();}updateTransposeTool();});
$('#useSongChords')?.addEventListener('click',()=>{if(!state.song)return alert('Analyze or open a song first.');syncSongToTransposeTool();});
refreshTransposeCapoControl();updateTransposeTool();

// ---------- Live chord + tuner ----------
async function getMic(){return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});}
function makeAnalyser(stream,fftSize=4096){const ctx=new (window.AudioContext||window.webkitAudioContext)(),src=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=fftSize;analyser.smoothingTimeConstant=.68;src.connect(analyser);return{ctx,stream,analyser};}
function spectrumChroma(analyser,ctx){const arr=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(arr);const chroma=Array(12).fill(0);for(let i=2;i<arr.length;i++){const freq=i*ctx.sampleRate/analyser.fftSize;if(freq<70||freq>1500)continue;const db=arr[i];if(db<-80)continue;const midi=69+12*Math.log2(freq/440),pc=((Math.round(midi)%12)+12)%12;chroma[pc]+=Math.pow(10,db/20);}const norm=chroma.reduce((a,b)=>a+b,0)||1;return chroma.map(v=>v/norm);}
function matchChord(chroma){const c=chordCandidates(chroma);return{name:c[0]?.chord||'—',score:clamp(.5+(c[0].score-c[1].score)*2,.25,.99)};}
function stopMic(obj){if(!obj)return;cancelAnimationFrame(obj.raf);obj.stream.getTracks().forEach(t=>t.stop());obj.ctx.close().catch(()=>{});}
$('#liveBtn').onclick=async()=>{if(state.live){stopMic(state.live);state.live=null;$('#liveBtn').textContent='Start Listening';$('#liveChord').textContent='—';$('#liveConfidence').textContent='Mic off';return;}try{state.live=makeAnalyser(await getMic(),4096);$('#liveBtn').textContent='Stop Listening';const loop=()=>{if(!state.live)return;const best=matchChord(spectrumChroma(state.live.analyser,state.live.ctx));$('#liveChord').textContent=simplifyChord(best.name);$('#liveConfidence').textContent=`Relative match ${Math.round(best.score*100)}%`;state.live.raf=requestAnimationFrame(loop)};loop();}catch(e){alert('Microphone permission is required. '+e.message)} };
function autoCorrelate(buf,sr){let n=buf.length,rms=0;for(let i=0;i<n;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/n);if(rms<.01)return-1;let bestLag=-1,best=0,minLag=Math.floor(sr/1000),maxLag=Math.floor(sr/65);for(let lag=minLag;lag<=Math.min(maxLag,n/2);lag++){let sum=0,a=0,b=0;for(let i=0;i<n-lag;i+=2){sum+=buf[i]*buf[i+lag];a+=buf[i]*buf[i];b+=buf[i+lag]*buf[i+lag];}const c=sum/Math.sqrt((a||1)*(b||1));if(c>best){best=c;bestLag=lag;}}return best>.45?sr/bestLag:-1;}
$('#tunerBtn').onclick=async()=>{if(state.tuner){stopMic(state.tuner);state.tuner=null;$('#tunerBtn').textContent='Start Tuner';return;}try{state.tuner=makeAnalyser(await getMic(),4096);const data=new Float32Array(state.tuner.analyser.fftSize);$('#tunerBtn').textContent='Stop Tuner';const loop=()=>{if(!state.tuner)return;state.tuner.analyser.getFloatTimeDomainData(data);const f=autoCorrelate(data,state.tuner.ctx.sampleRate);if(f>0){const midi=69+12*Math.log2(f/440),nearest=Math.round(midi),cents=(midi-nearest)*100;$('#tunerNote').textContent=NOTES[(nearest+120)%12];$('#tunerCents').textContent=`${cents>=0?'+':''}${cents.toFixed(1)} cents`;$('#tunerFreq').textContent=`${f.toFixed(1)} Hz`;$('#tunerNeedle').style.left=`${50+clamp(cents,-50,50)*.75}%`;}state.tuner.raf=requestAnimationFrame(loop)};loop();}catch(e){alert('Microphone permission is required. '+e.message)} };

// ---------- Metronome ----------
let metroCtx=null,metroTimer=null,metroNext=0,metroBeat=0;function setMetroBpm(v){v=clamp(Number(v)||92,40,220);$('#metroSlider').value=v;$('#metroBpm').textContent=v;return v;}$('#metroSlider').oninput=e=>setMetroBpm(e.target.value);$('#metroMinus').onclick=()=>setMetroBpm(Number($('#metroSlider').value)-5);$('#metroPlus').onclick=()=>setMetroBpm(Number($('#metroSlider').value)+5);$('#metroToggle').onclick=()=>{if(metroTimer){clearInterval(metroTimer);metroTimer=null;$('#metroToggle').textContent='Start';return;}metroCtx=metroCtx||new (window.AudioContext||window.webkitAudioContext)();metroNext=metroCtx.currentTime+.05;metroBeat=0;metroTimer=setInterval(scheduleMetro,25);$('#metroToggle').textContent='Stop';};function scheduleMetro(){const bpm=Number($('#metroSlider').value);while(metroNext<metroCtx.currentTime+.12){const osc=metroCtx.createOscillator(),gain=metroCtx.createGain();osc.frequency.value=metroBeat%4===0?1100:800;gain.gain.setValueAtTime(.0001,metroNext);gain.gain.exponentialRampToValueAtTime(.22,metroNext+.002);gain.gain.exponentialRampToValueAtTime(.0001,metroNext+.05);osc.connect(gain).connect(metroCtx.destination);osc.start(metroNext);osc.stop(metroNext+.06);setTimeout(()=>{$('#metroPulse').classList.add('on');setTimeout(()=>$('#metroPulse').classList.remove('on'),70)},Math.max(0,(metroNext-metroCtx.currentTime)*1000));metroBeat++;metroNext+=60/bpm;}}

// ---------- Scales ----------
NOTES.forEach(n=>$('#scaleRoot').insertAdjacentHTML('beforeend',`<option>${n}</option>`));$('#scaleRoot').value='E';
function localScale(root,type){const scales={major:[0,2,4,5,7,9,11],natural_minor:[0,2,3,5,7,8,10],minor:[0,2,3,5,7,8,10],major_pentatonic:[0,2,4,7,9],minor_pentatonic:[0,3,5,7,10],blues:[0,3,5,6,7,10],dorian:[0,2,3,5,7,9,10],mixolydian:[0,2,4,5,7,9,10]};const pc=NOTES.indexOf(FLAT_TO_SHARP[root]||root),ints=scales[type]||scales.major;return ints.map(i=>NOTES[(pc+i+120)%12]);}
$('#scaleBtn').onclick=()=>renderScale($('#scaleRoot').value,$('#scaleType').value);$('#openScaleBtn').onclick=()=>{if(state.song){$('#scaleRoot').value=state.song.key.root;$('#scaleType').value=state.song.key.mode==='minor'?'minor_pentatonic':'major_pentatonic';showView('scales');renderScale($('#scaleRoot').value,$('#scaleType').value);}};
function renderScale(root,type){const notes=localScale(root,type);$('#scaleResult').innerHTML=notes.map(n=>`<span class="chip">${n}</span>`).join('');renderInstrumentScale(notes,root);}
function midiName(m){return NOTES[(m+120)%12];}
function renderInstrumentScale(scaleNotes,root){
  const p=instrumentProfile();
  if(p.key==='keyboard'){
    let html='<div class="keyboard-scale">';for(let m=48;m<=72;m++){const n=midiName(m),on=scaleNotes.includes(n),black=n.includes('#');html+=`<div class="key-note ${black?'black-key':'white-key'} ${on?'on':''} ${n===root?'root':''}"><span>${on?midiLabel(m):''}</span></div>`;}html+='</div>';$('#fretboard').innerHTML=html;return;
  }
  let html='';p.strings.forEach(st=>{html+=`<div class="fret-row"><div class="fret-cell">${escapeHtml(st.name)} string</div>`;for(let pos=0;pos<=12;pos++){const note=midiName(st.midi+pos),on=scaleNotes.includes(note);html+=`<div class="fret-cell ${pos===0?'open':''}">${on?`<span class="fret-note" style="${note===root?'outline:2px solid #e0c29c;outline-offset:2px':''}">${note}</span>`:(st.id===1?pos:'')}</div>`;}html+='</div>';});$('#fretboard').innerHTML=html;
}
renderScale('E','major');

// ---------- Library ----------
async function loadLibrary(){try{const rows=(await dbAll('songs')).sort((a,b)=>b.id-a.id);$('#songList').innerHTML=rows.length?rows.map(r=>`<div class="song-item"><input type="checkbox" class="songSelect" value="${r.id}"><div><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.analysis.key.root)} ${escapeHtml(r.analysis.key.mode)} · ${Math.round(r.analysis.bpm)} BPM · ${fmtTime(r.analysis.duration)}</span></div><button class="ghost small openSong" data-id="${r.id}">Open</button></div>`).join(''):'<p class="muted">No saved songs yet.</p>';$$('.openSong').forEach(b=>b.onclick=()=>openSaved(Number(b.dataset.id)));renderSetlists();}catch(e){$('#songList').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`;}}
async function openSaved(id){const r=await dbGet('songs',id);if(!r)return alert('Saved song not found.');state.audioFile=r.audio;state.audioBuffer=await decodeFile(r.audio);state.monoAnalysis=monoAtRate(state.audioBuffer,ANALYSIS_SR);state.analysisFrames=null;setSong(r.analysis,{file:r.audio,buffer:state.audioBuffer});showView('analyze');}
$('#refreshSongs').onclick=loadLibrary;
function getSetlists(){try{return JSON.parse(localStorage.getItem('fs_setlists')||'[]')}catch{return[]}}
function renderSetlists(){const sets=getSetlists();$('#setlistList').innerHTML=sets.length?sets.map(s=>`<div class="capo-option"><strong>${escapeHtml(s.name)}</strong><div class="muted">${s.song_ids.length} songs</div></div>`).join(''):'<p class="muted">No setlists yet.</p>';}
$('#createSetlist').onclick=()=>{const name=$('#setlistName').value.trim(),ids=$$('.songSelect:checked').map(x=>Number(x.value));if(!name)return alert('Enter a setlist name.');if(!ids.length)return alert('Select at least one saved song.');const sets=getSetlists();sets.push({id:Date.now(),name,song_ids:ids});localStorage.setItem('fs_setlists',JSON.stringify(sets));$('#setlistName').value='';renderSetlists();};

// ---------- Fast local guitar focus / backing ----------
function onePoleLow(src,sr,cut){const out=new Float32Array(src.length),dt=1/sr,rc=1/(2*Math.PI*cut),a=dt/(rc+dt);let y=0;for(let i=0;i<src.length;i++){y+=a*(src[i]-y);out[i]=y;}return out;}
function onePoleHigh(src,sr,cut){const low=onePoleLow(src,sr,cut),out=new Float32Array(src.length);for(let i=0;i<src.length;i++)out[i]=src[i]-low[i];return out;}
function bandPass(src,sr,lo,hi){return onePoleLow(onePoleHigh(src,sr,lo),sr,hi);}
function fastGuitarFocus(buf){const [L,R]=stereoAt44100(buf),n=Math.min(L.length,R.length),mid=new Float32Array(n),side=new Float32Array(n);for(let i=0;i<n;i++){mid[i]=(L[i]+R[i])*.5;side[i]=(L[i]-R[i])*.5;}const sideBand=bandPass(side,44100,90,9000),midBand=bandPass(mid,44100,160,5200),gL=new Float32Array(n),gR=new Float32Array(n),bL=new Float32Array(n),bR=new Float32Array(n);for(let i=0;i<n;i++){const center=midBand[i]*.30,s=sideBand[i]*1.05;gL[i]=clamp(center+s,-1,1);gR[i]=clamp(center-s,-1,1);bL[i]=clamp(L[i]-gL[i]*.58,-1,1);bR[i]=clamp(R[i]-gR[i]*.58,-1,1);}return{guitar:[gL,gR],backing:[bL,bR]};}
function wavBlob(L,R,sr=44100){const n=Math.min(L.length,R.length),buf=new ArrayBuffer(44+n*4),v=new DataView(buf);let p=0;const s=x=>{for(let i=0;i<x.length;i++)v.setUint8(p++,x.charCodeAt(i));};s('RIFF');v.setUint32(p,36+n*4,true);p+=4;s('WAVEfmt ');v.setUint32(p,16,true);p+=4;v.setUint16(p,1,true);p+=2;v.setUint16(p,2,true);p+=2;v.setUint32(p,sr,true);p+=4;v.setUint32(p,sr*4,true);p+=4;v.setUint16(p,4,true);p+=2;v.setUint16(p,16,true);p+=2;s('data');v.setUint32(p,n*4,true);p+=4;for(let i=0;i<n;i++){v.setInt16(p,Math.round(clamp(L[i],-1,1)*32767),true);p+=2;v.setInt16(p,Math.round(clamp(R[i],-1,1)*32767),true);p+=2;}return new Blob([buf],{type:'audio/wav'});}
function clearIsolationUrls(){state.isolationUrls.forEach(u=>URL.revokeObjectURL(u));state.isolationUrls=[];}
function showStemPlayers(stems,label='LOCAL'){clearIsolationUrls();let html='';for(const [name,blob] of Object.entries(stems)){const url=URL.createObjectURL(blob);state.isolationUrls.push(url);html+=`<div class="stem-card ${name==='Guitar'?'primary-stem':''}"><div class="stem-title"><strong>${name}</strong><span>${label}</span></div><audio controls src="${url}"></audio></div>`;}$('#stemPlayers').innerHTML=html;}
async function runFastIsolation(){if(!state.audioBuffer)return alert('Analyze or open a song first.');$('#isolationProgress').classList.remove('hidden');$('#isolationProgress span').textContent='Running local DSP guitar focus…';await nextPaint();try{const out=fastGuitarFocus(state.audioBuffer);showStemPlayers({Guitar:wavBlob(...out.guitar), 'No-Guitar Backing':wavBlob(...out.backing)},'FAST DSP');$('#isolationStatus').innerHTML='<strong>Fast local isolation ready.</strong> This mode is fully offline and instant, but it is an approximation rather than neural stem separation.';}finally{$('#isolationProgress').classList.add('hidden');}}

// ---------- Optional on-device AI isolation ----------
async function fetchWithProgress(url,onProgress){const r=await fetch(url);if(!r.ok)throw new Error(`Download failed (${r.status})`);const total=Number(r.headers.get('content-length'))||0;if(!r.body)return new Uint8Array(await r.arrayBuffer());const reader=r.body.getReader(),chunks=[];let got=0;while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);got+=value.length;onProgress?.(got,total);}const out=new Uint8Array(got);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return out;}
async function ensureOrtAndModel(onProgress){
  if(state.aiSession)return state.aiSession;
  let ortJs=(await dbGet('models','ort-js'))?.data,wasm=(await dbGet('models','ort-wasm'))?.data,model=(await dbGet('models','demucs6s'))?.data;
  if(!ortJs){onProgress?.('Downloading on-device AI runtime…',0);ortJs=await fetchWithProgress(ORT_JS_URL,(a,b)=>onProgress?.('Downloading AI runtime…',b?a/b*.08:.04));await dbPut('models',{key:'ort-js',data:ortJs});}
  if(!wasm){onProgress?.('Downloading AI compute engine…',.09);wasm=await fetchWithProgress(ORT_WASM_URL,(a,b)=>onProgress?.('Downloading AI compute engine…',.09+(b?a/b*.12:.05)));await dbPut('models',{key:'ort-wasm',data:wasm});}
  if(!window.ort){const blob=new Blob([ortJs],{type:'text/javascript'}),url=URL.createObjectURL(blob);await new Promise((res,rej)=>{const sc=document.createElement('script');sc.src=url;sc.onload=()=>{URL.revokeObjectURL(url);res();};sc.onerror=()=>rej(new Error('Could not start ONNX Runtime'));document.head.appendChild(sc);});}
  window.ort.env.wasm.numThreads=1;window.ort.env.wasm.proxy=false;window.ort.env.wasm.wasmBinary=wasm instanceof Uint8Array?wasm:new Uint8Array(wasm);
  if(!model){onProgress?.('Downloading guitar AI model (about 136 MB)…',.22);model=await fetchWithProgress(AI_MODEL_URL,(a,b)=>onProgress?.(`Downloading guitar model ${b?Math.round(a/b*100):''}%…`,.22+(b?a/b*.48:.2)));await dbPut('models',{key:'demucs6s',data:model});}
  onProgress?.('Loading AI model into memory…',.72);state.aiSession=await window.ort.InferenceSession.create(model instanceof Uint8Array?model:new Uint8Array(model),{executionProviders:['wasm'],graphOptimizationLevel:'all'});state.aiModelReady=true;return state.aiSession;
}
function makeFadeWindow(n,overlap){const w=new Float32Array(n);w.fill(1);for(let i=0;i<overlap;i++){const v=i/Math.max(1,overlap-1);w[i]=v;w[n-1-i]=v;}return w;}
async function runAiIsolation(){if(!state.audioBuffer)return alert('Analyze or open a song first.');$('#isolationProgress').classList.remove('hidden');const status=$('#isolationProgress span');try{const session=await ensureOrtAndModel((txt,p)=>{status.textContent=txt;$('#isolationProgress div').style.width=`${Math.round(p*100)}%`;});const [L,R]=stereoAt44100(state.audioBuffer),total=Math.min(L.length,R.length),N=343980,overlap=Math.floor(N/4),stride=N-overlap,nChunks=Math.max(1,Math.ceil(total/stride)),window=makeFadeWindow(N,overlap),gL=new Float32Array(total),gR=new Float32Array(total),weight=new Float32Array(total);for(let ci=0;ci<nChunks;ci++){const start=ci*stride,end=Math.min(start+N,total),len=end-start,input=new Float32Array(2*N);input.set(L.subarray(start,end),0);input.set(R.subarray(start,end),N);status.textContent=`AI separating guitar… ${ci+1}/${nChunks}`;$('#isolationProgress div').style.width=`${Math.round(72+(ci/nChunks)*25)}%`;await nextPaint();const t=new window.ort.Tensor('float32',input,[1,2,N]),outputs=await session.run({mix:t}),o=outputs.stems||outputs[Object.keys(outputs)[0]],d=o.data;const baseL=(4*2)*N,baseR=(4*2+1)*N;for(let i=0;i<len;i++){const w=window[i];gL[start+i]+=d[baseL+i]*w;gR[start+i]+=d[baseR+i]*w;weight[start+i]+=w;}}
    const bL=new Float32Array(total),bR=new Float32Array(total);for(let i=0;i<total;i++){const w=Math.max(weight[i],1e-8);gL[i]/=w;gR[i]/=w;bL[i]=clamp(L[i]-gL[i],-1,1);bR[i]=clamp(R[i]-gR[i],-1,1);}showStemPlayers({Guitar:wavBlob(gL,gR),'No-Guitar Backing':wavBlob(bL,bR)},'AI 6-STEM');$('#isolationStatus').innerHTML='<strong>On-device AI isolation complete.</strong> No Windows computer was used.';$('#isolationProgress div').style.width='100%';}
  catch(e){console.error(e);$('#isolationStatus').innerHTML=`<strong>AI isolation could not finish.</strong> ${escapeHtml(e.message)}<br><span class="muted">Use Fast DSP mode now, or retry AI after freeing memory/storage and checking internet for the first model download.</span>`;}
  finally{setTimeout(()=>{$('#isolationProgress').classList.add('hidden');$('#isolationProgress div').style.width='0%';},500);refreshOfflineStatus();}}
function checkIsolationStatus(){if(!state.song){$('#isolationSongHint').textContent='Analyze or open a song first.';return;}$('#isolationSongHint').textContent=`${state.song.title} · processed entirely on this Android device`;}
$('#stemsBtn').onclick=()=>showView('isolation');$('#isolateBtn').onclick=async()=>{const mode=$('#isolationMode')?.value||'fast';if(mode==='ai')await runAiIsolation();else await runFastIsolation();};$('#refreshIsolationBtn').onclick=refreshOfflineStatus;

// ---------- Offline engine / model manager ----------
async function refreshOfflineStatus(){const rec=await dbGet('models','demucs6s').catch(()=>null);const ready=!!rec;$('#connectionState').textContent=ready?'AI MODEL INSTALLED':'CORE ENGINE READY';$('#connectionLight').classList.add('ok');const modelState=$('#modelState');if(modelState)modelState.textContent=ready?'HT-Demucs 6-stem model cached on this phone (~136 MB).':'Core analysis is fully offline. AI Guitar Isolation needs a one-time ~136 MB model download.';}
$('#saveEngineUrl')?.addEventListener('click',async()=>{try{$('#saveEngineUrl').disabled=true;await ensureOrtAndModel((txt,p)=>{const ms=$('#modelState');if(ms)ms.textContent=txt;});alert('AI Guitar Isolation model is ready on this phone.');}catch(e){alert('Model setup failed: '+e.message)}finally{$('#saveEngineUrl').disabled=false;refreshOfflineStatus();}});
$('#useLocalEngine')?.addEventListener('click',async()=>{if(!confirm('Remove the downloaded AI isolation model from this phone? Core chord/key/BPM tools will stay available.'))return;await dbDelete('models','demucs6s').catch(()=>{});state.aiSession=null;state.aiModelReady=false;refreshOfflineStatus();});
refreshOfflineStatus();

// ---------- Small UI boot ----------
if($('#isolationMode')==null){console.warn('Isolation mode selector missing; defaulting to Fast DSP.');}
