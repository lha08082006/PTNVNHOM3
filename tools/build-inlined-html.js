// build-inlined-html.js
// Tự động gộp toàn bộ CSS vào trong từng file HTML để tạo file độc lập (Self-contained)
// Giúp upload lên Figma hoặc các plugin HTML-to-Figma hiển thị chuẩn 100% không bị mất CSS.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'inlined-mockups');
const CSS_PATH = path.join(ROOT_DIR, 'css', 'prototype-theme.css');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const cssContent = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf-8') : '';

const htmlFiles = fs.readdirSync(ROOT_DIR).filter(file => 
  file.endsWith('.html') && file !== 'mockup-hub.html'
);

console.log(`Bắt đầu đóng gói ${htmlFiles.length} file HTML...`);

htmlFiles.forEach(file => {
  const filePath = path.join(ROOT_DIR, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // 1. Nhúng nội dung CSS vào thay thế cho thẻ link css/prototype-theme.css
  const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']css\/prototype-theme\.css["'][^>]*>/gi;
  if (linkRegex.test(content)) {
    content = content.replace(linkRegex, `\n<!-- INLINED PROTOTYPE THEME CSS -->\n<style>\n${cssContent}\n</style>\n`);
  } else {
    // Nếu không khớp regex chính xác, chèn trước </head>
    content = content.replace('</head>', `\n<style>\n${cssContent}\n</style>\n</head>`);
  }

  // 2. Chuyển đổi đường dẫn ảnh tương đối thành đường dẫn HTTP localhost hoặc giữ nguyên
  // để khi plugin Figma nạp thì không bị mất ảnh
  // Ví dụ: href="images/..." hoặc src="images/..." -> src="http://localhost:3000/images/..."
  content = content.replace(/(src|href)=["']images\//gi, '$1="http://localhost:3000/images/');
  content = content.replace(/(src|href)=["']assets\//gi, '$1="http://localhost:3000/assets/');

  const outputPath = path.join(OUTPUT_DIR, file);
  fs.writeFileSync(outputPath, content, 'utf-8');
});

console.log(`Đã đóng gói thành công ${htmlFiles.length} file vào thư mục: inlined-mockups/`);
