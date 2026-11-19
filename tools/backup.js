// tools/backup.js - Sao lưu toàn bộ dữ liệu Supabase ra file JSON trên máy (Đợt 5)
// Chạy: đặt SUPABASE_URL, SUPABASE_SECRET_KEY trong .env rồi: npm run backup
// File lưu ở thư mục backups/ (đã bỏ qua trong git). File có dữ liệu khách hàng – cất ở nơi an toàn.
const fs = require('fs');
const path = require('path');
const Store = require('../lib/store');
const Ops = require('../lib/ops');

(async () => {
  if (!Store.isLive()) { console.error('Chưa cấu hình Supabase (SUPABASE_URL, SUPABASE_SECRET_KEY) – không có gì để sao lưu.'); process.exit(1); }
  const data = await Ops.backup();
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'beta-backup_' + data.created_at.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const counts = Object.entries(data.tables).map(([t, rows]) => t + ':' + (Array.isArray(rows) ? rows.length : 'lỗi')).join(' ');
  console.log('Đã lưu', file);
  console.log(counts);
})().catch(e => { console.error(e.message); process.exit(1); });
