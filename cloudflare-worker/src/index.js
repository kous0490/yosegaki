// AR寄せ書き: Cloudflare Worker + private R2 image gate.
// Set PHOTO_PASSWORD and SESSION_SECRET using `npx wrangler secret put ...`.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TTL_SECONDS = 60 * 60;
const PHOTO_KEY = /^photos\/[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:jpg|jpeg|png|webp)$/i;
const IMAGE_MIME = {'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp'};

function respond(body, status = 200, more = {}) {
  return new Response(body, {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...more}});
}
function json(data, status = 200, headers = {}) {return respond(JSON.stringify(data), status, headers);}
function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromB64url(text) {
  const raw = atob(text.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function keyFor(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify']);
}
async function makeToken(secret) {
  const payload = b64url(encoder.encode(JSON.stringify({exp:Math.floor(Date.now()/1000)+TTL_SECONDS, nonce:crypto.randomUUID()})));
  const signature = b64url(new Uint8Array(await crypto.subtle.sign('HMAC',await keyFor(secret),encoder.encode(payload))));
  return `${payload}.${signature}`;
}
async function validToken(secret, value) {
  if (!value || value.length > 500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const [payload, signature] = value.split('.');
    const verified = await crypto.subtle.verify('HMAC', await keyFor(secret), fromB64url(signature), encoder.encode(payload));
    if (!verified) return false;
    const parsed = JSON.parse(decoder.decode(fromB64url(payload)));
    return Number.isInteger(parsed.exp) && parsed.exp > Date.now()/1000 && parsed.exp <= Date.now()/1000 + TTL_SECONDS + 60;
  } catch { return false; }
}
async function constantTimePasswordEqual(input, actual) {
  // Hash both values before comparing so timing isn't based on input length.
  const hash1 = new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(input)));
  const hash2 = new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(actual)));
  let difference=0;
  for(let i=0;i<hash1.length;i++) difference |= hash1[i]^hash2[i];
  return difference===0;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = (env.ALLOWED_ORIGIN || '').replace(/\/$/,'');
    // Browser access is limited to this GitHub Pages origin. CORS is not authentication.
    const cors = {'Vary':'Origin',...(origin && origin === allowedOrigin ? {'Access-Control-Allow-Origin':origin}: {})};
    if (request.method === 'OPTIONS') {
      if (origin !== allowedOrigin) return respond(JSON.stringify({error:'Forbidden'}),403,cors);
      return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store'}});
    }
    // Reject accidental cross-site browser requests, even if an attacker already knows password.
    if (origin && origin !== allowedOrigin) return json({error:'Forbidden origin'},403,cors);
    if (!env.PHOTO_PASSWORD || !env.SESSION_SECRET || !env.PHOTOS || allowedOrigin.includes('YOUR-USERNAME')) {
      return json({error:'Server not configured'},503,cors);
    }
    const url = new URL(request.url);
    if (url.pathname==='/api/health' && request.method==='GET') return json({ok:true},200,cors);
    if (url.pathname==='/api/login' && request.method==='POST') {
      if (Number(request.headers.get('Content-Length')||0)>1024) return json({error:'Too large'},413,cors);
      let supplied;
      try {const body=await request.text();if (body.length>1024) throw Error('too large');supplied=JSON.parse(body).password;} catch {return json({error:'Invalid JSON'},400,cors);}
      if (typeof supplied!=='string'||supplied.length>128) return json({error:'Invalid password'},400,cors);
      const ok = await constantTimePasswordEqual(supplied,env.PHOTO_PASSWORD);
      if (!ok) return json({error:'Invalid password'},401,cors);
      return json({token:await makeToken(env.SESSION_SECRET),expiresIn:TTL_SECONDS},200,cors);
    }
    if (url.pathname==='/api/photos' || url.pathname.startsWith('/api/photo/')) {
      if (request.method !== 'GET') return json({error:'Method not allowed'},405,cors);
      const auth = request.headers.get('Authorization')||'';
      if (!auth.startsWith('Bearer ') || !await validToken(env.SESSION_SECRET,auth.slice(7))) return json({error:'Unauthorized'},401,cors);
      if (url.pathname==='/api/photos') {
        const items=await env.PHOTOS.list({prefix:'photos/',limit:100});
        return json({files:items.objects.filter(o=>PHOTO_KEY.test(o.key)).map(o=>o.key.slice('photos/'.length)).slice(0,40)},200,cors);
      }
      let name;
      try {name=decodeURIComponent(url.pathname.slice('/api/photo/'.length));}catch{return json({error:'Bad path'},400,cors);}
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:jpg|jpeg|png|webp)$/i.test(name)) return json({error:'Bad file name'},400,cors);
      const key='photos/'+name;
      const object=await env.PHOTOS.get(key);
      if (!object) return json({error:'Not found'},404,cors);
      const ext=name.split('.').pop().toLowerCase();
      return new Response(object.body,{headers:{...cors,'Content-Type':IMAGE_MIME[ext],'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
    }
    return json({error:'Not found'},404,cors);
  }
};
