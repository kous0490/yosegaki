'use strict';
// Password verification and photo access are performed on Cloudflare Workers.
const API_BASE = window.AR_CONFIG?.API_BASE || '';
let authToken = '';
let photoImages = [];
let lastPhotoError = ''; 
const form = document.querySelector('#passwordForm');
const video = document.querySelector('#cameraVideo');
const canvas = document.querySelector('#arCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.querySelector('#status');
const login = document.querySelector('#login');
const arScreen = document.querySelector('#arScreen');
const source = document.createElement('canvas');
const srcCtx = source.getContext('2d', {willReadFrequently:true});
let stream = null, running = false, facingMode='environment', detector=null, frame=0, seen=0, lastCorners=null;

form.addEventListener('submit', async e=> {
  e.preventDefault();
  const error = document.querySelector('#error');
  const submitButton = form.querySelector('button');
  error.textContent = '';
  if (!API_BASE.startsWith('https://')) {
    error.textContent = 'config.js のAPI_BASEにWorkersのHTTPS URLを設定してください';
    return;
  }
  submitButton.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({password: document.querySelector('#password').value}),
      cache: 'no-store'
    });
    if (!response.ok) {error.textContent = response.status === 401 ? 'パスワードが違います' : '認証エラー：' + response.status; return;}
    const data = await response.json();
    authToken = data.token;
    document.querySelector('#password').value = '';
    login.classList.add('hide'); arScreen.classList.remove('hide');
    // Photos are fetched only after server-side authorization succeeds.
    await Promise.all([startCamera(), loadPhotos()]);
  } catch (err) {error.textContent = 'サーバーに接続できません。URL・CORS設定を確認してください'; console.error(err);}
  finally {submitButton.disabled = false;}
});
async function loadPhotos() {
  photoImages = [];
  lastPhotoError = '';
  try {
    const headers = {Authorization:`Bearer ${authToken}`};
    const r = await fetch(`${API_BASE}/api/photos`, {headers, cache:'no-store'});
    if (!r.ok) throw new Error(`photos: ${r.status}`);
    const {files} = await r.json();
    for (const file of files.slice(0, 8)) {
      const response = await fetch(`${API_BASE}/api/photo/${encodeURIComponent(file)}`, {headers, cache:'no-store'});
      if (!response.ok) continue;
      const blob = await response.blob();
      const img = await decodePhoto(blob);
      photoImages.push(img);
    }
    if (photoImages.length) statusEl.textContent = `写真 ${photoImages.length} 枚を読み込みました（約4.5秒ごと切替）`; else statusEl.textContent='写真未登録：デモイラストを表示します';
  } catch (err) {lastPhotoError = `写真の読み込み失敗: ${err.message}`; console.warn(lastPhotoError, err); statusEl.textContent=lastPhotoError;}
}
async function decodePhoto(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  // Safari fallback. Revoke object URL immediately after decode.
  const url = URL.createObjectURL(blob);
  try {const img = new Image(); img.src=url; await img.decode(); return img;}
  finally {URL.revokeObjectURL(url);}
}
document.querySelector('#switchCamera').onclick = async()=>{facingMode = facingMode==='environment'?'user':'environment'; await startCamera();};
document.querySelector('#exitCamera').onclick = ()=>{stopCamera();authToken='';photoImages.forEach(i=>i.close?.());photoImages=[];arScreen.classList.add('hide');login.classList.remove('hide');};
window.addEventListener('pagehide', stopCamera);

