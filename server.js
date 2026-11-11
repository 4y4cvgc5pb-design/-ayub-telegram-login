const http = require('http'), fs = require('fs'), crypto = require('crypto');

process.on('unhandledRejection', e => console.error('Xato:', e && e.message));
const TOKEN = process.env.BOT_TOKEN, BOT = process.env.BOT_USERNAME;
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
if (!TOKEN || !BOT) { console.error('BOT_TOKEN va BOT_USERNAME kerak'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}/`;
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_KEY || '';
const USE_SB = !!(SB_URL && SB_KEY);
let db = { chats: {}, products: [], sellers: {}, orders: [] };
const codes = {}, lastReq = {}, ordRate = {};
const FREE_MIN = 199000;

const norm = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 ? '998' + d : d; };
const OWNER = norm(process.env.OWNER_PHONE);
const tg = (m, b) => fetch(API + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const isOwnerId = id => OWNER && db.chats[OWNER] === id;
const canPost = ph => ph === OWNER || !!db.sellers[ph];

// ---- Doimiy baza (Supabase). Kalitlar bo'lmasa, vaqtinchalik fayl ishlatiladi ----
const sb = (path, opt = {}) => fetch(SB_URL + '/rest/v1/kv' + path, Object.assign({}, opt, {
  headers: Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' },
    SB_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SB_KEY } : {}, opt.headers || {}) }));
const fileSave = () => { try { fs.writeFileSync('db.json', JSON.stringify(db)); } catch {} };
async function put(key, value) {
  try {
    const r = await sb('?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
    if (!r.ok) console.error('Saqlash xatosi', r.status, await r.text());
  } catch (e) { console.error('Saqlash xatosi', e.message); }
}
async function del(key) {
  try { const r = await sb('?key=eq.' + encodeURIComponent(key), { method: 'DELETE' }); if (!r.ok) console.error('Ochirish xatosi', r.status); }
  catch (e) { console.error('Ochirish xatosi', e.message); }
}
const saveMeta = () => USE_SB ? put('meta', { chats: db.chats, sellers: db.sellers }) : fileSave();
const saveProduct = p => USE_SB ? put('p:' + p.id, p) : fileSave();
const saveOrder = o => USE_SB ? put('o:' + o.id, o) : fileSave();
const removeProduct = id => USE_SB ? del('p:' + id) : fileSave();
async function loadDb() {
  if (!USE_SB) { try { db = Object.assign(db, JSON.parse(fs.readFileSync('db.json'))); } catch {} console.warn('SUPABASE sozlanmagan: vaqtinchalik rejim'); return; }
  const r = await sb('?select=key,value');
  if (!r.ok) throw new Error('Supabase ulanmadi: ' + r.status + ' ' + await r.text());
  for (const row of await r.json()) {
    if (row.key === 'meta') { db.chats = row.value.chats || {}; db.sellers = row.value.sellers || {}; }
    else if (row.key.startsWith('p:')) db.products.push(row.value);
    else if (row.key.startsWith('o:')) db.orders.push(row.value);
  }
  db.products.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  db.orders.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  console.log('Baza yuklandi: mahsulot', db.products.length, 'buyurtma', db.orders.length);
}

// ---- Buyurtmalar ----
const ST = { new: '🆕 Yangi', assembling: "🧑‍🍳 Yig'ilmoqda", onway: "🚚 Yo'lda", done: '✅ Yetkazildi', cancelled: '❌ Bekor qilindi' };
const num = o => '#' + o.id.slice(-5);
const money = n => Number(n).toLocaleString('ru-RU') + " so'm";
const orderText = o => o.kind === 'request'
  ? `${ST[o.status]} ${num(o)} — 📝 Yozma so'rov\n${o.text}\n📍 ${o.address}\n📞 ${o.tel} (+${o.phone})`
  : `${ST[o.status]} ${num(o)}\n` + o.items.map(i => `• ${i.name} × ${i.qty}`).join('\n') + `\nJami: ${money(o.total)}\n` +
  (o.type === 'delivery' ? `📍 ${o.address}\n🕐 ${o.slot === 'express' ? 'Tezkor' : o.slot}` : '🏪 Olib ketish') + `\n📞 ${o.tel} (+${o.phone})` + (o.comment ? `\n💬 ${o.comment}` : '');
const orderKb = o => ({ inline_keyboard: [
  [{ text: "🧑‍🍳 Yig'ilmoqda", callback_data: 'st:' + o.id + ':assembling' }, { text: "🚚 Yo'lda", callback_data: 'st:' + o.id + ':onway' }],
  [{ text: '✅ Yetkazildi', callback_data: 'st:' + o.id + ':done' }, { text: '❌ Bekor', callback_data: 'st:' + o.id + ':cancelled' }]] });
const notifyOwner = (o, extra) => { const oc = OWNER && db.chats[OWNER]; if (oc) tg('sendMessage', { chat_id: oc, text: (extra ? extra + '\n' : '') + orderText(o), reply_markup: orderKb(o) }); };
async function setStatus(o, st) {
  o.status = st; await saveOrder(o);
  if (db.chats[o.phone]) tg('sendMessage', { chat_id: db.chats[o.phone], text: `Buyurtma ${num(o)}: ${ST[st]}` });
}

async function onCb(q) {
  const parts = String(q.data || '').split(':');
  const [a, ph] = parts;
  if (!isOwnerId(q.from.id)) return tg('answerCallbackQuery', { callback_query_id: q.id, text: "Ruxsat yo'q" });
  const e = text => tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
  if (a === 'st') {
    const o = db.orders.find(x => x.id === ph), st = parts[2];
    if (!o || !ST[st] || st === 'new') return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Topilmadi' });
    if (o.status === 'done' || o.status === 'cancelled') return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Buyurtma yakunlangan' });
    await setStatus(o, st);
    const fin = st === 'done' || st === 'cancelled';
    await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: orderText(o), reply_markup: fin ? { inline_keyboard: [] } : orderKb(o) });
  } else if (a === 'ok') {
    db.sellers[ph] = true; await saveMeta(); await e('✅ Ruxsat berildi: +' + ph);
    if (db.chats[ph]) tg('sendMessage', { chat_id: db.chats[ph], text: "✅ Sizga sotuvchi bo'lishga ruxsat berildi. Saytni yangilang." });
  } else if (a === 'no') {
    await e('❌ Rad etildi: +' + ph);
    if (db.chats[ph]) tg('sendMessage', { chat_id: db.chats[ph], text: "❌ Sotuvchi bo'lish so'rovingiz rad etildi." });
  } else if (a === 'rm') {
    delete db.sellers[ph]; await saveMeta(); await e('🗑 Ruxsat qaytarib olindi: +' + ph);
  }
  await tg('answerCallbackQuery', { callback_query_id: q.id });
}
async function listSellers(cid) {
  const l = Object.keys(db.sellers);
  if (!l.length) return tg('sendMessage', { chat_id: cid, text: "Sotuvchilar yo'q." });
  return tg('sendMessage', { chat_id: cid, text: "Sotuvchilar (ruxsatni qaytarish uchun bosing):",
    reply_markup: { inline_keyboard: l.map(p => [{ text: '❌ +' + p, callback_data: 'rm:' + p }]) } });
}

