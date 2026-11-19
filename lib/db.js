// lib/db.js - Tầng dữ liệu kết nối Supabase và dự phòng Mock Store
// Mọi bí mật chỉ đọc từ biến môi trường (xem .env.example). KHÔNG hard-code khóa trong mã nguồn.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const HOLD_MS = 10 * 60 * 1000; // 10 phút giữ ghế
const IS_PROD = process.env.NODE_ENV === 'production';
// Ở production, lỗi CSDL phải được báo ra thay vì âm thầm rơi về Mock Store (mất dữ liệu)
const STRICT = IS_PROD || process.env.DB_STRICT === 'true';
// Cho phép chạy Mock Store ở production (chỉ dùng cho bản demo không có Supabase)
const ALLOW_MOCK = !IS_PROD || process.env.ALLOW_MOCK_DB === 'true';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY || '';

let supabase = null;
if (process.env.NODE_ENV !== 'test' && supabaseUrl.startsWith('http') && !supabaseUrl.includes('your-project') && supabaseKey && !supabaseKey.includes('...')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    console.log('[Database] Đã kết nối Supabase:', supabaseUrl);
  } catch (err) {
    console.warn('[Database] Không thể khởi tạo Supabase Client:', err.message);
  }
} else if (process.env.NODE_ENV !== 'test') {
  if (process.env.SUPABASE_PUBLISHABLE_KEY && !supabaseKey) {
    console.warn('[Database] Chỉ có SUPABASE_PUBLISHABLE_KEY: server cần SUPABASE_SECRET_KEY vì các bảng bật RLS.');
  }
  console.log('[Database] Đang chạy Local Mock Store (chưa cấu hình SUPABASE_URL / SUPABASE_SECRET_KEY).');
}

class DBError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Ném lỗi nếu Supabase trả về error
function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const isUniqueViolation = (err) => err && (err.code === '23505' || err.code === 'DUPLICATE');

async function withStore(label, liveFn, mockFn) {
  if (supabase) {
    try {
      return await liveFn();
    } catch (err) {
      if (err instanceof DBError || STRICT) throw err;
      console.warn(`[Supabase ${label} Error, dùng Mock Store]:`, err.message);
    }
  }
  if (!ALLOW_MOCK) {
    throw new DBError('Chưa cấu hình cơ sở dữ liệu (SUPABASE_URL / SUPABASE_SECRET_KEY)', 'DB_NOT_CONFIGURED');
  }
  return mockFn();
}

const nowIso = () => new Date().toISOString();
const yymm = () => {
  const d = new Date();
  return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
};
const rand = (digits) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const showtimeKeyOf = (o) => o.showtime_key || `${o.movie_key}|${o.cinema}|${o.show_date}|${o.show_time}`;

// =========================================================================
// In-Memory Mock Store (phục vụ demo & kiểm thử khi chưa có Supabase)
// =========================================================================
let mockDB;
function resetMock({ seed = true } = {}) {
  mockDB = {
    orders: new Map(),            // code -> order
    seat_holds: new Map(),        // showtime_key|seat_id -> hold
    bank_transactions: new Map(), // String(id) -> tx
    refunds: new Map(),           // code -> refund
    complaints: new Map()         // code -> complaint
  };
  if (seed) {
    // Đơn mẫu (DEMO) để thử nhanh các kịch bản thanh toán
    const sample = {
      id: 'bc001-sample-id',
      code: 'BC2610279854',
      user_id: null,
      phone: null,
      movie_key: 'linh-gioi-dai-chien',
      cinema: 'Beta Thanh Xuân',
      show_date: 'CN 25/10',
      show_time: '12:15',
      showtime_key: 'linh-gioi-dai-chien|Beta Thanh Xuân|CN 25/10|12:15',
      seats: ['D5', 'D6'],
      combos: { solo: 1 },
      voucher: 'BETAVIP',
      total: 179000,
      paid_amount: 0,
      status: 'HOLDING',
      hold_expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
      paid_at: null,
      created_at: nowIso()
    };
    mockDB.orders.set(sample.code, sample);
  }
}
resetMock();

function mockFindOrder(idOrCode) {
  if (mockDB.orders.has(idOrCode)) return mockDB.orders.get(idOrCode);
  for (const o of mockDB.orders.values()) if (o.id === idOrCode) return o;
  return null;
}

function mockHoldActive(hold, now = new Date()) {
  if (hold.status === 'SOLD') return true;
  return !hold.expires_at || new Date(hold.expires_at) > now;
}

