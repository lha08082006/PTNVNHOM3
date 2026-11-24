// lang.js - Song ngữ Việt / Anh cho trang khách (Đợt 4)
// Đặt trong <head> (chạy sớm để không nháy chữ tiếng Việt). Mặc định tiếng Việt; khách bấm nút EN/VI
// hoặc mở trang với ?lang=en. Lựa chọn lưu ở localStorage (BETA_LANG).
// Cách dịch: từ điển i18n/en.json ánh xạ CÂU tiếng Việt đang hiển thị -> tiếng Anh, kèm vài mẫu (regex) cho
// câu có số / mã ghế. Trang không phải sửa HTML: chữ do JavaScript vẽ thêm sau (lịch chiếu, thông báo lỗi
// từ máy chủ…) cũng được dịch nhờ MutationObserver. Câu chưa có trong từ điển giữ nguyên tiếng Việt.
// Không dịch: tên phim, tóm tắt, tên rạp, tin tức (dữ liệu) và phần tử có thuộc tính data-no-i18n.
(function () {
  if (typeof window === 'undefined' || window.BetaI18n) return;
  var KEY = 'BETA_LANG';
  var store = function (v) { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return null; } };
  var q = (location.search.match(/[?&]lang=(vi|en)\b/) || [])[1];
  if (q) store(q);
  var lang = q || store() || 'vi';
  if (lang !== 'en') lang = 'vi';

  var dict = {}, patterns = [];
  var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };

  function lookup(s) {
    if (Object.prototype.hasOwnProperty.call(dict, s)) return dict[s];
    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i][0]);
      if (!m) continue;
      var r = patterns[i][1]
        .replace(/\{(\d)\}/g, function (_, k) { var g = m[k] || ''; return Object.prototype.hasOwnProperty.call(dict, g) ? dict[g] : (segments(g) || g); })
        .replace(/\$(\d)/g, function (_, k) { return m[k] || ''; });
      if (r === s) continue; // mẫu không đổi được chữ nào (vd. dữ liệu có dấu phẩy) – coi như không khớp
      return r;
    }
    return null;
  }
  // "A · B · C": dịch từng phần (phần là dữ liệu – tên rạp, mã đơn – giữ nguyên)
  function segments(s) {
    var sep = s.indexOf(' · ') > -1 ? ' · ' : s.indexOf(' • ') > -1 ? ' • ' : null;
    if (!sep) return null;
    var changed = false;
    var out = s.split(sep).map(function (p) { var t = lookup(p.trim()); if (t != null) { changed = true; return t; } return p; });
    return changed ? out.join(sep) : null;
  }
  function translate(text) {
    var n = norm(text);
    if (!n || !/[^\d\s.,:;!?()+\-–—/%đ₫]/.test(n)) return null;
    var t = lookup(n);
    if (t == null) t = segments(n);
    if (t == null) return null;
    return (text.match(/^\s*/)[0]) + t + (text.match(/\s*$/)[0]);
  }

  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE)$/;
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var busy = false;
  function skipEl(el) { return !el || SKIP.test(el.tagName) || (el.closest && el.closest('[data-no-i18n],[contenteditable="true"]')); }
  // Ô nhập nhiều dòng: không dịch chữ khách gõ bên trong, nhưng vẫn dịch placeholder / aria-label / title
  function attrsOnly(el) { return el && el.tagName === 'TEXTAREA' && !(el.closest && el.closest('[data-no-i18n],[contenteditable="true"]')); }
  function doNode(node) {
    if (node.nodeType === 3) {
      if (skipEl(node.parentElement)) return;
      var t = translate(node.nodeValue);
      if (t != null && t !== node.nodeValue) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1) return;
    if (skipEl(node)) { if (attrsOnly(node)) doAttrs(node); return; }
    for (var i = 0; i < ATTRS.length; i++) {
      var v = node.getAttribute(ATTRS[i]);
      if (v) { var tv = translate(v); if (tv != null && tv !== v) node.setAttribute(ATTRS[i], tv); }
    }
    if (node.tagName === 'INPUT' && /^(button|submit)$/i.test(node.type) && node.value) { var tb = translate(node.value); if (tb != null) node.value = tb; }
    if (node.tagName === 'OPTION') { var to = translate(node.textContent); if (to != null && to !== node.textContent) node.textContent = to; return; }
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var cur = w.nextNode();
    while (cur) { if (cur !== node) { if (cur.nodeType === 1) { if (skipEl(cur)) { if (attrsOnly(cur)) doAttrs(cur); cur = nextSkip(w, cur); continue; } doAttrs(cur); } else doNode(cur); } cur = w.nextNode(); }
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) { var v = el.getAttribute(ATTRS[i]); if (v) { var t = translate(v); if (t != null && t !== v) el.setAttribute(ATTRS[i], t); } }
    if (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type) && el.value) { var tb = translate(el.value); if (tb != null) el.value = tb; }
  }
  function nextSkip(w, el) { var n = w.nextSibling(); while (!n && w.parentNode()) n = w.nextSibling(); return n; }
  function run(root) { busy = true; try { doNode(root); var tt = translate(document.title); if (tt && tt !== document.title) document.title = tt; } finally { busy = false; } }

  // Nút có sẵn trong HTML (#lang-toggle, đặt ở thanh trên cùng – không làm xô lệch bố cục);
  // trang nào chưa có thì tạo thêm vào thanh điều hướng.
  function mountToggle() {
    var b = document.getElementById('lang-toggle');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.id = 'lang-toggle'; b.className = 'lang-toggle'; b.setAttribute('data-no-i18n', '');
      b.style.cssText = 'margin-left:10px;border:1.5px solid currentColor;background:transparent;color:inherit;border-radius:999px;padding:0 10px;font:700 12px/22px inherit;cursor:pointer;height:24px';
      var slot = document.querySelector('.top-header-inner > div') || document.querySelector('header nav') || document.querySelector('header .in');
      if (slot) slot.appendChild(b);
      else { b.style.cssText += ';position:fixed;top:10px;right:12px;z-index:9991;background:#fff;color:#005198'; document.body.appendChild(b); }
    }
    b.textContent = lang === 'en' ? 'VI' : 'EN';
    b.setAttribute('aria-label', lang === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English');
    b.title = b.getAttribute('aria-label');
    b.onclick = function () { store(lang === 'en' ? 'vi' : 'en'); location.href = location.href.replace(/([?&])lang=(vi|en)&?/, '$1').replace(/[?&]$/, ''); };
  }

  window.BetaI18n = {
    lang: lang,
    t: function (s) { return lang === 'en' ? (translate(String(s)) || s) : s; },
    set: function (l) { store(l === 'en' ? 'en' : 'vi'); location.reload(); }
  };

  var ready = function (fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); };
  ready(mountToggle);
  if (lang !== 'en') return;

  document.documentElement.lang = 'en';
  // Ẩn tạm thân trang tới khi dịch xong (tối đa 1,5 giây) để không nháy tiếng Việt
  var st = document.createElement('style');
  st.id = 'i18n-pending';
  st.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(st);
  var reveal = function () { var s = document.getElementById('i18n-pending'); if (s) s.remove(); };
  setTimeout(reveal, 1500);

  // Hộp thoại alert / confirm / prompt cũng dịch
  ['alert', 'confirm', 'prompt'].forEach(function (k) {
    var orig = window[k];
    window[k] = function (msg) { var a = Array.prototype.slice.call(arguments); a[0] = translate(String(msg == null ? '' : msg)) || msg; return orig.apply(window, a); };
  });

  // Từ điển do trình duyệt / service worker lưu đệm (HTTP), luôn lấy bản mới khi có mạng
  var load = function () { return fetch('/i18n/en.json').then(function (r) { return r.json(); }); };
  load().then(function (j) {
    dict = j.strings || {};
    patterns = (j.patterns || []).map(function (p) { return [new RegExp(p[0]), p[1]]; });
    ready(function () {
      run(document.body);
      reveal();
      new MutationObserver(function (list) {
        if (busy) return;
        busy = true;
        try {
          for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.type === 'characterData') doNode(m.target);
            else if (m.type === 'attributes') doAttrs(m.target);
            else for (var k = 0; k < m.addedNodes.length; k++) doNode(m.addedNodes[k]);
          }
          var tt = translate(document.title); if (tt && tt !== document.title) document.title = tt;
        } finally { busy = false; }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    });
  }).catch(reveal);
})();
