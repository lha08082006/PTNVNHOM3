// lib/store.js - Tầng truy cập dữ liệu dùng chung (Supabase hoặc bộ nhớ trong)
// Chế độ được chọn MỘT LẦN khi khởi động, không âm thầm chuyển qua lại giữa hai nguồn
// (tránh tình trạng một nửa dữ liệu nằm ở Supabase, một nửa nằm trong bộ nhớ).
//   DB_MODE=mock  -> luôn dùng bộ nhớ trong (chạy thử / kiểm thử, không đụng DB thật)
//   còn lại       -> dùng Supabase nếu có SUPABASE_URL + khóa hợp lệ
require('dotenv').config();

// ---------------------------------------------------------------------------
// Đọc cấu hình Supabase (Đợt 10b) – chịu được lỗi nhập hay gặp trên Vercel:
//   - dấu cách / xuống dòng / dấu ngoặc kép thừa quanh giá trị
//   - URL thiếu "https://", có đuôi /rest/v1 hoặc dấu "/" cuối
//   - tên biến theo tích hợp Supabase của Vercel (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY…)
// Chỉ nhận khóa có quyền máy chủ (secret / service_role). Khóa anon / publishable bị từ chối vì bảng đã bật RLS:
// nối bằng khóa đó web sẽ "có database" nhưng đọc ghi đều lỗi.
// Trả kèm `diag` – chỉ có TÊN biến và LOẠI khóa, không bao giờ có giá trị – để admin chỉ ra chỗ sai.
// ---------------------------------------------------------------------------
const URL_VARS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_PROJECT_URL'];
const KEY_VARS = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE'];
const tidy = (v) => String(v == null ? '' : v).trim().replace(/^['"`]+|['"`]+$/g, '').trim();
function keyKind(k) {
  if (!k) return null;
  if (/^sb_secret_/.test(k)) return 'secret';
  if (/^sb_publishable_/.test(k)) return 'publishable';
  const parts = k.split('.');
  if (parts.length === 3) {
    try { const role = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role; return role === 'service_role' ? 'service_role' : role === 'anon' ? 'anon' : 'unknown'; } catch (e) { return 'unknown'; }
  }
  return 'unknown';
}
function resolveConfig(env) {
  const diag = { url_var: null, url_ok: false, key_var: null, key_kind: null, other_key_vars: [], supabase_vars: [] };
  diag.supabase_vars = Object.keys(env).filter(k => /SUPABASE/i.test(k) && tidy(env[k])).sort();
  let url = '';
  for (const n of URL_VARS) { const v = tidy(env[n]); if (v) { url = v; diag.url_var = n; break; } }
  if (url && !/^https?:\/\//i.test(url) && /\.supabase\.(co|in)\b/i.test(url)) url = 'https://' + url;
  url = url.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
  diag.url_ok = /^https?:\/\/[^\s/]+$/i.test(url);
  let key = '';
  for (const n of KEY_VARS) {
    const v = tidy(env[n]);
    if (!v) continue;
    const kind = keyKind(v);
    if (kind === 'anon' || kind === 'publishable') { diag.other_key_vars.push(n + ':' + kind); continue; }
    key = v; diag.key_var = n; diag.key_kind = kind; break;
  }
  // Khóa công khai đặt nhầm tên khác (SUPABASE_ANON_KEY, SUPABASE_KEY…) – chỉ để báo, không dùng
  for (const n of diag.supabase_vars) {
    if (URL_VARS.includes(n) || KEY_VARS.includes(n)) continue;
    const kind = keyKind(tidy(env[n]));
    if (kind && kind !== 'unknown') diag.other_key_vars.push(n + ':' + kind);
  }
  return { url: diag.url_ok ? url : '', key, diag };
}

// Biến cấu hình người dùng tự đặt trên Vercel (DEPLOY.md mục 2) – chỉ ĐẾM để biết bản deploy có nhận biến nào không
const OWN_VARS = ['AUTH_SECRET', 'ADMIN_KEY', 'SEPAY_WEBHOOK_KEY', 'SEPAY_API_KEY', 'CRON_SECRET', 'SITE_URL', 'RESEND_API_KEY', 'MAIL_FROM'];
const BOOT_AT = new Date().toISOString();
const ownCount = () => OWN_VARS.filter(k => tidy(process.env[k])).length;

// Lời khuyên tiếng Việt từ kết quả chẩn đoán (không chứa giá trị bí mật)
function hints(d) {
  const out = [];
  if (!d.supabase_vars.length) {
    const n = ownCount();
    out.push(n === 0
      ? 'Bản deploy này không nhận được biến môi trường nào bạn tự đặt (cả AUTH_SECRET, ADMIN_KEY, SEPAY…): có thể bạn đang sửa biến ở MỘT PROJECT VERCEL KHÁC, hoặc biến chưa tích môi trường Production.'
      : 'Bản deploy nhận được ' + n + '/' + OWN_VARS.length + ' biến cấu hình khác nhưng không có biến SUPABASE nào: biến Supabase chưa được thêm vào môi trường Production (hoặc thêm sau lần deploy này – cần Redeploy).');
  }
  if (!d.url_var) out.push('Thiếu biến SUPABASE_URL (giá trị dạng https://<mã-dự-án>.supabase.co).');
  else if (!d.url_ok) out.push('Biến ' + d.url_var + ' không phải địa chỉ dạng https://<mã-dự-án>.supabase.co.');
  if (!d.key_var) {
    const pub = d.other_key_vars.filter(x => /:(anon|publishable)$/.test(x));
    if (pub.length) out.push('Đang có ' + pub.join(', ') + ' – đây là khóa CÔNG KHAI, không dùng được cho máy chủ. Lấy khóa secret / service_role trong Supabase > Project Settings > API Keys, đặt tên SUPABASE_SECRET_KEY.');
    else out.push('Thiếu biến SUPABASE_SECRET_KEY (khóa secret / service_role trong Supabase > Project Settings > API Keys).');
  }
  if (d.client_error) out.push('Có đủ biến nhưng không tạo được kết nối: ' + d.client_error);
  return out;
}

let supabase = null;
const wantMock = String(process.env.DB_MODE || '').toLowerCase() === 'mock';
const CONFIG = resolveConfig(process.env);
const { url, key } = CONFIG;
CONFIG.diag.client_error = null;

if (!wantMock && url && key) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, { auth: { persistSession: false } });
    console.log('[Store] Supabase:', url, '(' + CONFIG.diag.key_var + ', ' + CONFIG.diag.key_kind + ')');
  } catch (e) {
    console.warn('[Store] Không khởi tạo được Supabase, dùng bộ nhớ trong:', e.message);
    CONFIG.diag.client_error = String(e.message || e).slice(0, 160);
    supabase = null;
  }
}
if (!supabase) console.log('[Store] Đang dùng bộ nhớ trong (DB_MODE=mock hoặc chưa cấu hình Supabase).', wantMock ? '' : JSON.stringify(CONFIG.diag));

