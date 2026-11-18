// api/cron.js - Job đối soát định kỳ (Tầng 2 + gửi lại lệnh hoàn tiền Tầng 3)
// Vercel Cron gọi kèm "Authorization: Bearer <CRON_SECRET>" nếu có đặt CRON_SECRET.
const Flow = require('../lib/flow');
const { fail } = require('../lib/api-util');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && String((req.headers && req.headers.authorization) || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    return res.status(200).json({ ok: true, ...(await Flow.runJob()) });
  } catch (e) {
    return fail(res, e);
  }
};
