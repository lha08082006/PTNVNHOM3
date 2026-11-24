// js/thue-rap.js - mã của thue-rap.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DESC = {
    PRIVATE_SHOW: 'Cả phòng chiếu cho riêng bạn: sinh nhật, cầu hôn, họp lớp, xem phim cùng công ty.',
    GROUP: 'Từ 20 người trở lên, giá ưu đãi theo số lượng, ngồi cùng khu vực.',
    EVENT: 'Hội nghị, ra mắt phim / sản phẩm, đào tạo với màn hình lớn và âm thanh rạp.',
    ADS: 'Quảng cáo trước suất chiếu, standee, sampling tại sảnh rạp.'
  };
  const params = new URLSearchParams(location.search);
  // Ngày sớm nhất: hôm nay (giờ VN)
  $('ev-date').min = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  try {
    const [k, cn, mv] = await Promise.all([Pay.call('events?action=kinds'), Pay.catalog('cinemas'), Pay.catalog('movies')]);
    $('kinds').innerHTML = Object.entries(k.kinds).map(([id, label]) => `<div class="kind"><b>${esc(label)}</b><p>${esc(DESC[id] || '')}</p></div>`).join('');
    $('ev-kind').innerHTML = Object.entries(k.kinds).map(([id, label]) => `<option value="${id}" ${params.get('kind') === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
    $('ev-cinema').innerHTML += (cn.cinemas || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name + (c.city ? ' (' + c.city + ')' : ''))}</option>`).join('');
    $('ev-movie').innerHTML += (mv.movies || []).filter((m) => m.status !== 'HIDDEN').map((m) => `<option value="${esc(m.key)}">${esc(m.title)}</option>`).join('');
  } catch (e) { $('ev-msg').textContent = 'Không tải được dữ liệu. Vui lòng tải lại trang.'; }

  // Giới hạn giống máy chủ: đặt trước tối đa 12 tháng, giờ 08:00 – 23:00, ghi chú tối đa 1.000 ký tự
  (function () {
    const vnToday = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const max = new Date(vnToday + 'T00:00:00Z'); max.setUTCMonth(max.getUTCMonth() + 12);
    $('ev-date').min = vnToday; $('ev-date').max = max.toISOString().slice(0, 10);
    const cnt = () => { $('ev-note-count').textContent = $('ev-note').value.length + '/1000 ký tự'; };
    $('ev-note').addEventListener('input', cnt); cnt();
  })();
  $('ev-form').onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('ev-msg');
    // Form đặt novalidate để tự hiện lỗi đẹp hơn – vẫn dùng kiểm tra có sẵn của trình duyệt trước khi gọi máy chủ
    if (!$('ev-form').reportValidity()) return;
    $('ev-submit').disabled = true;
    try {
      const r = await Pay.post('events', {
        kind: $('ev-kind').value, cinema_id: $('ev-cinema').value, date: $('ev-date').value, time: $('ev-time').value,
        guests: $('ev-guests').value, movie_id: $('ev-movie').value, contact_name: $('ev-name').value, phone: $('ev-phone').value,
        email: $('ev-email').value, company: $('ev-company').value, note: $('ev-note').value
      });
      msg.style.color = '#15803d';
      msg.innerHTML = '✓ Đã gửi yêu cầu <b>' + esc(r.request.code) + '</b>. Ghi lại mã này để tra cứu; CSKH sẽ gọi cho bạn trong 1 ngày làm việc.';
      $('lk-code').value = r.request.code; $('lk-phone').value = $('ev-phone').value;
      $('ev-note').value = '';
    } catch (err) {
      msg.style.color = '#b91c1c';
      msg.textContent = err.message;
    } finally { $('ev-submit').disabled = false; }
  };

  $('lk-form').onsubmit = async (e) => {
    e.preventDefault();
    const out = $('lk-out');
    try {
      const r = (await Pay.call('events?code=' + encodeURIComponent($('lk-code').value.trim()) + '&phone=' + encodeURIComponent($('lk-phone').value.trim()))).request;
      out.style.color = '#0f172a';
      out.innerHTML = `<div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-top: 10px; line-height: 1.6;">
            <b>${esc(r.code)}</b> · ${esc(r.kind_label)}<br>Trạng thái: <b style="color: #005198;">${esc(r.status_label)}</b><br>
            ${r.cinema ? esc(r.cinema) + ' · ' : ''}${r.date ? esc(r.date.split('-').reverse().join('/')) : ''} ${esc(r.time || '')} · ${r.guests} khách
            ${r.quote_amount ? `<br>Báo giá: <b>${Pay.vnd(r.quote_amount)}</b>${r.quote_note ? '<br><span style="color:#475569">' + esc(r.quote_note) + '</span>' : ''}` : ''}</div>`;
    } catch (err) { out.style.color = '#b91c1c'; out.textContent = err.message; }
  };
})();
