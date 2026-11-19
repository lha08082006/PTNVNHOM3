// api/cron.js - Job đối soát định kỳ (Tầng 2 + gửi lại lệnh hoàn tiền Tầng 3)
// Vercel Cron gọi kèm "Authorization: Bearer <CRON_SECRET>". Chạy với Supabase thật thì BẮT BUỘC đặt CRON_SECRET
// (nếu không, ai cũng gọi được để chạy Job liên tục).
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const { fail } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret && Store.isLive()) return res.status(503).json({ error: 'Chưa cấu hình CRON_SECRET trên máy chủ' });
  if (secret && String((req.headers && req.headers.authorization) || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    return res.status(200).json({ ok: true, ...(await Flow.runJob()) });
  } catch (e) {
    return fail(res, e);
  }
};
