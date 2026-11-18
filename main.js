"use strict";
// No password or plaintext photographs are stored in this public repository.
const form = document.querySelector('#passwordForm');
const video = document.querySelector('#cameraVideo');
const canvas = document.querySelector('#arCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.querySelector('#status');
const login = document.querySelector('#login');
const arScreen = document.querySelector('#arScreen');
const source = document.createElement('canvas');
const srcCtx = source.getContext('2d', {willReadFrequently:true});
let stream=null,running=false,facingMode='environment',detector=null,frame=0,seen=0,lastCorners=null;
let photoImages=[],messageTitle='AR YOSEGAKI',messageBody='';
const enc = new TextEncoder();
function b64ToBytes(x){return Uint8Array.from(atob(x), c=>c.charCodeAt(0));}
async function decryptBundle(password){
 const response=await fetch('./content.enc.json',{cache:'no-store'});
 if(!response.ok)throw new Error('暗号化データが見つかりません (content.enc.json)');
 const bundle=await response.json();
 if(bundle.version!==1||bundle.kdf!=='PBKDF2-SHA256'||bundle.cipher!=='AES-256-GCM')throw new Error('非対応のデータ形式です');
 const keyMaterial=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64ToBytes(bundle.salt),iterations:bundle.iterations,hash:'SHA-256'},keyMaterial,{name:'AES-GCM',length:256},false,['decrypt']);
 const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(bundle.iv)},key,b64ToBytes(bundle.data));
 const content=JSON.parse(new TextDecoder().decode(decrypted));
 if(!Array.isArray(content.photos))throw new Error('写真データの形式が不正です');
 return content;
}
async function decodePhoto(dataUrl){
 if(!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl))throw new Error('画像形式が無効です');
 const response=await fetch(dataUrl);
 const blob=await response.blob();
 if(typeof createImageBitmap==='function')return await createImageBitmap(blob);
 const url=URL.createObjectURL(blob);
 try {const img=new Image();img.src=url;await img.decode();return img;}
 finally{URL.revokeObjectURL(url);}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const err=document.querySelector('#error'),btn=form.querySelector('button');
 err.textContent='';btn.disabled=true;
 try{
  const payload=await decryptBundle(document.querySelector('#password').value);
  const imgs=[];
  for(const src of payload.photos.slice(0,8)){try{imgs.push(await decodePhoto(src));}catch(e){console.warn('画像読み込み失敗',e);}}
  photoImages.forEach(i=>i.close?.()); photoImages=imgs;
  messageTitle=String(payload.title||'AR寄せ書き').slice(0,45);
  messageBody=String(payload.message||'').slice(0,70);
  document.querySelector('#password').value='';
  login.classList.add('hide');arScreen.classList.remove('hide');
  await startCamera();
 }catch(ex){err.textContent=ex.name==='OperationError'?'パスワードが違います':'読み込みエラー：'+ex.message;console.warn(ex);}
 finally{btn.disabled=false;}
});
document.querySelector('#switchCamera').onclick = async()=>{facingMode = facingMode==='environment'?'user':'environment'; await startCamera();};
document.querySelector('#exitCamera').onclick = ()=>{stopCamera();photoImages.forEach(i=>i.close?.());photoImages=[];messageTitle='AR YOSEGAKI';messageBody='';arScreen.classList.add('hide');login.classList.remove('hide');};
window.addEventListener('pagehide', stopCamera);

async function startCamera(){
 stopCamera(); statusEl.textContent='カメラを準備中…（写真 '+photoImages.length+' 枚）';
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
 ctx.fillStyle='#262842';ctx.textAlign='center';ctx.save();ctx.scale(.001,.001);ctx.font='bold 108px sans-serif';ctx.fillText(messageTitle,500,-920);ctx.restore();
 ctx.fillStyle='#655e77';ctx.save();ctx.scale(.001,.001);ctx.font='69px sans-serif';ctx.fillText(messageBody,500,-750);ctx.restore();
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
 ctx.fillStyle='#f8eee6';ctx.save();ctx.scale(.001,.001);ctx.font='65px sans-serif';ctx.fillText('AR YOSEGAKI',500,-250);ctx.restore();
 ctx.restore();
}
function roundRect(c,x,y,w,h,r,fill){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();}
