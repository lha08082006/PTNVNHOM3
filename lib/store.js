// lib/store.js - Tầng truy cập dữ liệu dùng chung (Supabase hoặc bộ nhớ trong)
// Chế độ được chọn MỘT LẦN khi khởi động, không âm thầm chuyển qua lại giữa hai nguồn
// (tránh tình trạng một nửa dữ liệu nằm ở Supabase, một nửa nằm trong bộ nhớ).
//   DB_MODE=mock  -> luôn dùng bộ nhớ trong (chạy thử / kiểm thử, không đụng DB thật)
//   còn lại       -> dùng Supabase nếu có SUPABASE_URL + khóa hợp lệ
require('dotenv').config();

let supabase = null;
const wantMock = String(process.env.DB_MODE || '').toLowerCase() === 'mock';
const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!wantMock && url.startsWith('http') && key) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, { auth: { persistSession: false } });
    console.log('[Store] Supabase:', url);
  } catch (e) {
    console.warn('[Store] Không khởi tạo được Supabase, dùng bộ nhớ trong:', e.message);
    supabase = null;
  }
}
if (!supabase) console.log('[Store] Đang dùng bộ nhớ trong (DB_MODE=mock hoặc chưa cấu hình Supabase).');

const mem = {
  orders: [], seat_holds: [], bank_transactions: [], refunds: [],
  support_tickets: [], notifications: [], gateway_logs: [], complaints: [], customers: [], staff: [], audit_logs: [],
  movies: [], cinemas: [], showtimes: [], vouchers: [], ticket_types: [], price_rules: [], holidays: [], posts: [], ticket_checkins: [], password_resets: [], auth_throttle: [],
  point_ledger: [], movie_reviews: [], rooms: [], event_requests: [], movie_watches: [], payment_attempts: [], invoice_requests: [], favorites: [], error_logs: [], system_state: [], campaigns: []
};

