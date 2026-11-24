// lib/campaigns.js - Gửi email ưu đãi theo nhóm khách (Đợt 6)
//
// CHỈ gửi cho khách đã đồng ý nhận email quảng cáo (customers.marketing_opt_in) và chưa xóa tài khoản.
// Mỗi thư có link hủy đăng ký 1 chạm (+ header List-Unsubscribe). Nhóm khách:
//   ALL           mọi khách đồng ý nhận
//   TIER          hạng Beta Club (param: VIP | VVIP)
//   FAV_MOVIE     đã thêm phim vào Yêu thích (param: mã phim)
//   INACTIVE      không có đơn xuất vé trong N ngày (param: số ngày, mặc định 60)
//   BIRTHDAY      sinh nhật trong tháng này
// Gửi theo từng đợt nhỏ (step) do trang admin gọi lần lượt: vừa với giới hạn thời gian chạy của Vercel
// (10 giây / lần gọi) và tốc độ gửi của Resend (gói miễn phí: 2 thư / giây, 100 thư / ngày).
const Store = require('./store');
const Mailer = require('./mailer');
const Auth = require('./auth');
const Points = require('./points');
const Catalog = require('../catalog');

const SEGMENTS = { ALL: 'Mọi khách đồng ý nhận', TIER: 'Theo hạng Beta Club', FAV_MOVIE: 'Đã yêu thích một phim', INACTIVE: 'Lâu không đặt vé', BIRTHDAY: 'Sinh nhật trong tháng này' };
const BATCH = 8;
const GAP_MS = 550;
const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function siteUrl() { return require('./site-url').envSiteUrl(); } // trên Vercel: tên miền production
const unsubUrl = (c) => (siteUrl() || '') + '/api/auth?action=unsubscribe&u=' + encodeURIComponent(c.id) + '&t=' + Auth.unsubToken(c.id);

async function audience(segment, param) {
  if (!SEGMENTS[segment]) throw httpError('Chọn nhóm khách', 400);
  const all = (await Store.find('customers', { marketing_opt_in: true }, { order: null, limit: 50000 })).filter(c => !c.deleted_at && /@/.test(c.email || ''));
  if (segment === 'ALL') return all;
  if (segment === 'BIRTHDAY') {
    const m = new Date(Date.now() + 7 * 3600e3).toISOString().slice(5, 7);
    return all.filter(c => c.birthday && String(c.birthday).slice(5, 7) === m);
  }
  if (segment === 'FAV_MOVIE') {
    const ids = new Set((await Store.find('favorites', { movie_id: str(param, 80) }, { order: null, limit: 50000 })).map(f => f.customer_id));
    return all.filter(c => ids.has(c.id));
  }
  if (segment === 'TIER') {
    const tier = Catalog.LOYALTY.TIERS.find(t => t.id === str(param).toUpperCase());
    if (!tier) throw httpError('Chọn hạng', 400);
    const out = [];
    for (const c of all) if (Catalog.tierOf(await Points.spend365(c.id)).id === tier.id) out.push(c);
    return out;
  }
  // INACTIVE
  const days = Math.min(365, Math.max(14, Number(param) || 60));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const recent = new Set((await Store.find('orders', { status: { in: ['CONFIRMED', 'CONFIRMED_LATE'] }, created_at: { gte: since } }, { order: null, limit: 100000 })).map(o => o.user_id));
  return all.filter(c => !recent.has(c.id));
}

async function preview({ segment, param }) {
  const list = await audience(str(segment).toUpperCase(), param);
  return { count: list.length, mail_ready: Mailer.isConfigured() };
}

async function create({ subject, message, segment, param }, staff) {
  const sub = str(subject, 120), msg = str(message, 3000);
  if (sub.length < 5) throw httpError('Nhập tiêu đề (ít nhất 5 ký tự)', 400);
  if (msg.length < 20) throw httpError('Nhập nội dung (ít nhất 20 ký tự)', 400);
  const seg = str(segment).toUpperCase();
  const list = await audience(seg, param);
  if (!list.length) throw httpError('Nhóm khách này chưa có ai đồng ý nhận email', 400);
  // Chống bấm gửi 2 lần: cùng tiêu đề + nhóm trong 1 giờ
  const dup = (await Store.find('campaigns', { subject: sub, segment: seg }, { limit: 5 })).find(c => Date.now() - new Date(c.created_at) < 3600e3);
  if (dup) throw httpError('Chiến dịch cùng tiêu đề và nhóm khách vừa được tạo (' + dup.id.slice(0, 8) + ')', 409);
  return Store.insert('campaigns', {
    subject: sub, message: msg, segment: seg, param: str(param, 80) || null, recipients: list.map(c => c.id), cursor: 0,
    sent: 0, failed: 0, skipped: 0, status: 'SENDING', created_by: staff ? staff.full_name : null, updated_at: new Date().toISOString()
  });
}

// Gửi đợt tiếp theo (tối đa BATCH thư). Khách hủy đăng ký giữa chừng / đã xóa tài khoản thì bỏ qua.
async function step(id) {
  const c = await Store.one('campaigns', { id: str(id, 60) });
  if (!c) throw httpError('Không tìm thấy chiến dịch', 404);
  if (c.status !== 'SENDING') return pub(c);
  const ids = (c.recipients || []).slice(c.cursor, c.cursor + BATCH);
  let sent = 0, failed = 0, skipped = 0;
  for (const cid of ids) {
    const cu = await Store.one('customers', { id: cid });
    if (!cu || cu.deleted_at || !cu.marketing_opt_in) { skipped++; continue; }
    const first = String(cu.full_name || '').trim().split(/\s+/).pop() || 'bạn';
    const r = await Mailer.send({ to: cu.email, title: c.subject, message: c.message.replace(/\{ten\}/gi, first), unsubscribeUrl: unsubUrl(cu) });
    if (r.sent) sent++; else if (r.reason === 'not-configured') skipped++; else failed++;
    if (Mailer.isConfigured()) await sleep(GAP_MS);
  }
  const cursor = c.cursor + ids.length;
  const done = cursor >= (c.recipients || []).length;
  const [u] = await Store.update('campaigns', { id: c.id, cursor: c.cursor }, {
    cursor, sent: c.sent + sent, failed: c.failed + failed, skipped: c.skipped + skipped, status: done ? 'DONE' : 'SENDING', updated_at: new Date().toISOString()
  });
  return pub(u || c);
}

const pub = (c) => ({ id: c.id, subject: c.subject, segment: c.segment, segment_label: SEGMENTS[c.segment], param: c.param, total: (c.recipients || []).length, cursor: c.cursor, sent: c.sent, failed: c.failed, skipped: c.skipped, status: c.status, created_by: c.created_by, created_at: c.created_at });
async function list() { return (await Store.find('campaigns', {}, { limit: 30 })).map(pub); }

module.exports = { SEGMENTS, audience, preview, create, step, list, BATCH };
