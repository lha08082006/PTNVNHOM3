// lib/db.js - Tầng dữ liệu kết nối Supabase và dự phòng Mock Store
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

let supabase = null;
let isLiveSupabase = false;

if (supabaseUrl && supabaseUrl.startsWith('http') && !supabaseUrl.includes('your-project') && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    isLiveSupabase = true;
    console.log('[Database] Đã khởi tạo Supabase Client với URL:', supabaseUrl);
  } catch (err) {
    console.warn('[Database] Không thể khởi tạo Supabase Client, chuyển sang chế độ Mock Store:', err.message);
  }
} else {
  console.log('[Database] Đang chạy chế độ Local Mock Store (Chưa có SUPABASE_URL hợp lệ). Toàn bộ dữ liệu vẫn lưu trữ và test mượt mà!');
}

// In-Memory Mock Store (phục vụ test mượt mà ngay cả khi chưa gắn URL)
const mockDB = {
  orders: new Map(),
  seat_holds: new Map(),
  bank_transactions: new Map(),
  refunds: new Map(),
  complaints: new Map()
};

// Seed 1 đơn hàng mẫu để test nhanh nếu muốn
const defaultSampleOrder = {
  id: 'bc001-sample-id',
  code: 'BC2610279854',
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
  hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  paid_at: null,
  created_at: new Date().toISOString()
};
mockDB.orders.set(defaultSampleOrder.code, defaultSampleOrder);

