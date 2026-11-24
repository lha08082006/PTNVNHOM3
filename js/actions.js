// js/actions.js - Trình nghe sự kiện chung thay cho thuộc tính on*= (onclick, onchange...).
// CSP của web không còn 'unsafe-inline' trong script-src: trình duyệt chặn mọi <script> viết thẳng trong HTML
// và mọi thuộc tính sự kiện viết thẳng (onclick, onchange, onerror...). Thay vào đó viết:
//
//   <button data-on-click="openOrder('BT123')">          gọi hàm của trang khi bấm
//   <form data-on-submit="event.preventDefault(); saveMovie()">
//   <input data-on-input="renderAudit()">  <select data-on-change="loadInvoices(this.value)">
//   <a href="#" data-on-click="openCustomer('KH1'); return false">
//   <img src="poster.jpg" data-fallback="images/logo.png">   ảnh lỗi -> đổi ảnh (hoặc "hide" / "none" / "badge")
//
// Giá trị của data-on-* KHÔNG phải JavaScript tùy ý (không eval): chỉ là chuỗi lời gọi hàm cách nhau bởi dấu ;
//   - tên hàm của trang: foo(...) hoặc Doi.tuong.ham(...) – tìm trên window; không gọi được hàm có sẵn của
//     trình duyệt (trừ print, location.reload, history.back)
//   - tham số: chuỗi '...' / "...", số, true/false/null/undefined, mảng [...], đối tượng { khoa: giatri },
//     this, this.value, this.checked, this.dataset.ma..., event, event.key...
//   - event.preventDefault() / event.stopPropagation() / return false
// Hàm khai báo bằng const/let ở trang không nằm trên window -> gán thêm window.tenHam = tenHam.
// Cần viết phức tạp hơn (gán biến, if...) thì tạo một hàm có tên trong js/<trang>.js rồi gọi hàm đó.
(function (root) {
  'use strict';

  var EVENTS = ['click', 'dblclick', 'change', 'input', 'submit', 'keydown', 'keyup'];
  var NATIVE_OK = { 'print': 1, 'location.reload': 1, 'history.back': 1 };
  var EVENT_METHODS = { preventDefault: 1, stopPropagation: 1, stopImmediatePropagation: 1 };
  var BAD_NAMES = { __proto__: 1, prototype: 1, constructor: 1 };

  // ---- Đọc chuỗi lệnh -> danh sách lệnh đã phân tích ----
  function tokenize(src) {
    var out = [], i = 0, n = src.length, m;
    while (i < n) {
      var c = src.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        var s = '', j = i + 1;
        for (;;) {
          if (j >= n) throw new SyntaxError('thiếu dấu đóng chuỗi');
          var d = src.charAt(j);
          if (d === c) break;
          if (d === '\n') throw new SyntaxError('chuỗi xuống dòng');
          if (d === '\\') {
            var e = src.charAt(j + 1);
            if (e === 'n') s += '\n';
            else if (e === 't') s += '\t';
            else if (e === 'r') s += '\r';
            else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.substr(j + 2, 4))) { s += String.fromCharCode(parseInt(src.substr(j + 2, 4), 16)); j += 4; }
            else if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(src.substr(j + 2, 2))) { s += String.fromCharCode(parseInt(src.substr(j + 2, 2), 16)); j += 2; }
            else s += e;
            j += 2;
            continue;
          }
          s += d; j++;
        }
        out.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      if ((m = /^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i)))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ('(){}[],.;:-'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      throw new SyntaxError('không hỗ trợ ký tự "' + c + '" (chỉ được gọi hàm, không gán / so sánh)');
    }
    out.push({ t: 'end' });
    return out;
  }

  function parse(src) {
    var toks = tokenize(String(src)), p = 0;
    var peek = function () { return toks[p]; };
    var take = function (t) {
      var k = toks[p];
      if (t && k.t !== t) throw new SyntaxError('cần "' + t + '" nhưng gặp ' + (k.v !== undefined ? '"' + k.v + '"' : '"' + k.t + '"'));
      p++;
      return k;
    };
    var name = function () {
      var v = take('id').v;
      if (BAD_NAMES[v]) throw new SyntaxError('tên không hợp lệ: ' + v);
      return v;
    };
    function path() {
      var parts = [name()];
      while (peek().t === '.') { take('.'); parts.push(name()); }
      return parts;
    }
    function value() {
      var k = peek();
      if (k.t === 'str' || k.t === 'num') { p++; return { lit: k.v }; }
      if (k.t === '-') { take('-'); return { lit: -take('num').v }; }
      if (k.t === '[') {
        take('[');
        var items = [];
        while (peek().t !== ']') { items.push(value()); if (peek().t !== ']') take(','); }
        take(']');
        return { arr: items };
      }
      if (k.t === '{') {
        take('{');
        var props = [];
        while (peek().t !== '}') {
          var key = peek().t === 'str' ? take('str').v : name();
          take(':');
          props.push([key, value()]);
          if (peek().t !== '}') take(',');
        }
        take('}');
        return { obj: props };
      }
      if (k.t === 'id') {
        if (k.v === 'true' || k.v === 'false') { p++; return { lit: k.v === 'true' }; }
        if (k.v === 'null') { p++; return { lit: null }; }
        if (k.v === 'undefined') { p++; return { lit: undefined }; }
        if (k.v === 'this' || k.v === 'event') { var ref = path(); return { ref: ref }; }
      }
      throw new SyntaxError('tham số chỉ được là chuỗi, số, true/false/null, [...], {...}, this... hoặc event...');
    }
    var prog = [];
    while (peek().t !== 'end') {
      if (peek().t === ';') { take(';'); continue; }
      if (peek().t === 'id' && peek().v === 'return') {
        take('id');
        var r = take('id');
        if (r.v !== 'false') throw new SyntaxError('chỉ hỗ trợ "return false"');
        prog.push({ ret: true });
      } else {
        var fn = path(), args = [];
        if (fn[0] === 'this') throw new SyntaxError('không gọi hàm của this; viết một hàm có tên trong js/<trang>.js');
        if (fn[0] === 'event' && !(fn.length === 2 && EVENT_METHODS[fn[1]])) throw new SyntaxError('chỉ hỗ trợ event.preventDefault() / event.stopPropagation()');
        take('(');
        while (peek().t !== ')') { args.push(value()); if (peek().t !== ')') take(','); }
        take(')');
        prog.push({ call: fn, args: args });
      }
      if (peek().t !== 'end') take(';');
    }
    return prog;
  }

  var cache = Object.create(null);
  function compile(src) {
    var k = String(src);
    if (!(k in cache)) {
      try { cache[k] = parse(k); } catch (e) { cache[k] = e; }
    }
    if (cache[k] instanceof Error) throw new SyntaxError('data-on-*="' + k + '": ' + cache[k].message);
    return cache[k];
  }

  // ---- Thực thi ----
  var isNative = function (fn) {
    try { return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn)); } catch (e) { return true; }
  };
  function lookup(parts) {
    var start = parts[0] === 'window' ? 1 : 0, owner, cur = root;
    if (start >= parts.length) return {};
    for (var i = start; i < parts.length; i++) {
      owner = cur;
      cur = cur == null ? undefined : cur[parts[i]];
    }
    return { fn: cur, owner: parts.length - start > 1 ? owner : undefined, name: parts.slice(start).join('.') };
  }
  function evalValue(v, el, ev) {
    if ('lit' in v) return v.lit;
    if (v.arr) return v.arr.map(function (x) { return evalValue(x, el, ev); });
    if (v.obj) {
      var o = {};
      v.obj.forEach(function (kv) { o[kv[0]] = evalValue(kv[1], el, ev); });
      return o;
    }
    var cur = v.ref[0] === 'this' ? el : ev;
    for (var i = 1; i < v.ref.length; i++) cur = cur == null ? undefined : cur[v.ref[i]];
    return cur;
  }
  function run(prog, el, ev) {
    for (var i = 0; i < prog.length; i++) {
      var st = prog[i];
      if (st.ret) { ev.preventDefault(); return false; }
      if (st.call[0] === 'event') { ev[st.call[1]](); continue; }
      var f = lookup(st.call);
      if (typeof f.fn !== 'function') throw new ReferenceError(st.call.join('.') + ' is not defined (data-on-' + ev.type + ')');
      if (isNative(f.fn) && !NATIVE_OK[f.name]) throw new TypeError('data-on-' + ev.type + ': không gọi hàm có sẵn của trình duyệt "' + f.name + '"');
      var args = st.args.map(function (a) { return evalValue(a, el, ev); });
      f.fn.apply(f.owner, args);
    }
  }

  function handle(ev) {
    var el = ev.currentTarget;
    var code = el.getAttribute('data-on-' + ev.type);
    if (code == null || !/\S/.test(code)) return;
    return run(compile(code), el, ev);
  }

  // ---- Ảnh lỗi: data-fallback="<ảnh khác>" | "hide" | "none" | "badge" ----
  function fallback(img) {
    if (img.hasAttribute('data-fallback-done')) return;
    img.setAttribute('data-fallback-done', '');
    var f = img.getAttribute('data-fallback') || '';
    var cls = img.getAttribute('data-fallback-class');
    if (f === 'hide') { img.style.visibility = 'hidden'; return; }
    if (f === 'none') { img.style.display = 'none'; return; }
    if (f === 'badge') {
      // Ảnh nhãn độ tuổi lỗi -> hiện nhãn chữ
      var span = document.createElement('span');
      span.className = cls || 'badge';
      span.textContent = img.getAttribute('data-fallback-text') || img.alt || '';
      img.replaceWith(span);
      return;
    }
    if (cls != null) img.className = cls;
    if (f) img.src = f;
  }

  // ---- Gắn trình nghe vào phần tử (cả phần tử do JS thêm sau bằng innerHTML) ----
  var SELECTOR = EVENTS.map(function (e) { return '[data-on-' + e + ']'; }).join(',');
  var bound = typeof WeakMap === 'function' ? new WeakMap() : null;
  function bind(el) {
    var done = bound.get(el);
    if (!done) bound.set(el, (done = {}));
    for (var i = 0; i < EVENTS.length; i++) {
      var t = EVENTS[i];
      if (!done[t] && el.hasAttribute('data-on-' + t)) { done[t] = true; el.addEventListener(t, handle); }
    }
  }
  function brokenImg(img) {
    // Ảnh đã hỏng trước khi vào trang (vd. tạo bằng innerHTML lúc chưa gắn vào trang) -> không còn sự kiện error để bắt.
    // currentSrc rỗng = ảnh lazy chưa tải, không phải ảnh hỏng.
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) fallback(img);
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches(SELECTOR)) bind(node);
    var list = node.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) bind(list[i]);
    if (node.tagName === 'IMG' && node.hasAttribute('data-fallback')) brokenImg(node);
    var imgs = node.querySelectorAll('img[data-fallback]');
    for (var j = 0; j < imgs.length; j++) brokenImg(imgs[j]);
  }

  // Kiểm tra (dùng trong tools/page-test.js): mọi data-on-* trên trang đọc được và gọi tới hàm có thật
  function check(scope) {
    var probs = [];
    var list = (scope || document).querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) {
      for (var k = 0; k < EVENTS.length; k++) {
        var code = list[i].getAttribute('data-on-' + EVENTS[k]);
        if (code == null) continue;
        try {
          compile(code).forEach(function (st) {
            if (!st.call || st.call[0] === 'event') return;
            var f = lookup(st.call);
            if (typeof f.fn !== 'function') probs.push('data-on-' + EVENTS[k] + '="' + code + '": chưa có hàm ' + st.call.join('.'));
            else if (isNative(f.fn) && !NATIVE_OK[f.name]) probs.push('data-on-' + EVENTS[k] + '="' + code + '": không gọi được hàm có sẵn ' + f.name);
          });
        } catch (e) { probs.push(e.message); }
      }
    }
    return probs;
  }

  var api = { parse: parse, compile: compile, check: check, events: EVENTS.slice() };
  if (typeof module === 'object' && module.exports) module.exports = api; // node: tools kiểm tra cú pháp
  if (typeof document === 'undefined' || !bound) return;
  root.BetaActions = api;

  document.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) fallback(t);
  }, true);
  scan(document.documentElement);
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') { bind(r.target); continue; }
      for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: EVENTS.map(function (e) { return 'data-on-' + e; })
  });
})(typeof window !== 'undefined' ? window : this);
