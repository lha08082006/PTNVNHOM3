// api/simulate-payment.js - Bảng điều khiển giả lập Webhook Sandbox (Dành cho nhóm báo cáo & test)
const DB = require('../lib/db');
const sepayWebhookHandler = require('./sepay-webhook');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const scenario = body.scenario || 'OK'; // 'OK', 'SHORT', 'EXCESS', 'LATE', 'NETWORK_LAG'
    const orderCode = body.order_code || 'BC2610279854';

    let order = await DB.getOrderByCode(orderCode);
    if (!order) {
      console.log('[Simulate Sandbox] Đơn hàng chưa tồn tại, tự động tạo mới đơn:', orderCode);
      const stubTotal = Number(body.total || body.custom_amount || 179000);
      order = await DB.createOrder({
        code: orderCode,
        movie_key: body.movie_key || 'an-mang-karaoke',
        cinema: body.cinema || 'Beta Thanh Xuân',
        show_date: body.show_date || 'T4 28/10',
        show_time: body.show_time || '19:30',
        seats: body.seats ? (Array.isArray(body.seats) ? body.seats : body.seats.split(',').map(s => s.trim())) : ['D5', 'D6'],
        combos: body.combos || { couple: 1 },
        total: stubTotal,
        phone: body.phone || '0987654321'
      });
    }

    const orderTotal = Number(order.total || 179000);
    const txId = Math.floor(Date.now() / 1000);
    const referenceCode = 'FT' + Math.floor(10000000 + Math.random() * 90000000);

    let transferAmount = orderTotal;
    let description = '';

    if (scenario === 'SHORT') {
      // Đặt lại đơn về trạng thái chưa thanh toán và còn hạn để mô phỏng chính xác
      await DB.updateOrder(order.id, {
        paid_amount: 0,
        status: 'HOLDING',
        hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      // Trả thiếu (Ví dụ: Thiếu 79.000 đ hoặc theo custom_amount)
      transferAmount = body.custom_amount || Math.max(50000, orderTotal - 79000);
      description = `Giả lập khách chuyển THIẾU tiền: ${transferAmount}đ / ${orderTotal}đ (Còn thiếu ${orderTotal - transferAmount}đ)`;
    } else if (scenario === 'EXCESS') {
      // Đặt lại đơn về trạng thái chưa thanh toán và còn hạn
      await DB.updateOrder(order.id, {
        paid_amount: 0,
        status: 'HOLDING',
        hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      // Trả thừa (Ví dụ: Thừa 21.000 đ)
      transferAmount = body.custom_amount || (orderTotal + 21000);
      description = `Giả lập khách chuyển THỪA tiền: ${transferAmount}đ / ${orderTotal}đ (Thừa ${transferAmount - orderTotal}đ)`;
    } else if (scenario === 'LATE') {
      // Đơn hết hạn rồi mới chuyển tiền
      await DB.updateOrder(order.id, {
        paid_amount: 0,
        hold_expires_at: new Date(Date.now() - 60000).toISOString(),
        status: 'EXPIRED'
      });
      transferAmount = orderTotal;
      description = `Giả lập khách chuyển tiền sau khi ĐÃ HẾT 10 PHÚT giữ ghế`;
    } else if (scenario === 'NETWORK_LAG') {
      // Giả lập lưu giao dịch vào ngân hàng nhưng chưa khớp đơn (chờ BetaBot đối soát)
      await DB.saveBankTransaction({
        id: txId,
        gateway: 'MSB',
        account_number: '4208082006',
        transaction_date: new Date().toISOString(),
        content: `CK TIEN VE ${orderCode} NGUYEN VAN A`,
        code: orderCode,
        transfer_type: 'in',
        amount: orderTotal,
        reference_code: referenceCode,
        result: 'ERROR',
        note: 'Giao dịch ngân hàng thành công nhưng webhook bị trễ mạng chưa kích hoạt xuất vé'
      });

      return res.status(200).json({
        ok: true,
        scenario: 'NETWORK_LAG',
        message: `Đã giả lập: Tiền đã trừ tại ngân hàng với Mã GD "${referenceCode}", nhưng web chưa nhận được. Hãy mở BetaBot AI và nhập mã "${referenceCode}" để kiểm tra đối soát!`,
        reference_code: referenceCode,
        order_code: orderCode
      });
    } else {
      // Mặc định OK:
      // Nếu đơn đang là PARTIAL (ví dụ khách đang ở underpay.html bấm chuyển nốt số tiền thiếu)
      // thì transferAmount chính là số tiền còn lại!
      const currentPaid = Number(order.paid_amount || 0);
      if (order.status === 'PARTIAL' && currentPaid > 0 && currentPaid < orderTotal) {
        transferAmount = orderTotal - currentPaid;
        description = `Giả lập khách chuyển BÙ nốt số tiền thiếu: ${transferAmount}đ (Hoàn tất 100% đơn hàng)`;
      } else {
        // Reset về ban đầu và trả 100%
        await DB.updateOrder(order.id, {
          paid_amount: 0,
          status: 'HOLDING',
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        });
        transferAmount = orderTotal;
        description = `Giả lập khách chuyển ĐỦ 100% tiền vé: ${transferAmount}đ`;
      }
    }

    // Tạo payload webhook SePay giả lập
    const fakeWebhookReq = {
      method: 'POST',
      body: {
        id: txId,
        gateway: 'MSB',
        transactionDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
        accountNumber: '4208082006',
        code: orderCode,
        content: `${orderCode} NGUYEN HOANG NAM chuyen tien`,
        transferType: 'in',
        transferAmount: transferAmount,
        accumulated: 15000000,
        subAccount: null,
        referenceCode: referenceCode
      }
    };

    // Gọi trực tiếp webhook handler
    let responseData = null;
    let statusCode = 200;
    const fakeWebhookRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await sepayWebhookHandler(fakeWebhookReq, fakeWebhookRes);

    return res.status(statusCode).json({
      ok: true,
      scenario,
      description,
      webhook_response: responseData,
      reference_code: referenceCode
    });
  } catch (error) {
    console.error('[API simulate-payment Error]:', error);
    return res.status(500).json({ error: error.message || 'Lỗi giả lập thanh toán' });
  }
};
