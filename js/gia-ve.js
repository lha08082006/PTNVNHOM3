// js/gia-ve.js - mã của gia-ve.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(async () => {
  const C = window.BetaCatalog;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const vnd = (n) => Pay.vnd(n);

  const TYPES = [
    ['standard', '#fff; box-shadow: inset 0 0 0 1.5px #64748b', 'Hàng A – E. Ghế đơn tiêu chuẩn.'],
    ['vip', '#f59e0b', 'Hàng F – G. Vị trí trung tâm, góc nhìn đẹp nhất.'],
    ['sweetbox', '#ec4899', 'Hàng H. Ghế đôi cho 2 người, giá tính cho cả cặp.'],
  ];
  $('gv-cards').innerHTML = TYPES.map(([k, color, d]) =>
    `<div class="gv-card"><div class="t"><span class="sw" style="background:${color}"></span>${esc(C.SEAT_LABEL[k])}</div>` +
    `<div class="p">${vnd(C.SEAT_PRICES[k])}</div><div class="d">${esc(d)}</div></div>`).join('');
  $('gv-combos').innerHTML = Object.values(C.COMBOS).map((c) => `<div class="gv-combo"><b>${esc(c.name)}</b><span>${vnd(c.price)}</span></div>`).join('');
  $('gv-max-combo').textContent = C.MAX_COMBO_QTY;
  $('gv-max-seats').textContent = C.MAX_SEATS;

  // Bảng giá thật từ database: quy tắc theo ngày / khung giờ, ngày lễ, loại vé
  try {
    const pr = await Pay.pricing();
    const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const days = (r) => (r.holiday ? 'Ngày lễ' + (r.days.length ? ' + ' : '') : '') + (r.days.length === 7 ? 'Mọi ngày' : [1, 2, 3, 4, 5, 6, 0].filter(d => r.days.includes(d)).map(d => DOW[d]).join(', '));
    const hours = (r) => (r.start_time === '00:00' && r.end_time === '24:00') ? 'Cả ngày' : (r.start_time === '00:00' ? 'Trước ' + r.end_time : r.end_time === '24:00' ? 'Từ ' + r.start_time : r.start_time + ' – ' + r.end_time);
    const cell = (v) => v ? vnd(v) : '<span class="m">—</span>';
    $('gv-rules').innerHTML = (pr.rules || []).map(r => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(days(r))}</td><td>${esc(hours(r))}</td>
          <td class="num">${cell(r.price_standard)}</td><td class="num">${cell(r.price_vip)}</td><td class="num">${cell(r.price_sweetbox)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="m">Đang áp dụng giá niêm yết ở trên cho mọi suất.</td></tr>';
    $('gv-holidays').textContent = (pr.holidays || []).length ? 'Ngày lễ sắp tới: ' + pr.holidays.map(h => h.date.split('-').reverse().join('/') + ' (' + h.name + ')').join(', ') : '';
    const specialTypes = Object.entries(pr.ticket_types || {}).filter(([k]) => k !== 'ADULT' && k !== 'COUPLE');
    // Máy chủ chưa bật loại vé ưu đãi nào: nói rõ, không để mục trống gây hiểu nhầm là đang có ưu đãi
    if (!specialTypes.length) { $('gv-types-sub').textContent = 'Hiện chưa áp dụng vé ưu đãi theo đối tượng (HSSV, trẻ em, người cao tuổi). Mọi vé tính theo giá niêm yết ở trên.'; }
    $('gv-types').innerHTML = specialTypes.map(([, t]) =>
      `<div class="gv-combo"><b>${esc(t.label)}</b><span>Giảm ${vnd(t.off)}</span>${t.note ? `<small class="m" style="display:block;font-size:12px;line-height:1.4;margin-top:4px;">${esc(t.note)}</small>` : ''}</div>`).join('');
  } catch (e) {
    $('gv-rules').innerHTML = '<tr><td colspan="6" class="m">Không tải được bảng giá. <button type="button" class="btn btn-outline btn-sm" data-on-click="location.reload()">Thử lại</button></td></tr>';
  }

  const range = (arr) => {
    const v = arr.filter((x) => x > 0);
    if (!v.length) return '—';
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? vnd(lo) : vnd(lo) + ' – ' + vnd(hi);
  };
  try {
    // Tóm tắt giá theo rạp do máy chủ tính sẵn (nhẹ, lưu đệm 5 phút) thay vì tải cả lịch 14 ngày
    const [cn, st] = await Promise.all([Pay.catalog('cinemas'), Pay.catalog('price_summary')]);
    const sum = Object.fromEntries((st.cinemas || []).map((x) => [x.cinema_id, x]));
    const rows = (cn.cinemas || []).map((c) => {
      const x = sum[c.id] || { count: 0 };
      const p = (k) => x[k] || [];
      return `<tr><td><strong>${esc(c.name)}</strong>${c.city ? '<div class="m" style="font-size:12.5px">' + esc(c.city) + '</div>' : ''}</td>` +
        `<td class="num">${range(p('standard'))}</td><td class="num">${range(p('vip'))}</td><td class="num">${range(p('sweetbox'))}</td>` +
        `<td>${x.count}</td><td>${x.count ? `<a href="schedule.html?cinema=${encodeURIComponent(c.id)}">Lịch chiếu →</a>` : '<span class="m">Chưa có suất</span>'}</td></tr>`;
    });
    $('gv-cinemas').innerHTML = rows.join('') || '<tr><td colspan="6" class="m">Chưa có rạp nào.</td></tr>';
  } catch (e) {
    $('gv-cinemas').innerHTML = '<tr><td colspan="6" class="m">Không tải được giá theo rạp. <button type="button" class="btn btn-outline btn-sm" data-on-click="location.reload()">Thử lại</button></td></tr>';
  }
})();
