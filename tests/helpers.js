// tests/helpers.js - Tiện ích kiểm thử: chạy handler với req/res giả trên Mock Store
process.env.NODE_ENV = 'test';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SEPAY_API_KEY = 'test-sepay-key';

const DB = require('../lib/db');

async function call(handler, { method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  let statusCode = 200;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { payload = data; return this; },
    get writableEnded() { return payload !== undefined; }
  };
  await handler({ method, body, query, headers }, res);
  return { status: statusCode, body: payload };
}

const AUTH = { authorization: 'Apikey test-sepay-key' };
let txSeq = 1000;

// Gửi một thông báo SePay giả lập
function sepay(webhook, { code, content, amount, id, referenceCode, transferType = 'in', headers = AUTH } = {}) {
  const txId = id != null ? id : ++txSeq;
  return call(webhook, {
    headers,
    body: {
      id: txId,
      gateway: 'MSB',
      transactionDate: '2026-11-19 10:00:00',
      accountNumber: '0000000000',
      code: code === undefined ? null : code,
      content: content || (code ? `${code} chuyen tien` : 'chuyen tien ve xem phim'),
      transferType,
      transferAmount: amount,
      referenceCode: referenceCode || 'FT' + txId
    }
  });
}

async function newOrder(overrides = {}) {
  return DB.createOrder({
    movie_key: 'phim-test',
    cinema: 'Beta Test',
    show_date: 'T5 19/11',
    show_time: '19:30',
    seats: ['A1', 'A2'],
    total: 90000,
    phone: '0912345678',
    ...overrides
  });
}

async function expire(order) {
  return DB.updateOrder(order.id, { hold_expires_at: new Date(Date.now() - 60000).toISOString() });
}

function reset() {
  DB.__resetMock({ seed: false });
}

module.exports = { DB, call, sepay, newOrder, expire, reset, AUTH };