const DB = {
  isLive: () => isLiveSupabase,

  // 1b. Lấy danh sách đơn hàng mới nhất từ Supabase
  async getOrders({ limit = 20, phone } = {}) {
    if (isLiveSupabase) {
      try {
        let query = supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (phone) query = query.eq('phone', phone);
        const { data, error } = await query;
        if (!error && data) return data;
      } catch (err) {
        console.warn('[Supabase getOrders Error]:', err.message);
      }
    }

    const all = Array.from(mockDB.orders.values()).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    return all.slice(0, limit);
  },

  // 1. Tạo đơn hàng
  async createOrder(data) {
    const code = data.code || ('BC' + Math.floor(1000000000 + Math.random() * 9000000000));
    const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const orderRecord = {
      code,
      user_id: data.user_id || null,
      phone: data.phone || '0987654321',
      movie_key: data.movie_key || '',
      cinema: data.cinema || 'Beta Thanh Xuân',
      show_date: data.show_date || '',
      show_time: data.show_time || '',
      showtime_key: data.showtime_key || `${data.movie_key}|${data.cinema}|${data.show_date}|${data.show_time}`,
      seats: data.seats || [],
      combos: data.combos || {},
      voucher: data.voucher || null,
      total: Number(data.total || 0),
      paid_amount: 0,
      status: 'HOLDING',
      hold_expires_at: holdExpiresAt,
      paid_at: null,
      created_at: new Date().toISOString()
    };

    if (isLiveSupabase) {
      try {
        const { data: inserted, error } = await supabase
          .from('orders')
          .insert(orderRecord)
          .select()
          .single();

        if (error) throw error;

        // Lưu seat_holds
        if (orderRecord.seats && orderRecord.seats.length > 0) {
          const seatRows = orderRecord.seats.map(s => ({
            showtime_key: orderRecord.showtime_key,
            seat_id: s,
            order_id: inserted.id,
            status: 'HELD',
            expires_at: holdExpiresAt
          }));
          try {
            await supabase.from('seat_holds').insert(seatRows);
          } catch (e) {}
        }
        return inserted;
      } catch (err) {
        console.warn('[Supabase createOrder Error, fallback to mock]:', err.message);
      }
    }

    // Mock Store
    orderRecord.id = 'ord-' + Date.now();
    mockDB.orders.set(code, orderRecord);
    return orderRecord;
  },

  // 2. Lấy thông tin đơn hàng theo Mã code
  async getOrderByCode(code) {
    if (!code) return null;
    let order = null;

    if (isLiveSupabase) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('code', code)
          .single();
        if (!error && data) order = data;
      } catch (err) {
        console.warn('[Supabase getOrderByCode Error]:', err.message);
      }
    }

    if (!order) {
      order = mockDB.orders.get(code);
    }

    if (!order) return null;

    // Kiểm tra hết hạn giữ ghế
    const now = new Date();
    const expiresAt = new Date(order.hold_expires_at);
    if ((order.status === 'HOLDING' || order.status === 'PARTIAL') && now > expiresAt) {
      order.status = 'EXPIRED';
      await DB.updateOrder(order.id, { status: 'EXPIRED' });
    }

    return order;
  },

  // 3. Cập nhật đơn hàng
  async updateOrder(idOrCode, updates) {
    if (isLiveSupabase) {
      try {
        const query = typeof idOrCode === 'string' && idOrCode.startsWith('BC')
          ? supabase.from('orders').update(updates).eq('code', idOrCode)
          : supabase.from('orders').update(updates).eq('id', idOrCode);
        const { data, error } = await query.select().single();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[Supabase updateOrder Error]:', err.message);
      }
    }

    // Mock
    for (const [code, ord] of mockDB.orders.entries()) {
      if (ord.id === idOrCode || ord.code === idOrCode || code === idOrCode) {
        Object.assign(ord, updates);
        return ord;
      }
    }
    return null;
  },

  // 4. Lưu giao dịch ngân hàng từ SePay
  async saveBankTransaction(tx) {
    const record = {
      id: tx.id || Date.now(),
      gateway: tx.gateway || 'MBBank',
      account_number: tx.account_number || tx.accountNumber || '0888999888',
      transaction_date: tx.transaction_date || tx.transactionDate || new Date().toISOString(),
      content: tx.content || '',
      code: tx.code || '',
      transfer_type: tx.transfer_type || tx.transferType || 'in',
      amount: Number(tx.amount || tx.transferAmount || 0),
      reference_code: tx.reference_code || tx.referenceCode || ('FT' + Date.now()),
      raw: tx.raw || tx,
      order_id: tx.order_id || null,
      result: tx.result || 'OK',
      note: tx.note || '',
      created_at: new Date().toISOString()
    };

    if (isLiveSupabase) {
      try {
        const { data, error } = await supabase
          .from('bank_transactions')
          .insert(record)
          .select()
          .single();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[Supabase saveBankTx Error]:', err.message);
      }
    }

    mockDB.bank_transactions.set(record.reference_code, record);
    mockDB.bank_transactions.set(record.id.toString(), record);
    return record;
  },

  // 5. Tìm kiếm giao dịch ngân hàng theo mã tham chiếu
  async findBankTransaction(refCode, orderCode) {
    if (isLiveSupabase) {
      try {
        let query = supabase.from('bank_transactions').select('*');
        if (refCode) query = query.eq('reference_code', refCode);
        else if (orderCode) query = query.eq('code', orderCode);

        const { data } = await query.maybeSingle();
        if (data) return data;
      } catch (err) {
        console.warn('[Supabase findBankTx Error]:', err.message);
      }
    }

    for (const tx of mockDB.bank_transactions.values()) {
      if (refCode && tx.reference_code === refCode) return tx;
      if (orderCode && tx.code === orderCode) return tx;
    }
    return null;
  },

  // 6. Tạo hồ sơ hoàn tiền (Refund)
  async createRefund(refundData) {
    const code = refundData.code || ('REF-' + new Date().toISOString().slice(2, 4) + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-' + Math.floor(100 + Math.random() * 900));

    const record = {
      code,
      order_id: refundData.order_id,
      bank_tx_id: refundData.bank_tx_id || null,
      amount: Number(refundData.amount || 0),
      reason: refundData.reason || 'LATE', // LATE, SHORT, EXCESS, DUPLICATE, SYSTEM_ERROR
      status: refundData.status || 'WAITING_INFO', // WAITING_INFO, RECEIVED, RECONCILING, APPROVED, DONE
      bank_name: refundData.bank_name || null,
      acc_number: refundData.acc_number || null,
      acc_name: refundData.acc_name || null,
      received_at: refundData.received_at || null,
      reconciled_at: refundData.reconciled_at || null,
      approved_at: refundData.approved_at || null,
      done_at: refundData.done_at || null,
      refund_ref: refundData.refund_ref || null,
      created_at: new Date().toISOString()
    };

    if (isLiveSupabase) {
      try {
        const { data, error } = await supabase
          .from('refunds')
          .insert(record)
          .select()
          .single();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[Supabase createRefund Error]:', err.message);
      }
    }

    mockDB.refunds.set(code, record);
    return record;
  },

  // 7. Lấy danh sách hoặc 1 hồ sơ hoàn tiền
  async getRefund(query) {
    if (isLiveSupabase) {
      try {
        let q = supabase.from('refunds').select('*, orders(*)');
        if (query.code) q = q.eq('code', query.code);
        if (query.order_id) q = q.eq('order_id', query.order_id);
        const { data } = await q.maybeSingle();
        if (data) return data;
      } catch (err) {
        console.warn('[Supabase getRefund Error]:', err.message);
      }
    }

    for (const r of mockDB.refunds.values()) {
      if (query.code && r.code === query.code) return r;
      if (query.order_id && r.order_id === query.order_id) return r;
      if (query.order_code) {
        const ord = mockDB.orders.get(query.order_code);
        if (ord && ord.id === r.order_id) return r;
      }
    }
    return null;
  },

  // 8. Cập nhật hồ sơ hoàn tiền (Khách gửi STK nhận tiền)
  async updateRefund(code, updates) {
    const touch = {};
    if (updates.status === 'RECEIVED') touch.received_at = new Date().toISOString();
    if (updates.status === 'RECONCILING') touch.reconciled_at = new Date().toISOString();
    if (updates.status === 'APPROVED') touch.approved_at = new Date().toISOString();
    if (updates.status === 'DONE') touch.done_at = new Date().toISOString();

    const merged = { ...updates, ...touch };

    if (isLiveSupabase) {
      try {
        const { data, error } = await supabase
          .from('refunds')
          .update(merged)
          .eq('code', code)
          .select()
          .single();
        if (!error && data) return data;
      } catch (err) {
        console.warn('[Supabase updateRefund Error]:', err.message);
      }
    }

    for (const r of mockDB.refunds.values()) {
      if (r.code === code) {
        Object.assign(r, merged);
        return r;
      }
    }
    return null;
  },

  // 9. Tạo khiếu nại (Complaints) khi không tìm thấy giao dịch
  async createComplaint(data) {
    const code = 'CS-' + new Date().toISOString().slice(2, 4) + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-' + Math.floor(100 + Math.random() * 900);
    const record = {
      code,
      bank_ref: data.bank_ref || null,
      order_code: data.order_code || null,
      phone: data.phone || null,
      amount: Number(data.amount || 0),
      description: data.description || '',
      status: 'OPEN',
      created_at: new Date().toISOString()
    };

    if (isLiveSupabase) {
      try {
        const { data: inserted, error } = await supabase
          .from('complaints')
          .insert(record)
          .select()
          .single();
        if (!error && inserted) return inserted;
      } catch (err) {
        console.warn('[Supabase createComplaint Error]:', err.message);
      }
    }

    mockDB.complaints.set(code, record);
    return record;
  }
};

module.exports = DB;
