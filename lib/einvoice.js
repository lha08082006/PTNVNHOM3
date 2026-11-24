// lib/einvoice.js - Yêu cầu xuất hóa đơn điện tử (Đợt 4)
//
// Khách gửi thông tin xuất hóa đơn (công ty hoặc cá nhân) cho đơn ĐÃ thanh toán, trong thời hạn
// INVOICE_REQUEST_HOURS giờ kể từ lúc thanh toán (mặc định 24 – Kế toán chỉnh theo quy định áp dụng).
// Kế toán xem danh sách chờ, xuất file CSV để lập hóa đơn trên phần mềm của nhà cung cấp, rồi nhập lại
// số hóa đơn / ký hiệu / link tra cứu -> khách nhận email và xem trong trang đơn.
//
// Kết nối API nhà cung cấp (VNPT Invoice, Viettel S-Invoice, MISA meInvoice…) chưa làm vì cần hợp đồng
// và tài khoản. Khi có: viết adapter trong ADAPTERS với hàm issue(request, order) -> { invoice_no, series, lookup_url }
// rồi đặt EINVOICE_PROVIDER=<tên>. Không đặt -> MANUAL (Kế toán nhập số hóa đơn tay).
const Store = require('./store');
const Mailer = require('./mailer');

const httpError = (msg, http) => Object.assign(new Error(msg), { http });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const PAID = ['CONFIRMED', 'CONFIRMED_LATE'];
const STATUS = { PENDING: 'Chờ Kế toán xuất', ISSUED: 'Đã xuất hóa đơn', CANCELLED: 'Đã hủy yêu cầu' };
const ADAPTERS = {}; // { VNPT: { issue: async (req, order) => ({ invoice_no, series, lookup_url }) } }

const hours = () => Math.max(1, Number(process.env.INVOICE_REQUEST_HOURS) || 24);
const provider = () => {
  const p = String(process.env.EINVOICE_PROVIDER || 'MANUAL').toUpperCase();
  return ADAPTERS[p] ? p : 'MANUAL';
};
const deadlineOf = (order) => new Date(new Date(order.confirmed_at || order.paid_at || order.created_at).getTime() + hours() * 3600e3);

const pub = (r) => r && ({
  order_code: r.order_code, buyer_type: r.buyer_type, tax_code: r.tax_code, company_name: r.company_name, address: r.address,
  buyer_name: r.buyer_name, email: r.email, amount: r.amount, status: r.status, status_label: STATUS[r.status] || r.status,
  invoice_no: r.invoice_no || null, invoice_series: r.invoice_series || null, lookup_url: r.lookup_url || null, issued_at: r.issued_at || null,
  created_at: r.created_at, updated_at: r.updated_at
});

