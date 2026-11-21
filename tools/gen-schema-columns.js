// tools/gen-schema-columns.js - Sinh lib/schema-columns.js từ schema.sql (Đợt 10f).
// Danh sách MỌI bảng / cột mà code dùng, kèm file migration tạo ra từng cột, để web thật tự dò database
// thiếu cột nào (không chỉ vài "dấu hiệu"). Chạy lại mỗi khi sửa schema.sql: node tools/gen-schema-columns.js
// (kiểm thử smoke-test báo lỗi nếu quên chạy).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const TYPE = /^\s+([a-z_][a-z0-9_]*)\s+(text|uuid|int|integer|bigint|smallint|boolean|bool|timestamptz|timestamp|jsonb|json|numeric|date|real|double precision|serial|bigserial|time)\b/i;
const SKIP = new Set(['primary', 'unique', 'constraint', 'check', 'foreign', 'exclude']);

// { table: [col, …] } theo thứ tự khai báo
function parse(sql) {
  const out = {};
  const add = (t, c) => { if (SKIP.has(c)) return; (out[t] = out[t] || []); if (!out[t].includes(c)) out[t].push(c); };
  const src = sql.replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');
  const re = /create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = re.exec(src))) {
    // Tách theo dấu phẩy ở mức ngoài cùng (bỏ qua dấu phẩy trong check (...), default (...)) – có file khai báo nhiều cột trên một dòng
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of m[2]) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) { const c = ('\n  ' + p.trim()).match(TYPE); if (c) add(m[1].toLowerCase(), c[1].toLowerCase()); }
  }
  // Một lệnh alter table có thể thêm nhiều cột: "alter table x add column a …, add column b …;"
  const alt = /alter table (?:if exists )?(?:only )?(?:public\.)?([a-z_][a-z0-9_]*)\s+([^;]*);/gi;
  while ((m = alt.exec(src))) {
    const each = /add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi;
    let c;
    while ((c = each.exec(m[2]))) add(m[1].toLowerCase(), c[1].toLowerCase());
  }
  return out;
}

function build() {
  const schema = parse(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  // Cột nào do file migration nào tạo (file đầu tiên nhắc tới)
  const origin = {};
  const files = fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => /^\d{4}-\d{2}-\d{2}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const cols = parse(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
    for (const [t, cs] of Object.entries(cols)) for (const c of cs) { const k = t + '.' + c; if (!origin[k]) origin[k] = f; }
  }
  const tables = Object.keys(schema).sort();
  const lines = tables.map(t => '  ' + t + ': [' + schema[t].map(c => "'" + c + "'").join(', ') + '],');
  const fileIdx = [...new Set(Object.values(origin))].sort();
  const orig = tables.map(t => '  ' + t + ': {' + schema[t].filter(c => origin[t + '.' + c]).map(c => c + ': ' + fileIdx.indexOf(origin[t + '.' + c])).join(', ') + '},');
  return '// lib/schema-columns.js - TỰ SINH bởi tools/gen-schema-columns.js từ schema.sql – đừng sửa tay.\n' +
    '// COLUMNS: mọi bảng / cột trong schema.sql. ORIGIN: cột -> chỉ số trong FILES (file migration tạo ra cột đó).\n' +
    'const COLUMNS = {\n' + lines.join('\n') + '\n};\n' +
    'const FILES = [\n' + fileIdx.map(f => "  '" + f + "',").join('\n') + '\n];\n' +
    'const ORIGIN = {\n' + orig.join('\n') + '\n};\n' +
    'module.exports = { COLUMNS, FILES, ORIGIN };\n';
}

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'lib', 'schema-columns.js'), build());
  const { COLUMNS } = require('../lib/schema-columns');
  console.log('lib/schema-columns.js:', Object.keys(COLUMNS).length, 'bảng,', Object.values(COLUMNS).reduce((n, c) => n + c.length, 0), 'cột');
}
module.exports = { build, parse };