const DB = {
  isLive: () => !!supabase,
  HOLD_MS,

  // 1. Danh sách đơn hàng mới nhất
  async getOrders({ limit = 20, phone } = {}) {
    return withStore('getOrders', async () => {
      let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit);
      if (phone) q = q.eq('phone', phone);
      return unwrap(await q) || [];
    }, () => {
      return Array.from(mockDB.orders.values())
        .filter(o => !phone || o.phone === phone)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    });
  },

  // 2. Tạo đơn hàng + giữ ghế (ném DBError SEAT_TAKEN nếu ghế đã có người giữ)
  async createOrder(data, { holdSeats = true } = {}) {
    const holdExpiresAt = new Date(Date.now() + HOLD_MS).toISOString();
    const record = {
      code: data.code || ('BC' + (1000000000 + Math.floor(Math.random() * 9000000000))),
      user_id: data.user_id || null,
      phone: data.phone || null,
      movie_key: data.movie_key || '',
      cinema: data.cinema || '',
      show_date: data.show_date || '',
      show_time: data.show_time || '',
      seats: data.seats || [],
      combos: data.combos || {},
      voucher: data.voucher || null,
      total: Number(data.total || 0),
      paid_amount: 0,
      status: 'HOLDING',
      hold_expires_at: holdExpiresAt,
      paid_at: null
    };
    record.showtime_key = data.showtime_key || showtimeKeyOf(record);
    const seats = holdSeats ? record.seats : [];

    return withStore('createOrder', async () => {
      if (seats.length) {
        // Nhả các ghế giữ đã hết hạn trước khi giữ mới
        unwrap(await supabase.from('seat_holds').delete()
          .eq('showtime_key', record.showtime_key).in('seat_id', seats)
          .eq('status', 'HELD').lt('expires_at', nowIso()));
      }
      const inserted = unwrap(await supabase.from('orders').insert(record).select().single());
      if (seats.length) {
        const { error } = await supabase.from('seat_holds').insert(seats.map(s => ({
          showtime_key: record.showtime_key,
          seat_id: s,
          order_id: inserted.id,
          status: 'HELD',
          expires_at: holdExpiresAt
        })));
        if (error) {
          await supabase.from('orders').delete().eq('id', inserted.id);
          if (isUniqueViolation(error)) throw new DBError('Ghế đã có người giữ, vui lòng chọn ghế khác', 'SEAT_TAKEN');
          throw error;
        }
      }
      return inserted;
    }, () => {
      if (mockDB.orders.has(record.code)) throw new DBError('Mã đơn đã tồn tại', 'DUPLICATE');
      const now = new Date();
      const taken = seats.filter(s => {
        const h = mockDB.seat_holds.get(record.showtime_key + '|' + s);
        return h && mockHoldActive(h, now);
      });
      if (taken.length) throw new DBError('Ghế đã có người giữ: ' + taken.join(', '), 'SEAT_TAKEN');

      const order = { ...record, id: 'ord-' + Date.now() + '-' + rand(4), created_at: nowIso() };
      mockDB.orders.set(order.code, order);
      for (const s of seats) {
        mockDB.seat_holds.set(order.showtime_key + '|' + s, {
          showtime_key: order.showtime_key, seat_id: s, order_id: order.id, status: 'HELD', expires_at: holdExpiresAt
        });
      }
      return order;
    });
  },

  // 3. Lấy đơn theo mã (tự chuyển EXPIRED nếu đã quá hạn giữ ghế)
  async getOrderByCode(code) {
    if (!code) return null;
    const order = await withStore('getOrderByCode', async () => {
      return unwrap(await supabase.from('orders').select('*').eq('code', code).maybeSingle());
    }, () => mockDB.orders.get(code) || null);
    if (!order) return null;
    return DB.expireIfNeeded(order);
  },

  async getOrderById(id) {
    if (!id) return null;
    const order = await withStore('getOrderById', async () => {
      return unwrap(await supabase.from('orders').select('*').eq('id', id).maybeSingle());
    }, () => mockFindOrder(id));
    if (!order) return null;
    return DB.expireIfNeeded(order);
  },

  // Đơn HOLDING/PARTIAL quá hạn -> EXPIRED, nhả ghế; nếu đã trả một phần thì lập hồ sơ hoàn phần đó
  async expireIfNeeded(order) {
    if ((order.status === 'HOLDING' || order.status === 'PARTIAL') && new Date() > new Date(order.hold_expires_at)) {
      const paid = Number(order.paid_amount || 0);
      const updated = await DB.updateOrder(order.id, { status: 'EXPIRED' });
      Object.assign(order, updated || { status: 'EXPIRED' });
      if (paid > 0) {
        await DB.createRefund({ order_id: order.id, amount: paid, reason: 'SHORT' });
      }
    }
    return order;
  },

  // 4. Cập nhật đơn (đồng bộ trạng thái ghế theo trạng thái đơn)
  async updateOrder(idOrCode, updates) {
    const byId = isUuid(idOrCode) || !/^[A-Z]{2}\d+$/.test(String(idOrCode));
    const order = await withStore('updateOrder', async () => {
      return unwrap(await supabase.from('orders').update(updates).eq(byId ? 'id' : 'code', idOrCode).select().single());
    }, () => {
      const ord = mockFindOrder(idOrCode);
      if (!ord) return null;
      Object.assign(ord, updates);
      return ord;
    });
    if (order && updates.status) {
      if (updates.status === 'PAID') await DB.markSeatsSold(order);
      if (updates.status === 'EXPIRED' || updates.status === 'CANCELLED') await DB.releaseSeats(order);
    }
    return order;
  },

  async markSeatsSold(order) {
    return withStore('markSeatsSold', async () => {
      unwrap(await supabase.from('seat_holds').update({ status: 'SOLD', expires_at: null }).eq('order_id', order.id));
    }, () => {
      for (const h of mockDB.seat_holds.values()) {
        if (h.order_id === order.id) { h.status = 'SOLD'; h.expires_at = null; }
      }
    });
  },

  async releaseSeats(order) {
    return withStore('releaseSeats', async () => {
      unwrap(await supabase.from('seat_holds').delete().eq('order_id', order.id).eq('status', 'HELD'));
    }, () => {
      for (const [k, h] of mockDB.seat_holds.entries()) {
        if (h.order_id === order.id && h.status === 'HELD') mockDB.seat_holds.delete(k);
      }
    });
  },

  // 5. Ghi giao dịch ngân hàng (id SePay là khóa chính -> ném DBError DUPLICATE nếu đã tồn tại)
  async insertBankTransaction(tx) {
    const record = {
      id: Number(tx.id),
      gateway: tx.gateway || null,
      account_number: tx.account_number || null,
      transaction_date: tx.transaction_date || nowIso(),
      content: tx.content || '',
      code: tx.code || null,
      transfer_type: tx.transfer_type || 'in',
      amount: Number(tx.amount || 0),
      reference_code: tx.reference_code || null,
      raw: tx.raw || null,
      order_id: tx.order_id || null,
      result: tx.result || null,
      note: tx.note || null
    };
    if (!Number.isSafeInteger(record.id)) throw new DBError('id giao dịch không hợp lệ', 'INVALID_TX');

    return withStore('insertBankTransaction', async () => {
      const { data, error } = await supabase.from('bank_transactions').insert(record).select().single();
      if (error) {
        if (isUniqueViolation(error)) throw new DBError('Giao dịch đã được ghi nhận', 'DUPLICATE');
        throw error;
      }
      return data;
    }, () => {
      const key = String(record.id);
      if (mockDB.bank_transactions.has(key)) throw new DBError('Giao dịch đã được ghi nhận', 'DUPLICATE');
      const saved = { ...record, created_at: nowIso() };
      mockDB.bank_transactions.set(key, saved);
      return saved;
    });
  },

  async updateBankTransaction(id, updates) {
    return withStore('updateBankTransaction', async () => {
      return unwrap(await supabase.from('bank_transactions').update(updates).eq('id', id).select().single());
    }, () => {
      const tx = mockDB.bank_transactions.get(String(id));
      if (!tx) return null;
      Object.assign(tx, updates);
      return tx;
    });
  },

  // 6. Tìm giao dịch: theo id SePay, mã tham chiếu ngân hàng, hoặc mã đơn (mới nhất trước)
  async findBankTransaction({ id, reference_code, order_code, exclude_id } = {}) {
    if (id == null && !reference_code && !order_code) return null;
    return withStore('findBankTransaction', async () => {
      let q = supabase.from('bank_transactions').select('*');
      if (id != null) q = q.eq('id', Number(id));
      else if (reference_code) q = q.eq('reference_code', reference_code);
      else q = q.eq('code', order_code);
      if (exclude_id != null) q = q.neq('id', Number(exclude_id));
      const rows = unwrap(await q.order('created_at', { ascending: false }).limit(1));
      return (rows && rows[0]) || null;
    }, () => {
      const all = Array.from(mockDB.bank_transactions.values()).reverse()
        .filter(t => exclude_id == null || Number(t.id) !== Number(exclude_id));
      if (id != null) return mockDB.bank_transactions.get(String(id)) || null;
      if (reference_code) return all.find(t => t.reference_code === reference_code) || null;
      return all.find(t => t.code === order_code) || null;
    });
  },

  // 7. Tạo hồ sơ hoàn tiền (mỗi cặp giao dịch + lý do chỉ có 1 hồ sơ)
  async createRefund(data) {
    const record = {
      code: data.code || `REF-${yymm()}-${rand(6)}`,
      order_id: data.order_id,
      bank_tx_id: data.bank_tx_id != null ? Number(data.bank_tx_id) : null,
      amount: Number(data.amount || 0),
      reason: data.reason || 'LATE',
      status: data.status || 'WAITING_INFO',
      bank_name: data.bank_name || null,
      acc_number: data.acc_number || null,
      acc_name: data.acc_name || null,
      refund_ref: data.refund_ref || null
    };
    if (!(record.amount > 0)) throw new DBError('Số tiền hoàn phải lớn hơn 0', 'INVALID_REFUND');

    return withStore('createRefund', async () => {
      const { data: inserted, error } = await supabase.from('refunds').insert(record).select().single();
      if (!error) return inserted;
      if (isUniqueViolation(error) && record.bank_tx_id != null) {
        return unwrap(await supabase.from('refunds').select('*')
          .eq('bank_tx_id', record.bank_tx_id).eq('reason', record.reason).single());
      }
      throw error;
    }, () => {
      if (record.bank_tx_id != null) {
        for (const r of mockDB.refunds.values()) {
          if (r.bank_tx_id === record.bank_tx_id && r.reason === record.reason) return r;
        }
      }
      const saved = {
        ...record, id: 'rf-' + Date.now() + '-' + rand(4),
        received_at: null, reconciled_at: null, approved_at: null, done_at: null, created_at: nowIso()
      };
      mockDB.refunds.set(saved.code, saved);
      return saved;
    });
  },

  // 8. Lấy 1 hồ sơ hoàn tiền (mới nhất) theo mã hồ sơ / id đơn / mã đơn
  async getRefund({ code, order_id, order_code } = {}) {
    if (!code && !order_id && order_code) {
      const ord = await DB.getOrderByCode(order_code);
      if (!ord) return null;
      order_id = ord.id;
    }
    if (!code && !order_id) return null;
    return withStore('getRefund', async () => {
      let q = supabase.from('refunds').select('*');
      if (code) q = q.eq('code', code);
      if (order_id) q = q.eq('order_id', order_id);
      const rows = unwrap(await q.order('created_at', { ascending: false }).limit(1));
      return (rows && rows[0]) || null;
    }, () => {
      const all = Array.from(mockDB.refunds.values()).reverse();
      return all.find(r => (!code || r.code === code) && (!order_id || r.order_id === order_id)) || null;
    });
  },

  // 9. Cập nhật hồ sơ hoàn tiền (ghi mốc thời gian khi đổi trạng thái)
  async updateRefund(code, updates) {
    const touch = {};
    if (updates.status === 'RECEIVED') touch.received_at = nowIso();
    if (updates.status === 'RECONCILING') touch.reconciled_at = nowIso();
    if (updates.status === 'APPROVED') touch.approved_at = nowIso();
    if (updates.status === 'DONE') touch.done_at = nowIso();
    const merged = { ...updates, ...touch };

    return withStore('updateRefund', async () => {
      return unwrap(await supabase.from('refunds').update(merged).eq('code', code).select().single());
    }, () => {
      const r = mockDB.refunds.get(code);
      if (!r) return null;
      Object.assign(r, merged);
      return r;
    });
  },

  // 10. Tạo khiếu nại khi không tìm thấy giao dịch
  async createComplaint(data) {
    const record = {
      code: `CS-${yymm()}-${rand(6)}`,
      bank_ref: data.bank_ref || null,
      order_code: data.order_code || null,
      phone: data.phone || null,
      amount: Number(data.amount || 0) || null,
      description: data.description || '',
      status: 'OPEN'
    };
    return withStore('createComplaint', async () => {
      return unwrap(await supabase.from('complaints').insert(record).select().single());
    }, () => {
      const saved = { ...record, created_at: nowIso() };
      mockDB.complaints.set(saved.code, saved);
      return saved;
    });
  }
};

// Chỉ dùng trong kiểm thử
if (process.env.NODE_ENV === 'test') {
  DB.__resetMock = resetMock;
  DB.__mock = () => mockDB;
}

DB.DBError = DBError;
module.exports = DB;
