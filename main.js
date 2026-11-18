"use strict";
const $=s=>document.querySelector(s);
const form=$('#passwordForm'),video=$('#cameraVideo'),canvas=$('#arCanvas'),ctx=canvas.getContext('2d');
const statusEl=$('#status'),login=$('#login'),arScreen=$('#arScreen');
const source=document.createElement('canvas'),srcCtx=source.getContext('2d',{willReadFrequently:true});
const enc=new TextEncoder();
let stream=null,running=false,detector=null,frame=0,photos=[],title='',message='';
let phase='scan',scanSince=0,lastFound=0,scanned=false,selected=-1;
let heading=0,pitch=0,roll=0,baseHeading=0,orientationActive=false,orientationListener=null;
let dragging=false,dragX=0,dragY=0,dragMoved=false,dragYaw=0,dragPitch=0;
let hitAreas=[],layout=[],savedLayout=[],lastRender=0,viewW=0,viewH=0;
const TAU=Math.PI*2,rad=Math.PI/180;
function bytes(x){return Uint8Array.from(atob(x),c=>c.charCodeAt(0));}
function norm(a){return Math.atan2(Math.sin(a),Math.cos(a));}
async function decrypt(password){const r=await fetch('./content.enc.json',{cache:'no-store'});if(!r.ok)throw Error('content.enc.json がありません');const b=await r.json();if(b.version!==1||b.kdf!=='PBKDF2-SHA256'||b.cipher!=='AES-256-GCM')throw Error('暗号形式が違います');const m=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);const k=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(b.salt),iterations:b.iterations,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(b.iv)},k,bytes(b.data))));}
async function decodePhoto(src){if(!/^data:image\/(jpeg|png|webp);base64,/.test(src))throw Error('画像形式が不正');const b=await(await fetch(src)).blob();if(window.createImageBitmap)return createImageBitmap(b);return await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=src;});}
form.addEventListener('submit',async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;$('#error').textContent='';try{const data=await decrypt($('#password').value);const imgs=[];for(const src of (data.photos||[]).slice(0,60)){imgs.push(await decodePhoto(src));}photos.forEach(p=>p.close?.());photos=imgs;savedLayout=Array.isArray(data.layout)?data.layout:[];title=String(data.title||'AR寄せ書き');message=String(data.message||'');$('#password').value='';login.classList.add('hide');arScreen.classList.remove('hide');await startCamera();}catch(err){$('#error').textContent=err.name==='OperationError'?'パスワードが違います':'エラー：'+err.message;}finally{btn.disabled=false;}});
function stopCamera(){running=false;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;}
async function startCamera(){stopCamera();phase='scan';scanSince=0;lastFound=0;selected=-1;orientationActive=false;dragYaw=dragPitch=0;$('#detail').classList.add('hide');$('#orientationButton').classList.add('hide');$('#scanGuide').classList.remove('hide');statusEl.textContent='マーカーを探しています';if(!navigator.mediaDevices?.getUserMedia){statusEl.textContent='カメラ非対応のブラウザです';return;}try{if(typeof AR==='undefined'||!window.MARKER_CODES)throw Error('マーカー認識ライブラリを読み込めません');AR.DICTIONARIES.OPENCV_4X4_50={nBits:16,tau:3,codeList:window.MARKER_CODES};detector=new AR.Detector({dictionaryName:'OPENCV_4X4_50',maxHammingDistance:2});stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});video.srcObject=stream;await video.play();running=true;requestAnimationFrame(draw);}catch(e){statusEl.textContent='起動失敗：'+(e.message||e.name);}}
$('#exitCamera').onclick=()=>{stopCamera();photos.forEach(p=>p.close?.());photos=[];arScreen.classList.add('hide');login.classList.remove('hide');};
$('#switchCamera').onclick=async()=>{if(!stream)return;const t=stream.getVideoTracks()[0],settings=t.getSettings();const mode=settings.facingMode==='user'?'environment':'user';stopCamera();try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:mode}},audio:false});video.srcObject=stream;await video.play();running=true;requestAnimationFrame(draw);}catch(e){statusEl.textContent='切替失敗：'+e.message;}};
window.addEventListener('pagehide',stopCamera);
function sensor(e){if(e.alpha==null)return;const a=e.alpha*rad,b=(e.beta||0)*rad,g=(e.gamma||0)*rad;const screenAngle=(screen.orientation?.angle||0)*rad; // deviceorientation gives a usable relative direction, not a geospatial world anchor
heading=-a-screenAngle;pitch=Math.max(-1.35,Math.min(1.35,b-Math.PI/2));roll=g;orientationActive=true;}
async function enableOrientation(){try{if(typeof DeviceOrientationEvent==='undefined')throw Error('向きセンサーがありません');if(typeof DeviceOrientationEvent.requestPermission==='function'){const p=await DeviceOrientationEvent.requestPermission();if(p!=='granted')throw Error('向きセンサーの許可が必要です');}if(!orientationListener){orientationListener=sensor;window.addEventListener('deviceorientation',sensor,true);}$('#orientationButton').classList.add('hide');statusEl.textContent='スマホを動かして写真を見渡せます';}catch(e){statusEl.textContent='センサー不可：画面をスワイプして見渡せます';}}
$('#orientationButton').onclick=enableOrientation;
function buildLayout(){const n=photos.length||8,columns=Math.max(12,Math.ceil(n/3));layout=Array.from({length:n},(_,i)=>{const row=i%3,col=Math.floor(i/3),raw=savedLayout[i];const angle=raw&&Number.isFinite(+raw.angle)?+raw.angle*rad:(col+row*.35)/columns*TAU;const elevation=raw&&Number.isFinite(+raw.elevation)?Math.max(-52,Math.min(52,+raw.elevation))*rad:[-.40,0,.40][row];const scale=raw&&Number.isFinite(+raw.scale)?Math.max(.35,Math.min(2.5,+raw.scale)):1;const rotation=raw&&Number.isFinite(+raw.rotation)?Math.max(-180,Math.min(180,+raw.rotation))*rad:0;return {angle,elevation,scale,rotation,index:i};});}
function finishScan(){phase='gallery';buildLayout();baseHeading=heading;dragYaw=dragPitch=0;$('#scanGuide').classList.add('hide');$('#orientationButton').classList.remove('hide');statusEl.textContent='読み取り完了！ 向きセンサーを有効にしてください';if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function')enableOrientation();}
function resize(){const d=Math.min(devicePixelRatio||1,2),w=Math.round(innerWidth*d),h=Math.round(innerHeight*d);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}viewW=w;viewH=h;return {w,h};}
function draw(t){if(!running)return;const {w,h}=resize();ctx.clearRect(0,0,w,h);if(video.videoWidth){const s=Math.max(w/video.videoWidth,h/video.videoHeight),dw=video.videoWidth*s,dh=video.videoHeight*s;ctx.drawImage(video,(w-dw)/2,(h-dh)/2,dw,dh);if(phase==='scan')scan(t,w,h);else gallery(t,w,h);}requestAnimationFrame(draw);}
function scan(t,w,h){if(frame++%3===0){const sw=480,sh=Math.round(sw*h/w);source.width=sw;source.height=sh;srcCtx.drawImage(canvas,0,0,sw,sh);try{const markers=detector.detect(srcCtx.getImageData(0,0,sw,sh));const m=markers.find(x=>x.id===23);if(m){lastFound=t;if(!scanSince)scanSince=t;const c=m.corners;ctx.save();ctx.strokeStyle='#65ffcd';ctx.lineWidth=5;ctx.beginPath();c.forEach((p,i)=>i?ctx.lineTo(p.x*w/sw,p.y*h/sh):ctx.moveTo(p.x*w/sw,p.y*h/sh));ctx.closePath();ctx.stroke();ctx.restore();}}catch(e){statusEl.textContent='認識エラー：'+e.message;}}if(t-lastFound>240)scanSince=0;const sec=scanSince?Math.max(0,3-(t-scanSince)/1000):3;$('#countdown').textContent=scanSince?String(Math.ceil(sec)):'—';statusEl.textContent=scanSince?'認識中… '+sec.toFixed(1)+'秒':'マーカーID 23を探しています';if(scanSince&&t-scanSince>=3000)finishScan();}
function round(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function gallery(t,w,h){
 const scale=w/innerWidth,f=w/(2*Math.tan(65*rad/2));
 const yaw=(orientationActive?norm(heading-baseHeading):0)+dragYaw,tilt=(orientationActive?pitch:0)+dragPitch;
 hitAreas=[];const visible=[];
 for(const item of layout){
  const delta=norm(item.angle-yaw),vertical=item.elevation-tilt;
  if(Math.abs(delta)>1.35||Math.abs(vertical)>1.3)continue;
  const x=w/2+Math.tan(delta)*f,y=h/2-Math.tan(vertical)*f;
  const depth=Math.max(.55,Math.cos(delta));
  const cardW=Math.min(w*.22,85*scale,f*(TAU/Math.max(12,Math.ceil(layout.length/3)))*.72)*depth*item.scale;
  const cardH=cardW*1.36;
  visible.push({item,x,y,cardW,cardH,depth});
 }
 visible.sort((a,b)=>a.depth-b.depth);
 for(const p of visible){
  const {x,y,cardW:cw,cardH:ch,item}=p;
  ctx.save();ctx.translate(x,y);ctx.rotate(item.rotation);
  round(-cw/2-3*scale,-ch/2-3*scale,cw+6*scale,ch+6*scale,7*scale,'#ffffffee');
  ctx.beginPath();ctx.roundRect(-cw/2,-ch/2,cw,ch,5*scale);ctx.clip();
  const img=photos[item.index];
  if(img){const ratio=img.width/img.height,br=cw/ch;let sx=0,sy=0,sw=img.width,sh=img.height;if(ratio>br){sw=img.height*br;sx=(img.width-sw)/2;}else{sh=img.width/br;sy=(img.height-sh)/2;}ctx.drawImage(img,sx,sy,sw,sh,-cw/2,-ch/2,cw,ch);}
  else{const grad=ctx.createLinearGradient(0,-ch/2,0,ch/2);grad.addColorStop(0,'#9bdedb');grad.addColorStop(1,'#a9a5ed');round(-cw/2,-ch/2,cw,ch,5*scale,grad);ctx.fillStyle='#17223a';ctx.textAlign='center';ctx.font=`${Math.max(12,18*scale)}px sans-serif`;ctx.fillText('思い出 '+(item.index+1),0,0);}
  ctx.restore();
  hitAreas.push({x,y,w:cw,h:ch,rotation:item.rotation,index:item.index});
 }
 const badge=`${photos.length}枚 · ${Math.round(((yaw%TAU)+TAU)%TAU/rad)}°`;
 statusEl.textContent=selected>=0?'写真を拡大表示中':(orientationActive?'周囲を見渡せます · ':'スワイプで周囲を見渡せます · ')+badge;
}
function openDetail(i){selected=i;const detail=$('#detail'),img=$('#detailImage');if(photos.length){const pic=photos[i];if(pic instanceof ImageBitmap){const c=document.createElement('canvas');c.width=pic.width;c.height=pic.height;c.getContext('2d').drawImage(pic,0,0);img.src=c.toDataURL('image/jpeg',.92);}else img.src=pic.src;img.classList.remove('hide');$('#detailEmpty').classList.add('hide');}else{img.classList.add('hide');$('#detailEmpty').classList.remove('hide');}$('#detailCounter').textContent=`${i+1} / ${photos.length||8}`;detail.classList.remove('hide');}
$('#detailClose').onclick=()=>{selected=-1;$('#detail').classList.add('hide');};
canvas.addEventListener('pointerdown',e=>{if(phase!=='gallery'||selected>=0)return;dragging=true;dragMoved=false;dragX=e.clientX;dragY=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-dragX,dy=e.clientY-dragY;if(Math.abs(dx)+Math.abs(dy)>6)dragMoved=true;dragYaw-=dx/innerWidth*1.8;dragPitch=Math.max(-1.1,Math.min(1.1,dragPitch+dy/innerHeight*1.8));dragX=e.clientX;dragY=e.clientY;});
canvas.addEventListener('pointerup',e=>{if(!dragging)return;dragging=false;if(!dragMoved){const x=e.clientX*(canvas.width/innerWidth),y=e.clientY*(canvas.height/innerHeight);for(let i=hitAreas.length-1;i>=0;i--){const h=hitAreas[i];const dx=x-h.x,dy=y-h.y,a=-h.rotation,rx=dx*Math.cos(a)-dy*Math.sin(a),ry=dx*Math.sin(a)+dy*Math.cos(a);if(Math.abs(rx)<=h.w/2&&Math.abs(ry)<=h.h/2){openDetail(h.index);break;}}}});
