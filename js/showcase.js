// js/showcase.js - mã của showcase.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
function setPreviewUrl(url) {
  document.getElementById('preview-frame').src = url;
}
