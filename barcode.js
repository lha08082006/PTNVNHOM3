// barcode.js - Mã vạch Code 128 cho vé (thay mã QR). Tự viết, không cần thư viện ngoài, chạy được khi mất mạng.
//   BetaBarcode.svg(text, { height })        -> chuỗi <svg> (vạch đen trên nền trắng, có vùng trống 2 bên)
//   BetaBarcode.draw(ctx, text, x, y, w, h)  -> vẽ lên canvas (lưu vé thành ảnh)
//   BetaBarcode.modules(text)                -> mảng độ rộng vạch / khoảng trắng (đơn vị module)
// Tự chọn bộ mã: chữ ở bộ B, dãy chữ số dài ở bộ C (2 chữ số / ký hiệu) để mã ngắn, dễ quét trên màn hình điện thoại.
(function (root) {
  const P = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
  ];
  const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;
  const isDigit = (c) => c >= '0' && c <= '9';
  const digitRun = (s, i) => { let n = 0; while (i + n < s.length && isDigit(s[i + n])) n++; return n; };

  // Chuỗi -> các giá trị ký hiệu (gồm start, checksum, stop)
  function symbols(text) {
    const s = String(text == null ? '' : text);
    if (!s.length) throw new Error('Mã vạch rỗng');
    for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error('Mã vạch chỉ nhận ký tự ASCII in được'); }
    const out = [];
    let set, i = 0;
    const first = digitRun(s, 0);
    if (first >= 4 && first % 2 === 0) { set = 'C'; out.push(START_C); } else { set = 'B'; out.push(START_B); }
    while (i < s.length) {
      if (set === 'C') {
        if (digitRun(s, i) >= 2) { out.push(Number(s.substr(i, 2))); i += 2; continue; }
        set = 'B'; out.push(CODE_B); continue;
      }
      const run = digitRun(s, i);
      // Chuyển sang bộ C khi gặp dãy >= 4 chữ số (số chẵn chữ số; lẻ thì in 1 chữ số ở bộ B trước)
      if (run >= 4) {
        if (run % 2 === 1) { out.push(s.charCodeAt(i) - 32); i++; }
        set = 'C'; out.push(CODE_C); continue;
      }
      out.push(s.charCodeAt(i) - 32); i++;
    }
    let sum = out[0];
    for (let k = 1; k < out.length; k++) sum += out[k] * k;
    out.push(sum % 103, STOP);
    return out;
  }

  // Độ rộng xen kẽ vạch / trắng, bắt đầu bằng vạch
  function modules(text) {
    const w = [];
    for (const v of symbols(text)) for (const d of P[v]) w.push(Number(d));
    return w;
  }

  const QUIET = 10; // vùng trống mỗi bên (module) để máy quét bắt được đầu / cuối mã

  function svg(text, { height = 72 } = {}) {
    const w = modules(text);
    const total = w.reduce((a, b) => a + b, 0) + QUIET * 2;
    let x = QUIET, bars = '';
    w.forEach((n, k) => { if (k % 2 === 0) bars += `M${x} 0h${n}v${height}h-${n}z`; x += n; });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" width="100%" height="${height}" aria-hidden="true">` +
      `<rect width="${total}" height="${height}" fill="#fff"/><path d="${bars}" fill="#000"/></svg>`;
  }

  // Vẽ lên canvas, mỗi module là số nguyên điểm ảnh để vạch sắc nét
  function draw(ctx, text, x, y, maxW, h) {
    const w = modules(text);
    const total = w.reduce((a, b) => a + b, 0) + QUIET * 2;
    const m = Math.max(1, Math.floor(maxW / total));
    const left = Math.round(x + (maxW - total * m) / 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(left, y, total * m, h);
    ctx.fillStyle = '#000';
    let cx = left + QUIET * m;
    w.forEach((n, k) => { if (k % 2 === 0) ctx.fillRect(cx, y, n * m, h); cx += n * m; });
    return { width: total * m, module: m };
  }

  const api = { svg, draw, modules, symbols };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BetaBarcode = api;
})(typeof window !== 'undefined' ? window : this);
