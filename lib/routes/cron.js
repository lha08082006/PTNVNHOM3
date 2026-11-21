// lib/routes/cron.js (phục vụ tại /api/cron) - Job đối soát định kỳ (Tầng 2 + gửi lại lệnh hoàn tiền Tầng 3)
// Vercel Cron gọi kèm "Authorization: Bearer <CRON_SECRET>". Chạy với Supabase thật thì BẮT BUỘC đặt CRON_SECRET
// (nếu không, ai cũng gọi được để chạy Job liên tục).
const Store = require('../store');
const Flow = require('../flow');
const { fail } = require('../api-util');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret && Store.isLive()) return res.status(503).json({ error: 'Chưa cấu hình CRON_SECRET trên máy chủ' });
  if (secret && String((req.headers && req.headers.authorization) || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const Ops = require('../ops');
    const job = await Flow.runJob();
    // Đợt 2: thư nhắc suất chiếu, mời đánh giá, quà sinh nhật & điểm sắp hết hạn (Beta Club)
    let reminders;
    try { reminders = await require('../reminders').run(); } catch (e) { reminders = { error: e.message }; console.warn('[reminders]', e.message); }
    // Đợt 10h: tự gia hạn lịch chiếu – ngày còn trống chép lịch tuần trước (AUTO_SCHEDULE_DAYS, mặc định 14; 0 = tắt)
    let schedule;
    try { schedule = await require('../schedule-extend').extend(); } catch (e) { schedule = { error: e.message }; console.warn('[schedule-extend]', e.message); }
    const checks = await Ops.dailyChecks();
    await Ops.mark('cron', { changed: job.changed.length, reminders, schedule_created: schedule && schedule.created });
    return res.status(200).json({ ok: true, ...job, reminders, schedule, checks });
  } catch (e) {
    await require('../ops').alert('cron-failed', 'Job đối soát hằng ngày bị lỗi', 'Lỗi: ' + e.message + '. Đơn chờ đối soát và thư nhắc có thể chưa chạy – kiểm tra Vercel > Logs.');
    return fail(res, e);
  }
};
