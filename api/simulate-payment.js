// api/simulate-payment.js - SANDBOX mô phỏng ngân hàng / cổng thanh toán để chạy các kịch bản UAT
// Không chuyển tiền thật. Mỗi kịch bản tạo ra đúng loại sự kiện mà hệ thống thật sẽ nhận:
//   OK           : chuyển đủ tiền, webhook về ngay                              (TC-01)
//   SHORT        : chuyển thiếu, webhook về ngay                                (chuyển bù)
//   TOPUP        : chuyển nốt phần còn thiếu
//   EXCESS       : chuyển thừa -> xuất vé + tự hoàn phần thừa
//   NETWORK_LAG  : ngân hàng đã trừ tiền nhưng webhook thất lạc                 (TC-03)
//   SLOW_BANK    : ngân hàng xử lý chậm, cổng báo PENDING trong `delay_min` phút (TC-04/05/06)
//   LATE         : khách chuyển tiền sau khi đã hết 10 phút giữ ghế             (TC-08)
//   SEAT_TAKEN   : khách khác mua mất ghế của đơn đã EXPIRED                    (TC-07)
//   MISMATCH     : cổng báo SUCCESS nhưng sai số tiền (đơn đã EXPIRED)          (TC-15)
//   UNMATCHED    : tiền vào không ghi mã đơn
//   DUP_WEBHOOK  : SePay gửi lại webhook của giao dịch gần nhất                 (TC-15)
//   REFUND_FAIL  : Refund API thất bại `times` lần (1 -> TC-09, 99 -> TC-10)
//   NO_SOURCE    : không truy xuất được tài khoản nguồn của khách
//   SHOWTIME     : đặt giờ chiếu còn `minutes` phút nữa
//   SHIFT        : "tua nhanh" thời gian của đơn thêm `minutes` phút (demo Job 30 phút / 24 giờ)
const Store = require('../lib/store');
const Flow = require('../lib/flow');
const { fail, clean } = require('../lib/api-util');

const MIN = 60 * 1000;
const SENDER = { bank_name: 'MB Bank', acc_number: '0861200466', acc_name: 'NGUYEN HOANG NAM' };
const randRef = () => 'FT' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);
const shiftIso = (v, ms) => (v ? new Date(new Date(v).getTime() - ms).toISOString() : v);

function webhookBody(order, amount, { content, ref, noSource } = {}) {
  return {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    gateway: 'MSB',
    transactionDate: new Date().toISOString(),
    accountNumber: '96886693088500',
    content: content != null ? content : `${order.code} NGUYEN HOANG NAM chuyen tien`,
    transferType: 'in',
    transferAmount: amount,
    referenceCode: ref || randRef(),
    sender: noSource ? undefined : SENDER
  };
}

// Ghi giao dịch vào "sổ cái cổng thanh toán" mà KHÔNG bắn webhook
async function ledgerOnly(order, amount, { delayMin = 0, noSource } = {}) {
  const now = new Date();
  const ref = randRef();
  return Store.insert('bank_transactions', {
    gateway: 'MSB',
    account_number: '96886693088500',
    transaction_date: now.toISOString(),
    content: `${order.code} NGUYEN HOANG NAM chuyen tien`,
    code: order.code,
    transfer_type: 'in',
    amount,
    reference_code: ref,
    raw: { sender: noSource ? undefined : SENDER, visible_at: delayMin ? new Date(now.getTime() + delayMin * MIN).toISOString() : undefined, sandbox: true },
    order_id: order.id,
    result: 'MATCHED',
    note: delayMin ? `Sandbox: ngân hàng xử lý chậm ${delayMin} phút, webhook thất lạc` : 'Sandbox: webhook thất lạc'
  });
}

