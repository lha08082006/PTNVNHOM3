// lib/schema-check.js - Đợt 10d/10f: tự kiểm tra database thật có đủ MỌI bảng / cột trong schema.sql chưa.
// Danh sách cột sinh sẵn ở lib/schema-columns.js (tools/gen-schema-columns.js). Mỗi bảng hỏi Supabase 0 dòng với
// đủ các cột; bảng nào báo lỗi mới dò từng cột để biết thiếu cột nào và file migration nào tạo ra cột đó.
// Chỉ trả TÊN bảng / cột và mã lỗi – không đọc dữ liệu, không lộ khóa.
const Store = require('./store');
const { COLUMNS, FILES, ORIGIN } = require('./schema-columns');

const TTL = 60 * 1000;
let cache = null;

const fileOf = (table, col) => {
  const i = (ORIGIN[table] || {})[col];
  return i == null ? 'schema.sql' : FILES[i];
};

async function run() {
  if (!Store.isLive()) return { ok: true, mode: 'mock', missing: [] };
  const byFile = {};
  const push = (file, item) => { (byFile[file] = byFile[file] || []).push(item); };
  let other = null;
  const noteOther = (table, r) => { if (!other) other = { table, code: r.code || null, message: r.message }; };

  await Promise.all(Object.entries(COLUMNS).map(async ([table, cols]) => {
    const all = await Store.probe(table, cols.join(','));
    if (all.ok) return;
    if (all.kind !== 'missing') return noteOther(table, all);
    const first = await Store.probe(table, cols[0]);
    if (!first.ok && first.kind === 'missing') return push(fileOf(table, cols[0]), table); // thiếu cả bảng
    if (!first.ok) return noteOther(table, first);
    const each = await Promise.all(cols.slice(1).map(async c => [c, await Store.probe(table, c)]));
    const miss = {};
    for (const [c, r] of each) {
      if (r.ok) continue;
      if (r.kind === 'missing') (miss[fileOf(table, c)] = miss[fileOf(table, c)] || []).push(c);
      else noteOther(table, r);
    }
    for (const [file, cs] of Object.entries(miss)) push(file, table + '(' + cs.join(',') + ')');
  }));

  const missing = Object.keys(byFile).sort().map(file => ({ file, items: byFile[file].sort() }));
  let bucket = null;
  try { bucket = await Store.bucketExists(process.env.MEDIA_BUCKET || 'media'); } catch (e) { bucket = null; }
  const out = { ok: !missing.length && !other, mode: 'live', missing, media_bucket: bucket, tables: Object.keys(COLUMNS).length, checked_at: new Date().toISOString() };
  if (other) out.other_error = other;
  if (missing.length) {
    out.hint = 'Database thiếu bảng / cột của ' + missing.length + ' file migration. Mở Supabase (đúng dự án trong SUPABASE_URL) > SQL Editor, chạy các file trên theo thứ tự' +
      ' (file gộp migrations/GOP-dot-2-den-dot-10.sql đã gồm từ 2026-11-24). Nếu chắc chắn đã chạy thành công mà vẫn báo thiếu, chạy thêm: notify pgrst, \'reload schema\';';
  }
  return out;
}

// fresh=true bỏ qua bộ nhớ đệm (dùng sau khi vừa chạy migration)
async function check({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.value;
  const value = await run();
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { check, _reset: () => { cache = null; } };