const mem = {
  orders: [], seat_holds: [], bank_transactions: [], refunds: [],
  support_tickets: [], notifications: [], gateway_logs: [], complaints: [], customers: [], staff: [], audit_logs: [],
  movies: [], cinemas: [], showtimes: [], vouchers: [], ticket_types: [], price_rules: [], holidays: [], posts: [], ticket_checkins: [], password_resets: [], auth_throttle: [],
  point_ledger: [], movie_reviews: [], rooms: [], event_requests: [], movie_watches: [], payment_attempts: [], invoice_requests: [], favorites: [], error_logs: [], system_state: [], campaigns: [], day_closings: [], banners: []
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
  // Đợt 10: web thật (VERCEL_ENV=production, hoặc REQUIRE_DB=1 khi chạy nơi khác) mà thiếu / sai cấu hình Supabase.
  // Khi đó tuyệt đối không dùng bộ nhớ tạm: đơn và tiền sẽ mất khi máy chủ khởi động lại, mỗi máy một dữ liệu.
  // Đợt 10b: chẩn đoán cấu hình – chỉ tên biến và loại khóa, không có giá trị
  configDiag: () => ({ ...CONFIG.diag, own_vars: ownCount() + '/' + OWN_VARS.length,
    deploy: { commit: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null, branch: process.env.VERCEL_GIT_COMMIT_REF || null, region: process.env.VERCEL_REGION || null, started_at: BOOT_AT },
    vercel_env: process.env.VERCEL_ENV || null, db_mode: process.env.DB_MODE ? String(process.env.DB_MODE).slice(0, 20) : null, hints: hints(CONFIG.diag) }),
  resolveConfig,
  dbMissing: () => !supabase && String(process.env.DB_MODE || '').toLowerCase() !== 'mock' &&
    (process.env.VERCEL_ENV === 'production' || process.env.REQUIRE_DB === '1'),
  // Đợt 10: kho ảnh (Supabase Storage) cho admin tải poster / banner / ảnh rạp; null khi chạy bộ nhớ trong
  storage: () => (supabase ? supabase.storage : null),
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
    if (table === 'day_closings' && mem.day_closings.some(x => x.id === r.id)) {
      const e = new Error('duplicate key day_closings'); e.code = '23505'; throw e;
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