async function shiftOrder(order, minutes) {
  const ms = minutes * MIN;
  await Store.update('orders', { id: order.id }, {
    created_at: shiftIso(order.created_at, ms), hold_expires_at: shiftIso(order.hold_expires_at, ms),
    expired_at: shiftIso(order.expired_at, ms), scan_until: shiftIso(order.scan_until, ms),
    job_checked_at: shiftIso(order.job_checked_at, ms), last_check_at: shiftIso(order.last_check_at, ms),
    reported_at: shiftIso(order.reported_at, ms)
  });
  for (const r of await Store.find('refunds', { order_code: order.code })) {
    await Store.update('refunds', { id: r.id }, {
      created_at: shiftIso(r.created_at, ms), deadline_at: shiftIso(r.deadline_at, ms), last_attempt_at: shiftIso(r.last_attempt_at, ms)
    });
  }
  for (const s of await Store.find('seat_holds', { order_id: order.id }, { order: null })) {
    if (s.expires_at) await Store.update('seat_holds', { showtime_key: s.showtime_key, seat_id: s.seat_id }, { expires_at: shiftIso(s.expires_at, ms) });
  }
  for (const t of await Store.find('bank_transactions', { code: order.code })) {
    const raw = { ...(t.raw || {}) };
    if (raw.visible_at) raw.visible_at = shiftIso(raw.visible_at, ms);
    await Store.update('bank_transactions', { reference_code: t.reference_code }, { transaction_date: shiftIso(t.transaction_date, ms), raw });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const b = req.body || {};
    const scenario = clean(b.scenario || 'OK').toUpperCase();
    const code = clean(b.order_code || b.code).toUpperCase();
    let order = code ? await Store.one('orders', { code }) : null;
    if (!order && scenario !== 'UNMATCHED') return res.status(404).json({ error: 'Không tìm thấy đơn #' + code });

    const custom = Number(b.custom_amount || 0);
    const noSource = !!(order && order.sandbox && order.sandbox.no_source);
    let description = '';
    let webhook = null;

    switch (scenario) {
      case 'OK':
      case 'TOPUP': {
        const amount = custom || Math.max(0, order.total - (order.paid_amount || 0)) || order.total;
        webhook = await Flow.handleIncomingTransfer(webhookBody(order, amount, { noSource }));
        description = `Chuyển ${amount}đ, webhook SePay về ngay`;
        break;
      }
      case 'SHORT': {
        const amount = custom || Math.max(10000, order.total - 79000);
        webhook = await Flow.handleIncomingTransfer(webhookBody(order, amount, { noSource }));
        description = `Chuyển thiếu ${amount}đ/${order.total}đ`;
        break;
      }
      case 'EXCESS': {
        const amount = custom || order.total + 21000;
        webhook = await Flow.handleIncomingTransfer(webhookBody(order, amount, { noSource }));
        description = `Chuyển thừa ${amount}đ/${order.total}đ`;
        break;
      }
      case 'NETWORK_LAG': {
        const tx = await ledgerOnly(order, custom || order.total, { noSource });
        description = `Ngân hàng đã trừ tiền (mã GD ${tx.reference_code}) nhưng webhook thất lạc – chờ Short Polling/Final Check phát hiện`;
        break;
      }
      case 'SLOW_BANK': {
        const delay = Number(b.delay_min || 12);
        const tx = await ledgerOnly(order, custom || order.total, { delayMin: delay, noSource });
        description = `Khách chuyển tiền ngay (mã GD ${tx.reference_code}) nhưng cổng báo PENDING trong ${delay} phút, webhook thất lạc`;
        break;
      }
      case 'LATE': {
        if (order.status === 'PENDING') {
          await shiftOrder(order, 11);
          order = await Flow.tick(await Store.one('orders', { id: order.id }));
        }
        webhook = await Flow.handleIncomingTransfer(webhookBody(order, custom || order.total, { noSource }));
        description = 'Khách chuyển tiền SAU khi đã hết 10 phút giữ ghế';
        break;
      }
      case 'SEAT_TAKEN': {
        if (order.status === 'PENDING') return res.status(409).json({ error: 'Ghế vẫn đang giữ cho đơn này – hãy để đơn hết hạn (EXPIRED) trước' });
        const other = await Flow.createOrder({
          movie_key: order.movie_key, cinema: order.cinema, show_date: order.show_date, show_time: order.show_time,
          showtime_key: order.showtime_key, seats: order.seats, total: order.total, phone: '0900000000', customer_name: 'KHACH KHAC (sandbox)'
        });
        await Flow.handleIncomingTransfer(webhookBody(other, other.total));
        description = `Khách khác (đơn ${other.code}) đã mua ghế ${order.seats.join(', ')}`;
        break;
      }
      case 'MISMATCH': {
        const tx = await ledgerOnly(order, custom || Math.max(1000, order.total - 1000), { noSource });
        description = `Cổng báo SUCCESS ${tx.amount}đ nhưng đơn là ${order.total}đ`;
        break;
      }
      case 'UNMATCHED': {
        webhook = await Flow.handleIncomingTransfer(webhookBody({ code: '' }, custom || 90000, { content: 'NGUYEN VAN A chuyen tien ve xem phim' }));
        description = 'Tiền vào không ghi mã đơn';
        break;
      }
      case 'DUP_WEBHOOK': {
        const last = (await Store.find('bank_transactions', { code: order.code }, { limit: 1 }))[0];
        if (!last) return res.status(409).json({ error: 'Đơn chưa có giao dịch nào để gửi lại' });
        webhook = await Flow.handleIncomingTransfer({ ...(last.raw || {}), referenceCode: last.reference_code, transferAmount: last.amount, content: last.content, transferType: 'in' });
        description = `Gửi lại webhook của giao dịch ${last.reference_code}`;
        break;
      }
      case 'REFUND_FAIL':
      case 'NO_SOURCE': {
        const sandbox = { ...(order.sandbox || {}) };
        if (scenario === 'REFUND_FAIL') sandbox.refund_fail_times = Number(b.times || 1);
        else sandbox.no_source = true;
        await Store.update('orders', { id: order.id }, { sandbox });
        if (scenario === 'NO_SOURCE') {
          for (const r of await Store.find('refunds', { order_code: order.code, status: { in: ['REQUESTED', 'RETRYING'] } })) {
            await Store.update('refunds', { id: r.id }, { source_account: null });
          }
        }
        description = scenario === 'REFUND_FAIL' ? `Refund API sẽ thất bại ${sandbox.refund_fail_times} lần` : 'Giao dịch không có thông tin tài khoản nguồn';
        break;
      }
      case 'SHOWTIME': {
        const minutes = Number(b.minutes || 20);
        await Store.update('orders', { id: order.id }, { show_at: new Date(Date.now() + minutes * MIN).toISOString() });
        description = `Giờ chiếu đặt lại còn ${minutes} phút nữa`;
        break;
      }
      case 'SHIFT': {
        const minutes = Math.min(48 * 60, Math.max(0.1, Number(b.minutes || 30)));
        await shiftOrder(order, minutes);
        description = `Tua nhanh ${minutes} phút`;
        break;
      }
      default:
        return res.status(400).json({ error: 'Kịch bản không hỗ trợ: ' + scenario });
    }

    if (order) {
      order = await Store.one('orders', { id: order.id });
      order = (await Flow.tick(order)) || order;
    }
    return res.status(200).json({ ok: true, scenario, description, webhook, order: order ? await Flow.view(order) : null });
  } catch (e) {
    return fail(res, e);
  }
};
