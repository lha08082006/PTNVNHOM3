/**
 * js/showtimes.js - Nguồn dữ liệu suất chiếu dùng chung (lịch chiếu, đặt vé, chi tiết phim, chọn ghế)
 *
 * Chưa có database nên suất chiếu được SINH TỰ ĐỘNG nhưng CỐ ĐỊNH theo (phim, rạp, ngày):
 * mở lại bao nhiêu lần cũng ra cùng kết quả. Khi có database chỉ cần thay các hàm
 * forDay() / seatStatus() bằng lệnh gọi API, các trang không phải sửa.
 *
 * Cần nạp sau js/pay-client.js (dùng Pay.MOVIES, Pay.getLocalOrders).
 */
(function () {
  // Phim đang chiếu / sắp chiếu (ngày khởi chiếu dạng dd/mm/yyyy)
  const NOW_SHOWING = ['linh-gioi-dai-chien', 'quy-an-tang-4', 'trai-buon-nguoi', 'blue-lock',
    'an-mang-karaoke', 'ut-lan-2', 'suzume', 'ca-voi-nuot-chung'];
  const COMING_SOON = { 'me-min': '28/11/2026', 'shaun-the-sheep': '05/12/2026' };
  // Phim có suất 3D IMAX (mục "Suất chiếu đặc biệt" ở trang chủ)
  const SPECIAL = ['linh-gioi-dai-chien', 'suzume'];

  const TIME_GRID = ['08:45', '09:30', '10:15', '11:00', '12:15', '13:15', '14:45', '15:45', '16:30',
    '17:45', '18:30', '19:15', '19:45', '20:30', '21:15', '22:15', '23:00', '23:30'];

  // Sơ đồ phòng chiếu (khớp seats.html): A-G mỗi hàng 10 ghế, H là 4 ghế đôi
  const SEAT_IDS = [];
  'ABCDEFG'.split('').forEach(r => { for (let i = 1; i <= 10; i++) SEAT_IDS.push(r + i); });
  ['H1-H2', 'H3-H4', 'H5-H6', 'H7-H8'].forEach(id => SEAT_IDS.push(id));

  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const pad = n => (n < 10 ? '0' : '') + n;

  // ---- Bộ sinh số ngẫu nhiên có hạt giống (cùng chuỗi -> cùng dãy số) ----
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hash(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Ngày ----
  function dateTag(d) { return `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; }

  // "T5 19/11" -> Date (năm hiện tại, hoặc năm sau nếu đã qua lâu)
  function parseTag(tag) {
    const m = String(tag || '').match(/(\d{1,2})\/(\d{1,2})/);
    const now = new Date();
    if (!m) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let d = new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[1]));
    if (now - d > 180 * 864e5) d = new Date(now.getFullYear() + 1, Number(m[2]) - 1, Number(m[1]));
    return d;
  }

  function parseRelease(s) {
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  }

  function upcomingDates(count) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < (count || 7); i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({ tag: dateTag(d), day: pad(d.getDate()), month: pad(d.getMonth() + 1), dow: DOW[d.getDay()], isToday: i === 0, date: d });
    }
    return out;
  }

  function canonicalCinema(cinema) {
    const list = (window.Layout && Layout.CINEMAS) || [];
    const hit = list.find(c => String(cinema || '').indexOf(c[0]) === 0);
    return hit ? hit[0] : (cinema || 'Beta Thanh Xuân');
  }

  function movieStatus(movieKey) {
    if (NOW_SHOWING.indexOf(movieKey) >= 0) return { status: 'now' };
    if (COMING_SOON[movieKey]) return { status: 'soon', release: COMING_SOON[movieKey] };
    return { status: 'none' };
  }

  // ---- Ghế ----
  function showKey(movieKey, cinema, tag, time) {
    return [movieKey, canonicalCinema(cinema), tag, time].join('|');
  }

  // Ghế đã bán trong các đơn đã thanh toán trên trình duyệt này
  function paidSeats(key) {
    const out = new Set();
    if (!window.Pay || !Pay.getLocalOrders) return out;
    Object.values(Pay.getLocalOrders()).forEach(o => {
      if (o.status !== 'PAID') return;
      if (showKey(o.movie_key, o.cinema, o.show_date, o.show_time) !== key) return;
      (Array.isArray(o.seats) ? o.seats : String(o.seats || '').split(',')).forEach(s => {
        s = String(s).trim();
        if (s) out.add(s);
      });
    });
    return out;
  }

  /**
   * Trạng thái ghế của một suất: { sold: Set, held: Set, available: số ghế trống, total }
   * fillRatio: tỉ lệ ghế đã bán sẵn (0..1), mặc định sinh theo suất
   */
  function seatStatus(movieKey, cinema, tag, time) {
    const key = showKey(movieKey, cinema, tag, time);
    const r = rng('seats|' + key);
    const ratio = 0.08 + r() * 0.5;
    const sold = new Set();
    const held = new Set();
    SEAT_IDS.forEach(id => {
      const x = r();
      if (x < ratio) sold.add(id);
      else if (x < ratio + 0.02) held.add(id);
    });
    paidSeats(key).forEach(id => { sold.add(id); held.delete(id); });
    return { sold, held, total: SEAT_IDS.length, available: SEAT_IDS.length - sold.size - held.size };
  }

  // ---- Suất chiếu ----
  /**
   * Các suất của một phim tại một rạp trong một ngày.
   * Trả về [{ time, format, room, total, available, late, past }]
   */
  function forDay(movieKey, cinema, tag) {
    const st = movieStatus(movieKey);
    if (st.status === 'none') return [];
    const day = parseTag(tag);
    if (st.status === 'soon' && day < parseRelease(st.release)) return [];

    const c = canonicalCinema(cinema);
    const r = rng(['show', movieKey, c, tag].join('|'));
    const count = 5 + Math.floor(r() * 4);
    const times = TIME_GRID.slice().sort(() => r() - 0.5).slice(0, count).sort();
    const movie = (window.Pay && Pay.MOVIES[movieKey]) || {};
    const baseFormat = /Lồng/i.test(movie.format || '') ? '2D Lồng tiếng' : '2D Phụ đề';

    const now = new Date();
    const isToday = day.toDateString() === now.toDateString();
    const nowHM = pad(now.getHours()) + ':' + pad(now.getMinutes());

    return times.map((time, i) => {
      const imax = SPECIAL.indexOf(movieKey) >= 0 && i >= times.length - 2;
      const seats = seatStatus(movieKey, c, tag, time);
      return {
        time,
        format: imax ? '3D IMAX' : baseFormat,
        room: imax ? 'Phòng IMAX' : 'Phòng 0' + (1 + Math.floor(r() * 5)),
        total: seats.total,
        available: seats.available,
        late: time >= '22:00',
        past: isToday && time <= nowHM
      };
    });
  }

  // Tất cả phim có suất tại rạp trong ngày (cho trang lịch chiếu)
  function moviesOn(cinema, tag) {
    return NOW_SHOWING.concat(Object.keys(COMING_SOON))
      .map(key => ({ key, slots: forDay(key, cinema, tag) }))
      .filter(m => m.slots.length);
  }

  window.Showtimes = {
    NOW_SHOWING, COMING_SOON, SEAT_IDS,
    upcomingDates, dateTag, parseTag, movieStatus,
    forDay, moviesOn, seatStatus, showKey, canonicalCinema
  };
})();