function validate(b) {
  const type = str(b.buyer_type).toUpperCase() === 'PERSONAL' ? 'PERSONAL' : 'COMPANY';
  const email = str(b.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('Nhập email nhận hóa đơn', 400);
  const out = { buyer_type: type, email, buyer_name: str(b.buyer_name, 120) || null, address: str(b.address, 300) || null, tax_code: null, company_name: null };
  if (type === 'COMPANY') {
    out.tax_code = str(b.tax_code, 14).replace(/\s/g, '');
    if (!/^\d{10}(-\d{3})?$/.test(out.tax_code)) throw httpError('Mã số thuế gồm 10 số (chi nhánh: 10 số-3 số)', 400);
    out.company_name = str(b.company_name, 200);
    if (out.company_name.length < 3) throw httpError('Nhập tên công ty theo đăng ký thuế', 400);
    if (!out.address || out.address.length < 5) throw httpError('Nhập địa chỉ công ty theo đăng ký thuế', 400);
  } else if (!out.buyer_name || out.buyer_name.length < 2) throw httpError('Nhập họ tên người mua', 400);
  return out;
}

async function getFor(customer, code) {
  const o = await Store.one('orders', { code: str(code, 20).toUpperCase() });
  if (!o || o.user_id !== customer.id) throw httpError('Không tìm thấy đơn của bạn', 404);
  const r = await Store.one('invoice_requests', { order_code: o.code });
  return { request: pub(r), can_request: PAID.includes(o.status) && (!r || r.status === 'PENDING') && new Date() < deadlineOf(o), deadline: deadlineOf(o).toISOString(), hours: hours() };
}

async function submit(customer, b) {
  const o = await Store.one('orders', { code: str(b.order_code, 20).toUpperCase() });
  if (!o || o.user_id !== customer.id) throw httpError('Không tìm thấy đơn của bạn', 404);
  if (!PAID.includes(o.status)) throw httpError('Chỉ xuất hóa đơn cho đơn đã thanh toán', 409);
  if (new Date() >= deadlineOf(o)) throw httpError(`Đã quá ${hours()} giờ kể từ khi thanh toán – vui lòng liên hệ CSKH`, 409);
  const data = validate(b);
  const now = new Date().toISOString();
  const old = await Store.one('invoice_requests', { order_code: o.code });
  if (old && old.status !== 'PENDING') throw httpError('Yêu cầu đã được xử lý (' + STATUS[old.status] + ')', 409);
  if (old) { const [u] = await Store.update('invoice_requests', { order_code: o.code, status: 'PENDING' }, { ...data, updated_at: now }); return pub(u || old); }
  try {
    return pub(await Store.insert('invoice_requests', { order_code: o.code, customer_id: customer.id, ...data, amount: o.total, status: 'PENDING', provider: provider(), updated_at: now }));
  } catch (e) {
    if (e.code === '23505') throw httpError('Đơn này đã có yêu cầu hóa đơn, tải lại trang để xem', 409);
    throw e;
  }
}

async function list({ status } = {}) {
  return Store.find('invoice_requests', status ? { status } : {}, { limit: 1000 });
}

async function issue(b, staff) {
  const r = await Store.one('invoice_requests', { order_code: str(b.order_code, 20) });
  if (!r) throw httpError('Không tìm thấy yêu cầu hóa đơn', 404);
  if (r.status !== 'PENDING') throw httpError('Yêu cầu không còn chờ xuất', 409);
  let info = { invoice_no: str(b.invoice_no, 30), invoice_series: str(b.invoice_series, 20) || null, lookup_url: str(b.lookup_url, 300) || null };
  if (provider() !== 'MANUAL' && !info.invoice_no) info = await ADAPTERS[provider()].issue(r, await Store.one('orders', { code: r.order_code }));
  if (!info.invoice_no) throw httpError('Nhập số hóa đơn đã xuất', 400);
  if (info.lookup_url && !/^https:\/\//.test(info.lookup_url)) throw httpError('Link tra cứu phải bắt đầu bằng https://', 400);
  const now = new Date().toISOString();
  const [u] = await Store.update('invoice_requests', { order_code: r.order_code, status: 'PENDING' }, { ...info, status: 'ISSUED', issued_at: now, issued_by: staff ? staff.full_name : null, updated_at: now });
  if (!u) throw httpError('Yêu cầu vừa được người khác xử lý', 409);
  await Mailer.send({ to: u.email, title: 'Hóa đơn điện tử đơn ' + u.order_code, orderCode: u.order_code,
    message: `Beta Cinemas đã xuất hóa đơn số ${u.invoice_no}${u.invoice_series ? ' (ký hiệu ' + u.invoice_series + ')' : ''} cho đơn ${u.order_code}.${u.lookup_url ? ' Tra cứu: ' + u.lookup_url : ''}` }).catch(() => null);
  return u;
}

async function cancel(b, staff) {
  const reason = str(b.reason, 300);
  if (reason.length < 3) throw httpError('Nhập lý do hủy yêu cầu', 400);
  const now = new Date().toISOString();
  const [u] = await Store.update('invoice_requests', { order_code: str(b.order_code, 20), status: 'PENDING' }, { status: 'CANCELLED', note: reason, issued_by: staff ? staff.full_name : null, updated_at: now });
  if (!u) throw httpError('Không tìm thấy yêu cầu đang chờ', 404);
  await Mailer.send({ to: u.email, title: 'Yêu cầu hóa đơn đơn ' + u.order_code, orderCode: u.order_code, message: 'Yêu cầu xuất hóa đơn chưa thực hiện được: ' + reason + '. Vui lòng gửi yêu cầu ở Trung tâm hỗ trợ trên website.' }).catch(() => null);
  return u;
}

// File cho Kế toán nhập vào phần mềm hóa đơn (mở bằng Excel)
function toCsv(rows) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Mã đơn', 'Loại người mua', 'Mã số thuế', 'Tên công ty', 'Địa chỉ', 'Người mua', 'Email nhận', 'Số tiền (đã gồm thuế)', 'Trạng thái', 'Số hóa đơn', 'Ký hiệu', 'Thời điểm yêu cầu'];
  return '﻿' + [head.join(',')].concat(rows.map(r => [r.order_code, r.buyer_type === 'COMPANY' ? 'Công ty' : 'Cá nhân', r.tax_code, r.company_name, r.address, r.buyer_name, r.email, r.amount, STATUS[r.status] || r.status, r.invoice_no, r.invoice_series, r.created_at].map(esc).join(','))).join('\r\n');
}

module.exports = { STATUS, getFor, submit, list, issue, cancel, toCsv, provider, hours, ADAPTERS };