async function startCamera(){
 stopCamera(); statusEl.textContent='カメラを準備中…';
 if(!window.isSecureContext && location.hostname!=='localhost') {statusEl.textContent='HTTPSで公開してください';return;}
 if(!navigator.mediaDevices?.getUserMedia){statusEl.textContent='このブラウザではカメラを使えません';return;}
 if(typeof AR === 'undefined' || !window.MARKER_CODES){statusEl.textContent='認識ライブラリの読み込みに失敗';return;}
 try {
   AR.DICTIONARIES.OPENCV_4X4_50={nBits:16,tau:3,codeList:window.MARKER_CODES};
   detector=new AR.Detector({dictionaryName:'OPENCV_4X4_50',maxHammingDistance:2});
   stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720}}});
   video.srcObject=stream;await video.play();
   running=true;frame=0;seen=0;lastCorners=null;requestAnimationFrame(draw);
 }catch(e){statusEl.textContent=e.name==='NotAllowedError'?'カメラの使用を許可してください':'起動失敗：'+(e.message||e.name); console.error(e);}
}
function stopCamera(){running=false; if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}video.srcObject=null;}
function resize(){const dpr=Math.min(devicePixelRatio||1,2);const w=window.innerWidth,h=window.innerHeight;const px=Math.round(w*dpr),py=Math.round(h*dpr);if(canvas.width!==px||canvas.height!==py){canvas.width=px;canvas.height=py;}return {w:px,h:py};}
function draw(){
 if(!running)return;
 const {w,h}=resize();const vw=video.videoWidth,vh=video.videoHeight;
 if(vw && vh){
  // Match object-fit:cover in both detection and display coordinates.
  const scale=Math.max(w/vw,h/vh),dw=vw*scale,dh=vh*scale,dx=(w-dw)/2,dy=(h-dh)/2;
  ctx.clearRect(0,0,w,h);ctx.drawImage(video,dx,dy,dw,dh);
  if(frame++%3===0){
   const sw=720,sh=Math.round(sw*h/w);source.width=sw;source.height=sh;
   srcCtx.drawImage(canvas,0,0,sw,sh);
   try {let markers=detector.detect(srcCtx.getImageData(0,0,sw,sh));
    let target=markers.find(m=>m.id===23);
    if(target){lastCorners=target.corners.map(p=>({x:p.x*w/sw,y:p.y*h/sh}));seen=performance.now();statusEl.textContent='✓ ID 23 を認識中';}
    else if(performance.now()-seen>300){lastCorners=null;statusEl.textContent='マーカー ID 23 を探しています';}
   } catch(err){statusEl.textContent='検出エラー：'+err.message; console.error(err);}
  }
  if(lastCorners && performance.now()-seen<380){overlay(lastCorners);}
 } else {ctx.fillStyle='#0b1020';ctx.fillRect(0,0,w,h);}
 requestAnimationFrame(draw);
}
function overlay(p){
 // Four marker corners; use its local axes so decorations track position and rotation.
 const A=p[0],B=p[1],D=p[3],side=Math.hypot(B.x-A.x,B.y-A.y);
 if(side<20)return;
 ctx.save();ctx.strokeStyle='#68f4d8';ctx.lineWidth=Math.max(2,side*.023);ctx.beginPath();p.forEach((pt,i)=>i?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y));ctx.closePath();ctx.stroke();
 const vx={x:(B.x-A.x),y:(B.y-A.y)},vy={x:(D.x-A.x),y:(D.y-A.y)};
 // Affine overlay: suitable for preview, not full 6DOF perspective tracking.
 ctx.transform(vx.x,vx.y,vy.x,vy.y,A.x,A.y);
 ctx.shadowColor='#0009';ctx.shadowBlur=18;
 roundRect(ctx,-.26,-1.24,1.52,.90,.10,'#fffdf2');
 ctx.shadowBlur=0;
 ctx.fillStyle='#262842';ctx.textAlign='center';ctx.save();ctx.scale(.001,.001);ctx.font='bold 108px sans-serif';ctx.fillText('大学生活、ありがとう！',500,-920);ctx.restore();
 ctx.fillStyle='#655e77';ctx.save();ctx.scale(.001,.001);ctx.font='69px sans-serif';ctx.fillText('たくさんの思い出を、これからも。',500,-750);ctx.restore();
 // Display the first protected photo if uploaded; keep the demo art otherwise.
 if (photoImages.length) {
   const img=photoImages[Math.floor(Date.now()/4500)%photoImages.length];
   const ratio=img.width/img.height, boxRatio=.92/.30;
   let sx=0,sy=0,sw=img.width,sh=img.height;
   if(ratio>boxRatio){sw=img.height*boxRatio;sx=(img.width-sw)/2;}
   else {sh=img.width/boxRatio;sy=(img.height-sh)/2;}
   ctx.drawImage(img,sx,sy,sw,sh,.04,-.67,.92,.30);
 } else {
 const grad=ctx.createLinearGradient(.04,-.65,.04,-.38);grad.addColorStop(0,'#a8d9f5');grad.addColorStop(1,'#dbb4f0');
 roundRect(ctx,.04,-.67,.92,.30,.04,grad);
 ctx.fillStyle='#f9e2a4';ctx.beginPath();ctx.arc(.74,-.58,.07,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#6b9a9f';ctx.beginPath();ctx.moveTo(.05,-.38);ctx.lineTo(.36,-.60);ctx.lineTo(.56,-.40);ctx.lineTo(.76,-.53);ctx.lineTo(.96,-.39);ctx.closePath();ctx.fill();
 }
 ctx.fillStyle='#f8eee6';ctx.save();ctx.scale(.001,.001);ctx.font='65px sans-serif';ctx.fillText('AR YOSEGAKI · DEMO',500,-250);ctx.restore();
 ctx.restore();
}
function roundRect(c,x,y,w,h,r,fill){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();}
