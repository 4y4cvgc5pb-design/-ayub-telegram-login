// Ayub Market qo'shimcha: joy qidirish, "men shu yerdaman" belgisi, ilova belgisi (PWA) va maxfiylik siyosati.
// server.js ning 2-qatorida:  require('./plugin.js');  yozilgan bo'lishi kerak.
const http = require('http'), fs = require('fs'), crypto = require('crypto'), zlib = require('zlib');
const SECRET = process.env.SECRET || '';
const BOT = process.env.BOT_USERNAME || 'bot';

const auth = req => {
  try {
    if (!SECRET) return null;
    const [b, s] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
    const ok = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    if (!s || s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const json = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const inUz = (la, ln) => la > 36.5 && la < 46 && ln > 55 && ln < 74.5;

// ---- Ilova belgisi (PNG) kod bilan chiziladi ----
function bez(p0, p1, p2, p3) { const r = []; for (let i = 0; i <= 30; i++) { const t = i / 30, u = 1 - t;
  r.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return r; }
const FLAME = [].concat(bez([256, 110], [300, 200], [370, 230], [350, 330]), bez([350, 330], [340, 390], [300, 410], [256, 410]), bez([256, 410], [212, 410], [172, 390], [162, 330]), bez([162, 330], [152, 270], [190, 240], [215, 190]), bez([215, 190], [230, 225], [245, 230], [250, 215]), bez([250, 215], [262, 185], [250, 140], [256, 110]));
const INNER = [].concat(bez([256, 250], [280, 290], [315, 310], [305, 360]), bez([305, 360], [298, 390], [278, 400], [256, 400]), bez([256, 400], [234, 400], [214, 388], [208, 360]), bez([208, 360], [204, 320], [236, 300], [256, 250]));
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
function makeIcon(size) {
  const s = size / 512, raw = Buffer.alloc(size * (size * 3 + 1)), SS = 2;
  for (let y = 0; y < size; y++) { raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) { let r = 0, g = 0, b = 0;
      for (let a = 0; a < SS; a++) for (let c = 0; c < SS; c++) { const fx = (x + (a + .5) / SS) / s, fy = (y + (c + .5) / SS) / s;
        let col = [108, 43, 217];
        if (fx > 150 && fx < 372 && fy > 108 && fy < 412) { if (inPoly(fx, fy, INNER)) col = [255, 122, 24]; else if (inPoly(fx, fy, FLAME)) col = [255, 255, 255]; }
        r += col[0]; g += col[1]; b += col[2]; }
      const o = y * (size * 3 + 1) + 1 + x * 3; raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS); } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const iconCache = {};
const icon = n => iconCache[n] || (iconCache[n] = makeIcon(n));

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const MANIFEST = JSON.stringify({ name: 'Ayub Market', short_name: 'Ayub Market', description: 'Ayub Market: mahsulotlar, buyurtma va yetkazib berish', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#f4f4f8', theme_color: '#6c2bd9', lang: 'uz',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] });
const SW = "self.addEventListener('install',function(e){self.skipWaiting()});self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});self.addEventListener('fetch',function(e){if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(function(){return new Response('Internet yoq. Qayta urinib koring.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}))});";
const privacyPage = () => `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maxfiylik siyosati - Ayub Market</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:20px;line-height:1.55;color:#1b1b24}h1{font-size:24px}h2{font-size:18px;margin-top:24px}a{color:#6c2bd9}</style></head><body>
<h1>Maxfiylik siyosati</h1><p>Oxirgi yangilanish: 2026-11-15</p>
<p>Ayub Market ("Ilova") mahsulotlar sotish, buyurtma berish va yetkazib berish xizmati. Ushbu sahifa Ilova qanday ma'lumotlarni yig'ishi va ulardan qanday foydalanishini tushuntiradi.</p>
<h2>Qanday ma'lumotlar yig'iladi</h2><ul>
<li><b>Telefon raqami.</b> Kirish va shaxsni tasdiqlash uchun. Tasdiqlash kodi Telegram bot orqali yuboriladi.</li>
<li><b>Telegram chat identifikatori.</b> Bot sizga kod va buyurtma holati haqida xabar yuborishi uchun.</li>
<li><b>Buyurtma ma'lumotlari.</b> Tanlangan mahsulotlar, manzil, bog'lanish telefoni, izoh va yozma so'rovlar matni.</li>
<li><b>Joylashuv.</b> Faqat siz xaritadan joy tanlaganingizda yoki "Men shu yerdaman" tugmasini bosganingizda va faqat yetkazib berish manzili sifatida. Joylashuv fonda kuzatilmaydi.</li>
<li><b>Sotuvchilar uchun:</b> qo'shilgan mahsulot nomi, narxi, tavsifi va rasmi.</li></ul>
<h2>Ma'lumotlardan foydalanish</h2><p>Ma'lumotlar faqat Ilova ishlashi uchun ishlatiladi: tizimga kirish, buyurtmani qabul qilish va yetkazib berish, holat haqida xabar berish. Ular reklama uchun ishlatilmaydi va sotilmaydi.</p>
<h2>Uchinchi tomon xizmatlari</h2><ul>
<li><b>Telegram</b>: kod va xabarlarni yetkazish.</li>
<li><b>Supabase</b> va <b>Render</b>: ma'lumotlarni saqlash va ilovani ishlatish (hosting).</li>
<li><b>OpenStreetMap</b> (xarita va manzilni aniqlash): xarita ko'rsatilganda va manzil nomi aniqlanganda tanlangan nuqta koordinatalari shu xizmatga yuboriladi.</li></ul>
<h2>Saqlash va o'chirish</h2><p>Buyurtmalar va hisob ma'lumotlari xizmat ko'rsatish uchun zarur muddat saqlanadi. Ma'lumotlaringizni o'chirishni so'rash uchun biz bilan bog'laning, so'rovingiz ko'rib chiqiladi va ma'lumotlar o'chiriladi.</p>
<h2>Xavfsizlik</h2><p>Ma'lumotlar himoyalangan (HTTPS) ulanish orqali uzatiladi. Kirish telefon raqami va bir martalik kod bilan tasdiqlanadi.</p>
<h2>Bog'lanish</h2><p>Savollar uchun Telegram: <a href="https://t.me/${BOT}">@${BOT}</a>${CONTACT_EMAIL ? ' yoki email: <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>' : ''}.</p>
</body></html>`;

const cache = new Map(), rate = {}; let last = 0;
async function search(q) {
  const k = q.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=uz&accept-language=uz,ru&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'AyubMarket/1.0 (https://t.me/' + BOT + ')' }, signal: ac.signal });
    const arr = await r.json();
    const out = (Array.isArray(arr) ? arr : []).map(x => ({ name: String(x.display_name || '').split(', ').slice(0, 4).join(', '), lat: +x.lat, lng: +x.lon }))
      .filter(x => isFinite(x.lat) && isFinite(x.lng) && inUz(x.lat, x.lng));
    if (cache.size > 200) cache.clear();
    cache.set(k, out); return out;
  } finally { clearTimeout(t); }
}

const CSS = String.raw`<style>#msr{max-height:150px;overflow:auto}.msi{padding:10px 12px;border-bottom:1px solid var(--bd);font-size:14px}.msi:active{background:var(--bd)}#me{position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 6px rgba(26,115,232,.28);z-index:2;pointer-events:none;display:none}</style>`;
const CLIENT = String.raw`(function(){try{
var mw=$('mw');
mw.insertAdjacentHTML('beforebegin','<div style="padding:0 14px 8px"><div style="display:flex;gap:8px"><input id="msq" placeholder="🔍 Joy nomini yozing: ko\'cha, mahalla, mo\'ljal" style="margin:0"><button class="btn" id="msb">Qidirish</button></div><div id="msr"></div></div>');
mw.insertAdjacentHTML('beforeend','<div id="me"></div>');
$('mok').parentNode.insertAdjacentHTML('beforebegin','<button class="btn" id="mhere" style="width:100%;margin-top:8px">📍 Men shu yerdaman (joylashuvimni ishlatish)</button>');
var ME=null;
function placeMe(){var e=$('me');if(!ME){e.style.display='none';return}
  var W=$('mp').clientWidth,H=$('mp').clientHeight,c=px(MS.lat,MS.lng,MS.z),m=px(ME.lat,ME.lng,MS.z),x=W/2+(m[0]-c[0]),y=H/2+(m[1]-c[1]);
  e.style.display=(x<-20||y<-20||x>W+20||y>H+20)?'none':'block';e.style.transform='translate('+x+'px,'+y+'px)'}
var _dm=window.drawMap;window.drawMap=function(){_dm();placeMe()};
function locate(then){
  if(!navigator.geolocation)return toast('Joylashuv aniqlanmadi');
  toast('Joylashuv aniqlanmoqda…');
  navigator.geolocation.getCurrentPosition(function(p){
    ME={lat:p.coords.latitude,lng:p.coords.longitude};MS.lat=ME.lat;MS.lng=ME.lng;MS.z=17;window.drawMap();if(then)then()},
    function(){toast('Joylashuvga ruxsat bering: Sozlamalar → Safari → Joylashuv')},{enableHighAccuracy:true,timeout:10000})}
$('mloc').onclick=function(){locate(function(){toast('📍 Siz shu yerdasiz (ko\'k nuqta)');describe()})};
$('mhere').onclick=function(){locate(async function(){
  var r=await api('/geo?lat='+MS.lat.toFixed(6)+'&lng='+MS.lng.toFixed(6));MS.addr=r.j.ok?(r.j.address||''):'';$('mok').click()})};
async function msearch(){
  var q=$('msq').value.trim();if(q.length<2)return toast('Joy nomini yozing');
  $('msr').innerHTML='<div class="mu" style="padding:8px">Qidirilmoqda…</div>';
  var r=await api('/search?q='+encodeURIComponent(q));
  if(!r.j.ok){$('msr').innerHTML='<div class="mu" style="padding:8px">'+esc(r.j.error||'Xatolik')+'</div>';return}
  var L=r.j.items||[];window._ms=L;
  $('msr').innerHTML=L.length?L.map(function(x,i){return '<div class="msi" data-i="'+i+'">📍 '+esc(x.name)+'</div>'}).join(''):'<div class="mu" style="padding:8px">Hech narsa topilmadi. Boshqacha yozib ko\'ring.</div>'}
$('msb').onclick=msearch;
$('msq').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();msearch()}};
$('msr').onclick=function(e){var el=e.target.closest('.msi');if(!el)return;var x=window._ms[+el.dataset.i];
  MS.lat=x.lat;MS.lng=x.lng;MS.z=17;$('msr').innerHTML='';window.drawMap();describe()};
var bx=document.querySelector('#lg .bx');if(bx)bx.insertAdjacentHTML('beforeend','<p class="mu" style="text-align:center;margin-top:14px"><a href="/privacy" target="_blank">Maxfiylik siyosati</a></p>');
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
}catch(err){console.error('plugin',err)}})();`;

const orig = http.createServer;
http.createServer = function (listener) {
  return orig.call(http, (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let html; try { html = fs.readFileSync('index.html', 'utf8'); } catch { return listener(req, res); }
      html = html.replace("script-src 'unsafe-inline';", () => "script-src 'unsafe-inline'; worker-src 'self';")
        .replace('</head>', () => '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="icon" href="/icon-192.png">' + CSS + '</head>')
        .replace('</body>', () => '<script>' + CLIENT + '</script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (req.method === 'GET') {
      const u = req.url.split('?')[0];
      if (u === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return res.end(MANIFEST); }
      if (u === '/icon-192.png' || u === '/icon-512.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); return res.end(icon(u === '/icon-192.png' ? 192 : 512)); }
      if (u === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' }); return res.end(SW); }
      if (u === '/privacy') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(privacyPage()); }
      if (u === '/.well-known/assetlinks.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(process.env.ASSETLINKS || '[]'); }
    }
    if (req.method === 'GET' && req.url.startsWith('/search?')) {
      const me = auth(req); if (!me) return json(res, 401, { ok: false });
      const q = (new URLSearchParams(req.url.slice(8)).get('q') || '').trim().slice(0, 100);
      if (q.length < 2) return json(res, 200, { ok: true, items: [] });
      const now = Date.now(); rate[me.ph] = (rate[me.ph] || []).filter(t => now - t < 60000);
      if (rate[me.ph].length >= 15) return json(res, 429, { ok: false, error: "Juda ko'p qidiruv, 1 daqiqa kuting" });
      rate[me.ph].push(now);
      search(q).then(items => json(res, 200, { ok: true, items })).catch(() => json(res, 200, { ok: true, items: [] }));
      return;
    }
    listener(req, res);
  });
};
