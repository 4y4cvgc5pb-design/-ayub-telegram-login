const http = require('http'), fs = require('fs'), crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN, BOT = process.env.BOT_USERNAME;
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
if (!TOKEN || !BOT) { console.error('BOT_TOKEN va BOT_USERNAME kerak'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}/`;
let db = { chats: {}, products: [], sellers: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync('db.json'))); } catch {}
const save = () => fs.writeFileSync('db.json', JSON.stringify(db));
const codes = {}, lastReq = {};

const norm = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 ? '998' + d : d; };
const OWNER = norm(process.env.OWNER_PHONE);
const tg = (m, b) => fetch(API + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const isOwnerId = id => OWNER && db.chats[OWNER] === id;
const canPost = ph => ph === OWNER || !!db.sellers[ph];

async function onCb(q) {
  const [a, ph] = String(q.data || '').split(':');
  if (!isOwnerId(q.from.id)) return tg('answerCallbackQuery', { callback_query_id: q.id, text: "Ruxsat yo'q" });
  const e = text => tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
  if (a === 'ok') {
    db.sellers[ph] = true; save(); await e('✅ Ruxsat berildi: +' + ph);
    if (db.chats[ph]) tg('sendMessage', { chat_id: db.chats[ph], text: "✅ Sizga sotuvchi bo'lishga ruxsat berildi. Saytni yangilang." });
  } else if (a === 'no') {
    await e('❌ Rad etildi: +' + ph);
    if (db.chats[ph]) tg('sendMessage', { chat_id: db.chats[ph], text: "❌ Sotuvchi bo'lish so'rovingiz rad etildi." });
  } else if (a === 'rm') {
    delete db.sellers[ph]; save(); await e('🗑 Ruxsat qaytarib olindi: +' + ph);
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
(async function poll() {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: off, timeout: 30 });
      for (const u of r.result || []) {
        off = u.update_id + 1;
        if (u.callback_query) { await onCb(u.callback_query); continue; }
        const m = u.message; if (!m) continue;
        if (m.contact) {
          if (m.contact.user_id === m.from.id) {
            db.chats[norm(m.contact.phone_number)] = m.chat.id; save();
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
})();

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

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    let html; try { html = fs.readFileSync('index.html'); } catch { res.writeHead(404); return res.end('index.html topilmadi'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
  }
  let b = ''; req.on('data', c => { b += c; if (b.length > 700000) req.destroy(); });
  req.on('end', () => {
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
      return send(res, 200, { ok: true, owner: me.ph === OWNER, canPost: canPost(me.ph), phone: me.ph, items: db.products });
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
      db.products.unshift({ id: 'p' + Date.now(), name, price, by: me.ph, cat: String(d.cat || '').slice(0, 30), img: String(d.img || '').slice(0, 400000) });
      save(); return send(res, 200, { ok: true });
    }
    if (req.url === '/products/delete') {
      if (!me || !canPost(me.ph)) return send(res, 403, { ok: false });
      db.products = db.products.filter(p => p.id !== d.id || (me.ph !== OWNER && p.by !== me.ph)); save();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false });
  });
}).listen(process.env.PORT || 3000, () => console.log('Ishlayapti'));

