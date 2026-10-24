const http = require('http'), fs = require('fs'), crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN, BOT = process.env.BOT_USERNAME;
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
if (!TOKEN || !BOT) { console.error('BOT_TOKEN va BOT_USERNAME kerak'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}/`;
let db = { chats: {} };
try { db = JSON.parse(fs.readFileSync('db.json')); } catch {}
const save = () => fs.writeFileSync('db.json', JSON.stringify(db));
const codes = {};

const norm = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 ? '998' + d : d; };
const tg = (m, b) => fetch(API + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

let off = 0;
(async function poll() {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: off, timeout: 30 });
      for (const u of r.result || []) {
        off = u.update_id + 1;
        const m = u.message; if (!m) continue;
        if (m.contact) {
          if (m.contact.user_id === m.from.id) {
            db.chats[norm(m.contact.phone_number)] = m.chat.id; save();
            await tg('sendMessage', { chat_id: m.chat.id, text: "✅ Raqamingiz tasdiqlandi. Saytga qaytib raqamni kiriting, kod shu yerga keladi.", reply_markup: { remove_keyboard: true } });
          } else {
            await tg('sendMessage', { chat_id: m.chat.id, text: "Faqat o'zingizning raqamingizni yuboring." });
          }
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
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  let b = ''; req.on('data', c => { b += c; if (b.length > 2000) req.destroy(); });
  req.on('end', () => {
    let d = {}; try { d = JSON.parse(b || '{}'); } catch {}
    const ph = norm(d.phone);

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
    send(res, 404, { ok: false });
  });
}).listen(process.env.PORT || 3000, () => console.log('Ishlayapti'));