// Bộ lọc: { col: value } (bằng) | { col: { in: [] } } | { col: { lt|lte|gt|gte|neq: v } } | { col: { is: null } }
function matches(row, filter) {
  for (const [col, cond] of Object.entries(filter || {})) {
    const v = row[col];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('neq' in cond && v === cond.neq) return false;
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('lte' in cond && !(v <= cond.lte)) return false;
      if ('gt' in cond && !(v > cond.gt)) return false;
      if ('gte' in cond && !(v >= cond.gte)) return false;
      if ('is' in cond && !(v === cond.is || (cond.is === null && v === undefined))) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

function applySb(q, filter) {
  for (const [col, cond] of Object.entries(filter || {})) {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) q = q.in(col, cond.in);
      if ('neq' in cond) q = q.neq(col, cond.neq);
      if ('lt' in cond) q = q.lt(col, cond.lt);
      if ('lte' in cond) q = q.lte(col, cond.lte);
      if ('gt' in cond) q = q.gt(col, cond.gt);
      if ('gte' in cond) q = q.gte(col, cond.gte);
      if ('is' in cond) q = q.is(col, cond.is);
    } else {
      q = q.eq(col, cond);
    }
  }
  return q;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const genId = () => (global.crypto && crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

const Store = {
  isLive: () => !!supabase,
  mem, // chỉ dùng cho kiểm thử

  async insert(table, row) {
    const r = { ...row };
    if (r.id === undefined && table !== 'seat_holds') r.id = table === 'bank_transactions' ? Date.now() * 1000 + Math.floor(Math.random() * 1000) : genId();
    if (!r.created_at && table !== 'seat_holds') r.created_at = new Date().toISOString();
    if (supabase) {
      const { data, error } = await supabase.from(table).insert(r).select().single();
      if (error) { const e = new Error(`[${table}.insert] ${error.message}`); e.code = error.code; throw e; }
      return data;
    }
    if (table === 'seat_holds' && mem.seat_holds.some(s => s.showtime_key === r.showtime_key && s.seat_id === r.seat_id)) {
      const e = new Error('duplicate key seat_holds'); e.code = '23505'; throw e;
    }
    if (table === 'refunds' && r.idempotency_key && mem.refunds.some(x => x.idempotency_key === r.idempotency_key)) {
      const e = new Error('duplicate key refunds.idempotency_key'); e.code = '23505'; throw e;
    }
    if (table === 'bank_transactions' && r.reference_code && mem.bank_transactions.some(x => x.reference_code === r.reference_code)) {
      const e = new Error('duplicate key bank_transactions.reference_code'); e.code = '23505'; throw e;
    }
    if (table === 'ticket_checkins' && mem.ticket_checkins.some(x => x.order_id === r.order_id)) {
      const e = new Error('duplicate key ticket_checkins'); e.code = '23505'; throw e;
    }
    if (table === 'point_ledger' && mem.point_ledger.some(x => x.ref === r.ref)) {
      const e = new Error('duplicate key point_ledger.ref'); e.code = '23505'; throw e;
    }
    if (table === 'movie_reviews' && mem.movie_reviews.some(x => x.order_code === r.order_code)) {
      const e = new Error('duplicate key movie_reviews.order_code'); e.code = '23505'; throw e;
    }
    if (table === 'movie_watches' && mem.movie_watches.some(x => x.customer_id === r.customer_id && x.movie_id === r.movie_id)) {
      const e = new Error('duplicate key movie_watches'); e.code = '23505'; throw e;
    }
    if (table === 'event_requests' && mem.event_requests.some(x => x.code === r.code)) {
      const e = new Error('duplicate key event_requests.code'); e.code = '23505'; throw e;
    }
    if (table === 'invoice_requests' && mem.invoice_requests.some(x => x.order_code === r.order_code)) {
      const e = new Error('duplicate key invoice_requests.order_code'); e.code = '23505'; throw e;
    }
    if (table === 'favorites' && mem.favorites.some(x => x.customer_id === r.customer_id && x.movie_id === r.movie_id)) {
      const e = new Error('duplicate key favorites'); e.code = '23505'; throw e;
    }
    if (table === 'system_state' && mem.system_state.some(x => x.id === r.id)) {
      const e = new Error('duplicate key system_state'); e.code = '23505'; throw e;
    }
    if (table === 'customers' && mem.customers.some(x => x.email === r.email || (r.phone && x.phone === r.phone))) {
      const e = new Error('duplicate key customers'); e.code = '23505'; throw e;
    }
    mem[table].push(clone(r));
    return clone(r);
  },

  async find(table, filter = {}, { order = 'created_at', asc = false, limit = 500 } = {}) {
    if (supabase) {
      let q = applySb(supabase.from(table).select('*'), filter);
      if (order) q = q.order(order, { ascending: asc });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw new Error(`[${table}.find] ${error.message}`);
      return data || [];
    }
    let rows = mem[table].filter(r => matches(r, filter));
    if (order) rows.sort((a, b) => (a[order] > b[order] ? 1 : a[order] < b[order] ? -1 : 0) * (asc ? 1 : -1));
    return clone(rows.slice(0, limit));
  },

  // Đọc TẤT CẢ dòng của bảng (Supabase giới hạn 1000 dòng / lần -> đọc theo trang). Dùng cho sao lưu.
  async findAll(table) {
    if (supabase) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
        if (error) throw new Error(`[${table}.findAll] ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return out;
    }
    return clone(mem[table] || []);
  },

  async one(table, filter) {
    const rows = await Store.find(table, filter, { limit: 1 });
    return rows[0] || null;
  },

  // Cập nhật có điều kiện: chỉ những dòng thỏa filter mới bị đổi -> dùng làm "compare-and-set"
  async update(table, filter, patch) {
    if (supabase) {
      const { data, error } = await applySb(supabase.from(table).update(patch), filter).select();
      if (error) throw new Error(`[${table}.update] ${error.message}`);
      return data || [];
    }
    const out = [];
    for (const r of mem[table]) {
      if (matches(r, filter)) { Object.assign(r, clone(patch)); out.push(clone(r)); }
    }
    return out;
  },

  async remove(table, filter) {
    if (supabase) {
      const { error } = await applySb(supabase.from(table).delete(), filter);
      if (error) throw new Error(`[${table}.remove] ${error.message}`);
      return;
    }
    mem[table] = mem[table].filter(r => !matches(r, filter));
  }
};

module.exports = Store;
