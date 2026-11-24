// lib/mailer.js - Gửi email thông báo qua Resend (https://resend.com) nếu đã cấu hình.
// Chưa đặt RESEND_API_KEY + MAIL_FROM thì chỉ ghi nhận (chế độ mô phỏng như trước), không lỗi.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const isConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '');
}

function render({ title, message, orderCode, unsubscribeUrl }) {
  const site = siteUrl();
  const link = site && orderCode ? `${site}/order.html?code=${encodeURIComponent(orderCode)}` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
  <h2 style="color:#005198;margin-bottom:8px">${esc(title)}</h2>
  <p style="font-size:15px;line-height:1.6">${esc(message).replace(/\n/g, '<br>')}</p>
  ${orderCode ? `<p style="font-size:14px">Mã đơn hàng: <strong style="font-family:monospace">${esc(orderCode)}</strong></p>` : ''}
  ${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#005198;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Xem đơn hàng</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:12px;color:#64748b">Beta Cinemas – bản demo đồ án môn học (Nhóm 3). Đây là email tự động, vui lòng không trả lời.</p>
  ${unsubscribeUrl ? `<p style="font-size:12px;color:#64748b">Bạn nhận email này vì đã đồng ý nhận ưu đãi từ Beta Cinemas. <a href="${esc(unsubscribeUrl)}" style="color:#64748b">Hủy nhận email ưu đãi</a></p>` : ''}
</div>`;
}

// Trả { sent: true, id } | { sent: false, reason }
async function send({ to, title, message, orderCode, unsubscribeUrl }) {
  if (!to || !/@/.test(to)) return { sent: false, reason: 'no-recipient' };
  if (!isConfigured()) return { sent: false, reason: 'not-configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM, to: [to], subject: `[Beta Cinemas] ${title}`, html: render({ title, message, orderCode, unsubscribeUrl }),
        // Thư quảng cáo: nút "Hủy đăng ký" của Gmail / Outlook
        ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': '<' + unsubscribeUrl + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {})
      }),
      signal: AbortSignal.timeout(8000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: j.message || 'HTTP ' + r.status };
    return { sent: true, id: j.id };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { send, isConfigured, render };
