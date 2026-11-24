// js/bap-nuoc.js - mã của bap-nuoc.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const C = BetaCatalog;
  const qty = {};
  let VDEF = null, HAVE = 0;

  const LOGGED = BetaAuth.isLoggedIn();
  $('items').innerHTML = Object.entries(C.COMBOS).map(([k, c]) => `
        <div class="item">
          <img src="${esc(c.img)}" alt="" loading="lazy" data-fallback="hide">
          <div><b>${esc(c.name)}</b><p>${esc(c.desc)}</p><div class="price">${Pay.vnd(c.price)}</div></div>
          <div class="qty" role="group" aria-label="Số lượng ${esc(c.name)}">
            <button type="button" data-k="${k}" data-d="-1" aria-label="Bớt ${esc(c.name)}">−</button><span id="q-${k}">0</span><button type="button" data-k="${k}" data-d="1" aria-label="Thêm ${esc(c.name)}">+</button>
          </div>
        </div>`).join('');
  // Đặt lại từ đơn cũ: ?combos={"solo":2}
  try {
    const pre = JSON.parse(new URLSearchParams(location.search).get('combos') || '{}');
    for (const [k, n] of Object.entries(pre)) if (C.COMBOS[k] && Number.isInteger(n) && n > 0) { qty[k] = Math.min(C.MAX_COMBO_QTY, n); $('q-' + k).textContent = qty[k]; }
  } catch (e) { /* tham số sai: bỏ qua */ }
  $('items').onclick = (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    qty[k] = Math.max(0, Math.min(C.MAX_COMBO_QTY, (qty[k] || 0) + Number(b.dataset.d)));
    $('q-' + k).textContent = qty[k];
    calc();
  };

  function calc() {
    const sub = Object.entries(qty).reduce((s, [k, n]) => s + C.COMBOS[k].price * n, 0);
    let disc = 0;
    $('bn-vmsg').textContent = '';
    if (VDEF && sub) {
      try { disc = C.voucherDiscount(VDEF.code, VDEF, { base: sub, combo_total: sub, seat_count: 0, show_dow: new Date(Date.now() + 7 * 3600e3).getUTCDay() }); $('bn-vmsg').textContent = '✓ Mã ' + VDEF.code + ': giảm ' + Pay.vnd(disc); $('bn-vmsg').style.color = '#15803d'; }
      catch (e) { $('bn-vmsg').textContent = e.message; $('bn-vmsg').style.color = '#b91c1c'; }
    }
    const after = Math.max(0, sub - disc);
    let pts = 0;
    if (HAVE > 0) {
      const cap = Math.min(HAVE, C.maxPointsFor(after));
      $('bn-phint').textContent = 'Tối đa ' + cap + ' điểm cho đơn này';
      $('bn-pinput').max = cap;
      if ($('bn-puse').checked) { pts = Math.floor(Number($('bn-pinput').value) || 0) || cap; pts = Math.max(0, Math.min(cap, pts)); $('bn-pinput').value = pts; }
    }
    $('bn-sub').textContent = Pay.vnd(sub);
    $('bn-drow').hidden = !disc; $('bn-disc').textContent = '-' + Pay.vnd(disc);
    $('bn-prow').hidden = !pts; $('bn-pts').textContent = '-' + Pay.vnd(pts * 1000) + ' (' + pts + ' điểm)';
    const total = after - pts * 1000;
    $('bn-total').textContent = Pay.vnd(total);
    $('bn-pay').disabled = !sub;
    return { sub, disc, pts, total };
  }
  $('bn-puse').onchange = calc;
  $('bn-pinput').oninput = calc;
  $('bn-vbtn').onclick = async () => {
    const code = $('bn-voucher').value.trim();
    if (!code) { VDEF = null; return calc(); }
    try { VDEF = (await Pay.catalog('voucher', { code })).voucher; calc(); }
    catch (e) { VDEF = null; calc(); $('bn-vmsg').textContent = e.message; $('bn-vmsg').style.color = '#b91c1c'; }
  };

  try {
    const cn = (await Pay.catalog('cinemas')).cinemas || [];
    let saved = null;
    try { saved = localStorage.getItem('BETA_CINEMA'); } catch (e) {}
    $('bn-cinema').innerHTML = cn.map((c) => `<option value="${esc(c.id)}" ${c.id === saved ? 'selected' : ''}>${esc(c.name + (c.city ? ' (' + c.city + ')' : ''))}</option>`).join('');
  } catch (e) { $('bn-msg').textContent = 'Không tải được danh sách rạp. Vui lòng thử lại.'; }
  if (LOGGED) {
    try {
      const p = await Pay.call('member?action=points');
      HAVE = p.balance || 0;
      if (HAVE > 0) { $('bn-points').hidden = false; $('bn-phave').textContent = HAVE.toLocaleString('vi-VN'); }
    } catch (e) { /* không có điểm */ }
  } else {
    $('bn-pay').innerHTML = '<i class="ph-user" aria-hidden="true"></i> Đăng nhập để thanh toán';
    $('bn-login-hint').hidden = false;
  }
  calc();

  $('bn-pay').onclick = async () => {
    const c = calc();
    const combos = Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0));
    // Chưa đăng nhập: giữ giỏ trong đường dẫn, đăng nhập xong quay lại đúng các món đã chọn
    if (!BetaAuth.isLoggedIn()) { location.href = BetaAuth.loginUrl('bap-nuoc.html?combos=' + encodeURIComponent(JSON.stringify(combos))); return; }
    $('bn-pay').disabled = true;
    $('bn-msg').textContent = '';
    try {
      await Pay.createOrderAndGo({ kind: 'FNB', cinema_id: $('bn-cinema').value, combos, voucher: c.disc ? VDEF.code : null, points: c.pts, total: c.total });
    } catch (e) {
      $('bn-msg').textContent = e.message;
      $('bn-pay').disabled = false;
    }
  };
})();
