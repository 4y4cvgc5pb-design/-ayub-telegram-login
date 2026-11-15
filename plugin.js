// Ayub Market qo'shimcha: joy qidirish (/search) va xarita uchun "men shu yerdaman" belgisi.
// server.js ning eng birinchi qatoriga:  require('./plugin.js');  yozilgan bo'lishi kerak.
const http = require('http'), fs = require('fs'), crypto = require('crypto');
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
}catch(err){console.error('plugin',err)}})();`;

const orig = http.createServer;
http.createServer = function (listener) {
  return orig.call(http, (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let html; try { html = fs.readFileSync('index.html', 'utf8'); } catch { return listener(req, res); }
      html = html.replace('</head>', () => CSS + '</head>').replace('</body>', () => '<script>' + CLIENT + '</script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
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