let off = 0;
async function poll() {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: off, timeout: 30 });
      for (const u of r.result || []) {
        off = u.update_id + 1;
        if (u.callback_query) { await onCb(u.callback_query); continue; }
        const m = u.message; if (!m) continue;
        if (m.contact) {
          if (m.contact.user_id === m.from.id) {
            db.chats[norm(m.contact.phone_number)] = m.chat.id; await saveMeta();
            await tg('sendMessage', { chat_id: m.chat.id, text: "✅ Raqamingiz tasdiqlandi. Saytga qaytib raqamni kiriting, kod shu yerga keladi.", reply_markup: { remove_keyboard: true } });
          } else {
            await tg('sendMessage', { chat_id: m.chat.id, text: "Faqat o'zingizning raqamingizni yuboring." });
          }
        } else if (m.text === '/sotuvchilar' && isOwnerId(m.from.id)) {
          await listSellers(m.chat.id);
        } else {
          await tg('sendMessage', { chat_id: m.chat.id, text: "Ayub Market 🔥\nRaqamingizni tasdiqlash uchun tugmani bosing 👇",
            reply_markup: { keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
        }
      }
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  }
}

const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const auth = req => {
  try {
    const [b, s] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
    const ok = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    if (!s || s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); res.end(JSON.stringify(o)); };

function serve() {
  http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let html; try { html = fs.readFileSync('index.html'); } catch { res.writeHead(404); return res.end('index.html topilmadi'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const p = db.products.find(x => x.id === req.url.slice(5).split('?')[0]);
      const m = p && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p.img || '');
      if (!m) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' });
      return res.end(Buffer.from(m[2], 'base64'));
    }
    let b = ''; req.on('data', c => { b += c; if (b.length > 700000) req.destroy(); });
    req.on('end', async () => {
      let d = {}; try { d = JSON.parse(b || '{}'); } catch {}
      const ph = norm(d.phone);
      const me = auth(req);

      if (req.url === '/login') {
        const chat = db.chats[ph];
        if (!chat) return send(res, 200, { ok: false, need_bot: true, link: `https://t.me/${BOT}` });
        const last = codes[ph];
        if (last && Date.now() - last.t < 30000) return send(res, 429, { ok: false, error: '30 soniya kuting' });
        const code = String(crypto.randomInt(100000, 1000000));
        codes[ph] = { code, t: Date.now(), tries: 0 };
        tg('sendMessage', { chat_id: chat, text: `Ayub Market kirish kodi: ${code}\n5 daqiqa amal qiladi. Hech kimga bermang.` });
        return send(res, 200, { ok: true });
      }

      if (req.url === '/verify') {
        const c = codes[ph];
        if (!c || Date.now() - c.t > 300000 || c.tries >= 5) return send(res, 400, { ok: false, error: "Kod eskirgan, qayta so'rang" });
        c.tries++;
        const a = Buffer.from(String(d.code || '').padEnd(6)), k = Buffer.from(c.code);
        if (a.length !== k.length || !crypto.timingSafeEqual(a, k)) return send(res, 400, { ok: false, error: "Kod noto'g'ri" });
        delete codes[ph];
        return send(res, 200, { ok: true, phone: ph, token: sign({ ph, exp: Date.now() + 30 * 864e5 }) });
      }

      if (req.url === '/products' && req.method === 'GET') {
        if (!me) return send(res, 401, { ok: false });
        return send(res, 200, { ok: true, owner: me.ph === OWNER, canPost: canPost(me.ph), phone: me.ph,
          items: db.products.map(p => ({ id: p.id, name: p.name, price: p.price, cat: p.cat, by: p.by, desc: p.desc || '', img: p.img ? '/img/' + p.id : '' })) });
      }
      if (req.url === '/request-seller') {
        if (!me) return send(res, 401, { ok: false });
        if (canPost(me.ph)) return send(res, 200, { ok: true, already: true });
        const oc = OWNER && db.chats[OWNER];
        if (!oc) return send(res, 200, { ok: false, error: 'Egasi hali botni ulamagan' });
        if (lastReq[me.ph] && Date.now() - lastReq[me.ph] < 3600000) return send(res, 429, { ok: false, error: "So'rov yuborilgan. Egasi javobini kuting." });
        lastReq[me.ph] = Date.now();
        tg('sendMessage', { chat_id: oc, text: "🆕 Sotuvchi bo'lish so'rovi: +" + me.ph,
          reply_markup: { inline_keyboard: [[{ text: '✅ Ruxsat', callback_data: 'ok:' + me.ph }, { text: '❌ Rad', callback_data: 'no:' + me.ph }]] } });
        return send(res, 200, { ok: true });
      }
      if (req.url === '/products' && req.method === 'POST') {
        if (!me || !canPost(me.ph)) return send(res, 403, { ok: false, error: "Mahsulot qo'shish uchun egasidan ruxsat kerak" });
        const name = String(d.name || '').slice(0, 100), price = parseInt(d.price, 10);
        if (!name || !(price > 0)) return send(res, 400, { ok: false, error: 'Nom va narx kerak' });
        const p = { id: 'p' + Date.now(), name, price, by: me.ph, cat: String(d.cat || '').slice(0, 30), desc: String(d.desc || '').slice(0, 300), img: String(d.img || '').slice(0, 400000) };
        db.products.unshift(p); await saveProduct(p);
        return send(res, 200, { ok: true });
      }

      if (req.url === '/orders' && req.method === 'POST') {
        if (!me) return send(res, 401, { ok: false });
        if ((ordRate[me.ph] || []).filter(t => Date.now() - t < 3600000).length >= 5) return send(res, 429, { ok: false, error: "Juda ko'p buyurtma. Keyinroq urining" });
        const items = []; let total = 0;
        for (const it of (Array.isArray(d.items) ? d.items : []).slice(0, 50)) {
          const p = db.products.find(x => x.id === it.id), q = parseInt(it.qty, 10);
          if (!p || !(q > 0 && q <= 99)) continue;
          items.push({ id: p.id, name: p.name, price: p.price, qty: q }); total += p.price * q;
        }
        if (!items.length) return send(res, 400, { ok: false, error: "Savat bo'sh" });
        const type = d.type === 'pickup' ? 'pickup' : 'delivery';
        const address = String(d.address || '').trim().slice(0, 200);
        if (type === 'delivery') {
          if (total <= FREE_MIN) return send(res, 400, { ok: false, error: "Yetkazib berish uchun xarid 199 000 so'mdan oshishi kerak" });
          if (!address) return send(res, 400, { ok: false, error: 'Manzilni kiriting' });
        }
        const slot = /^(bugun|ertaga) \d\d:\d\d-\d\d:\d\d$/.test(d.slot || '') ? d.slot : 'express';
        const tel = String(d.tel || '').replace(/[^\d+]/g, '').slice(0, 16) || '+' + me.ph;
        const o = { id: 'o' + Date.now(), phone: me.ph, tel, items, total, type, address, slot, comment: String(d.comment || '').trim().slice(0, 200), status: 'new', at: Date.now() };
        db.orders.unshift(o); (ordRate[me.ph] = ordRate[me.ph] || []).push(Date.now());
        await saveOrder(o); notifyOwner(o);
        return send(res, 200, { ok: true, id: o.id, num: num(o) });
      }
      if (req.url === '/requests' && req.method === 'POST') {
        if (!me) return send(res, 401, { ok: false });
        if ((ordRate[me.ph] || []).filter(t => Date.now() - t < 3600000).length >= 5) return send(res, 429, { ok: false, error: "Juda ko'p so'rov. Keyinroq urining" });
        const text = String(d.text || '').trim().slice(0, 600), address = String(d.address || '').trim().slice(0, 200);
        if (text.length < 3) return send(res, 400, { ok: false, error: 'Kerakli narsalarni yozing' });
        if (!address) return send(res, 400, { ok: false, error: 'Manzilni kiriting' });
        const tel = String(d.tel || '').replace(/[^\d+]/g, '').slice(0, 16) || '+' + me.ph;
        const o = { id: 'o' + Date.now(), kind: 'request', phone: me.ph, tel, items: [], total: 0, type: 'delivery', address, slot: 'express', text, comment: '', status: 'new', at: Date.now() };
        db.orders.unshift(o); (ordRate[me.ph] = ordRate[me.ph] || []).push(Date.now());
        await saveOrder(o); notifyOwner(o);
        return send(res, 200, { ok: true, id: o.id, num: num(o) });
      }
      if (req.url === '/orders' && req.method === 'GET') {
        if (!me) return send(res, 401, { ok: false });
        const own = me.ph === OWNER;
        return send(res, 200, { ok: true, owner: own, items: db.orders.filter(o => own || o.phone === me.ph).slice(0, 100) });
      }
      if (req.url === '/orders/status') {
        if (!me || me.ph !== OWNER) return send(res, 403, { ok: false });
        const o = db.orders.find(x => x.id === d.id);
        if (!o || !ST[d.status] || d.status === 'new' || o.status === 'done' || o.status === 'cancelled') return send(res, 400, { ok: false, error: "Bo'lmaydi" });
        await setStatus(o, d.status); return send(res, 200, { ok: true });
      }
      if (req.url === '/orders/cancel') {
        if (!me) return send(res, 401, { ok: false });
        const o = db.orders.find(x => x.id === d.id && x.phone === me.ph);
        if (!o || o.status !== 'new') return send(res, 400, { ok: false, error: "Buyurtmani endi bekor qilib bo'lmaydi" });
        await setStatus(o, 'cancelled'); notifyOwner(o, '⚠️ Mijoz bekor qildi'); return send(res, 200, { ok: true });
      }

      if (req.url === '/products/delete') {
        if (!me || !canPost(me.ph)) return send(res, 403, { ok: false });
        const p = db.products.find(x => x.id === d.id);
        if (p && (me.ph === OWNER || p.by === me.ph)) { db.products = db.products.filter(x => x.id !== p.id); await removeProduct(p.id); }
        return send(res, 200, { ok: true });
      }
      send(res, 404, { ok: false });
    });
  }).listen(process.env.PORT || 3000, () => console.log('Ishlayapti'));
}

loadDb().then(() => { poll(); serve(); }).catch(e => { console.error(e.message); process.exit(1); });
github.com/4y4cvgc5pb-design/-ayub-telegram-login/edit/main/server.js
