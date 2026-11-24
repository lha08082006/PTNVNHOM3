// catalog.js - Danh mục DÙNG CHUNG cho trình duyệt và máy chủ: phim, rạp, giá ghế, combo, voucher.
// Máy chủ (lib/flow.js) tính lại tổng tiền từ chính file này, nên giá trên giao diện và giá
// khách phải trả luôn khớp nhau, và trình duyệt không thể tự sửa số tiền đơn hàng.
// Đổi giá / thêm phim: sửa file này rồi deploy lại.
(function (root, factory) {
  const C = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  if (typeof window !== 'undefined') root.BetaCatalog = C;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MOVIES = {
    'an-mang-karaoke': {
      title: 'ÁN MẠNG KARAOKE', shortTitle: 'Án Mạng Karaoke', age: 'T16',
      meta: 'Trinh thám, Hài hước, Bí ẩn · 96 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/an-mang-karaoke-kc-30-10-2026-kt-chuan-114723-300926-76.webp',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'linh-gioi-dai-chien': {
      title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ', shortTitle: 'Linh Giới Đại Chiến', age: 'T18',
      meta: 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt',
      poster: 'images/400x633-145627-230926-40.jpg',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'quy-an-tang-4': {
      title: 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI', shortTitle: 'Quỷ Ăn Tạng 4', age: 'T18',
      meta: 'Kinh dị, Bí ẩn, Giật gân · 115 phút · Tiếng Thái - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.webp',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'trai-buon-nguoi': {
      title: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI', shortTitle: 'Trại Buôn Người', age: 'T16',
      meta: 'Tâm lý, Tội phạm, Gay cấn · 118 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/media_images_2026_09_15_official-poster-trai-buon-nguoi-final-142318-150926-62.webp',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'blue-lock': {
      title: 'BLUE LOCK: THE MOVIE - EPISODE NAGI', shortTitle: 'Blue Lock: Episode Nagi', age: 'P',
      meta: 'Hoạt hình, Thể thao, Anime · 95 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_28_091026-blue-lock-170502-280926-25.webp',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'ut-lan-2': {
      title: 'ÚT LAN 2', shortTitle: 'Út Lan 2', age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/ul2-main-dam-hoi-digital-094550-140926-42.webp',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'suzume': {
      title: 'KHÓA CHẶT CỬA NÀO SUZUME', shortTitle: 'Suzume No Tojimari', age: 'P',
      meta: 'Hoạt hình, Giả tưởng, Anime · 121 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/poster-khoa-chat-cua-nao-suzum-1-092028-280926-82.webp',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'ca-voi-nuot-chung': {
      title: 'CÁ VOI NUỐT CHỬNG', shortTitle: 'Cá Voi Nuốt Chửng', age: 'T13',
      meta: 'Sinh tồn, Hành động, Viễn tưởng · 98 phút · Tiếng Anh - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_21_ca-voi-nuot-chung-091717-210926-56.webp',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'me-min': {
      title: 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI', shortTitle: 'Mẹ Mìn', age: 'T18',
      meta: 'Kinh dị, Tâm lý, Giật gân · 105 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/me-min-teaser-poster-dkkc-23102026-132757-170926-76.webp',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'shaun-the-sheep': {
      title: 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH', shortTitle: 'Shaun The Sheep', age: 'P',
      meta: 'Hoạt hình, Phiêu lưu, Hài hước · 86 phút · Không thoại - Bản quyền Aardman',
      poster: 'images/media_images_2026_10_05_161026-shaun-the-sheep-152403-051026-14.webp',
      format: '2D Lồng Tiếng', badge: '2D LỒNG TIẾNG'
    }
  };
  // Mã phim cũ còn nằm trong các liên kết đã chia sẻ -> trỏ về phim tương ứng
  const MOVIE_ALIASES = { 'dia-dao': 'linh-gioi-dai-chien', 'co-dau-hao-mon': 'ut-lan-2' };
  for (const [alias, key] of Object.entries(MOVIE_ALIASES)) MOVIES[alias] = MOVIES[key];

  const CINEMAS = [
    'Beta Thanh Xuân', 'Beta Trần Quang Khải', 'Beta Giải Phóng', 'Beta Mỹ Đình',
    'Beta Quang Trung', 'Beta Ung Văn Khiêm', 'Beta Thái Nguyên', 'Beta Bắc Giang', 'Beta Nha Trang'
  ];

  // Sơ đồ phòng chiếu: A–E ghế thường, F–G ghế VIP, H ghế đôi (Sweetbox, mã dạng "H1-H2")
  const SEAT_PRICES = { standard: 45000, vip: 50000, sweetbox: 100000 };
  const SEAT_LABEL = { standard: 'Ghế thường', vip: 'Ghế VIP', sweetbox: 'Ghế đôi Sweetbox' };

  // ---- Sơ đồ ghế theo phòng chiếu (Đợt 3) ----
  // layout = { rows: [{ r: 'A', type: 'standard'|'vip'|'sweetbox', n: số ghế (ghế đôi: số cặp), gaps: [vị trí lối đi sau ghế số], off: [ghế bỏ trống] }] }
  // Mã ghế: thường/VIP "A5"; ghế đôi cặp thứ k của hàng H: "H{2k-1}-H{2k}".
  // Dạng chữ để Quản lý sửa nhanh: mỗi dòng "A standard 10 gap 5 off 1,10".
  const ROW_TYPES = ['standard', 'vip', 'sweetbox'];
  const DEFAULT_LAYOUT = {
    rows: 'ABCDE'.split('').map(r => ({ r, type: 'standard', n: 10, gaps: [5], off: [] }))
      .concat('FG'.split('').map(r => ({ r, type: 'vip', n: 10, gaps: [5], off: [] })))
      .concat([{ r: 'H', type: 'sweetbox', n: 4, gaps: [2], off: [] }])
  };
  const ints = (a) => (Array.isArray(a) ? a : String(a || '').split(/[\s,;]+/)).map(Number).filter(x => Number.isInteger(x) && x > 0);
  // Chuẩn hóa + kiểm tra sơ đồ (dùng khi Quản lý lưu phòng và khi đọc từ database)
  function normLayout(l) {
    const rows = (l && Array.isArray(l.rows) ? l.rows : []).map(x => ({
      r: String(x.r || '').trim().toUpperCase(), type: String(x.type || 'standard').toLowerCase(),
      n: Math.round(Number(x.n) || 0), gaps: [...new Set(ints(x.gaps))].sort((a, b) => a - b), off: [...new Set(ints(x.off))].sort((a, b) => a - b)
    }));
    if (!rows.length) throw err('Sơ đồ phải có ít nhất một hàng ghế');
    if (rows.length > 26) throw err('Tối đa 26 hàng ghế');
    const seen = new Set();
    for (const x of rows) {
      if (!/^[A-Z]$/.test(x.r)) throw err('Tên hàng phải là một chữ cái A–Z');
      if (seen.has(x.r)) throw err('Hàng ' + x.r + ' bị trùng');
      seen.add(x.r);
      if (!ROW_TYPES.includes(x.type)) throw err('Hàng ' + x.r + ': loại ghế phải là standard, vip hoặc sweetbox');
      const max = x.type === 'sweetbox' ? 15 : 30;
      if (!(x.n >= 1 && x.n <= max)) throw err('Hàng ' + x.r + ': số ghế phải từ 1 đến ' + max);
      x.gaps = x.gaps.filter(g => g < x.n);
      x.off = x.off.filter(o => o <= x.n);
    }
    if (!seatsOf({ rows }).length) throw err('Sơ đồ không còn ghế nào để bán');
    return { rows };
  }
  const pairId = (r, k) => r + (2 * k - 1) + '-' + r + (2 * k);
  // Danh sách ghế bán được của sơ đồ, theo thứ tự hàng / số ghế
  function seatsOf(layout) {
    const out = [];
    for (const x of (layout || DEFAULT_LAYOUT).rows) {
      for (let k = 1; k <= x.n; k++) {
        if ((x.off || []).includes(k)) continue;
        out.push({ id: x.type === 'sweetbox' ? pairId(x.r, k) : x.r + k, type: x.type, row: x.r, k });
      }
    }
    return out;
  }
  const _maps = new WeakMap();
  function seatType(id, layout) {
    const L = layout || DEFAULT_LAYOUT;
    let m = _maps.get(L);
    if (!m) { m = new Map(seatsOf(L).map(s => [s.id, s.type])); _maps.set(L, m); }
    return m.get(String(id || '').trim().toUpperCase()) || null;
  }
  function layoutToText(layout) {
    return (layout || DEFAULT_LAYOUT).rows.map(x => [x.r, x.type, x.n].concat(x.gaps && x.gaps.length ? ['gap', x.gaps.join(',')] : [], x.off && x.off.length ? ['off', x.off.join(',')] : []).join(' ')).join('\n');
  }
  function layoutFromText(text) {
    const rows = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map((line) => {
      const t = line.split(/\s+/);
      const row = { r: t[0], type: t[1], n: t[2], gaps: [], off: [] };
      for (let i = 3; i < t.length; i += 2) {
        const key = String(t[i]).toLowerCase();
        if (key === 'gap') row.gaps = t[i + 1];
        else if (key === 'off') row.off = t[i + 1];
        else throw err('Dòng "' + line + '": chỉ dùng "gap" hoặc "off"');
      }
      return row;
    });
    return normLayout({ rows });
  }

  // Combo bắp nước: tên, mô tả, ảnh dùng chung cho trang Combo, Thanh toán, Giá vé và máy chủ
  const COMBOS = {
    solo:    { name: 'Combo Solo', price: 69000, desc: '01 bắp ngọt lớn + 01 nước ngọt lớn (Coca / Sprite / Fanta).', img: 'images/combo.webp', badge: 'Tiết kiệm' },
    couple:  { name: 'Combo Couple', price: 89000, desc: '01 bắp lớn vị phô mai hoặc caramel + 02 nước ngọt lớn. Hợp cho 2 người.', img: 'images/combosieucu-1702x621-115549-081026-63.webp', badge: 'Bán chạy nhất' },
    party:   { name: 'Combo Party Gold', price: 129000, desc: '02 bắp lớn + 03 nước ngọt lớn + 01 snack. Hợp cho nhóm 3 người.', img: 'images/combo.webp' },
    family:  { name: 'Combo Siêu Nhóm (Family)', price: 139000, desc: '02 bắp lớn + 04 nước ngọt lớn. Hợp cho nhóm 4 người hoặc gia đình.', img: 'images/combosieucu-1702x621-115549-081026-63.webp' },
    sausage: { name: 'Xúc Xích Nướng Phô Mai', price: 25000, desc: '01 que xúc xích nướng phô mai, sốt mù tạt mật ong.', img: 'images/combo.webp' }
  };
  const MAX_COMBO_QTY = 10;

  // Beta Club – điểm thưởng & hạng thành viên (Đợt 2). Hạng xét theo tổng chi tiêu 365 ngày gần nhất.
  //   ticket / fnb: % tiền thực trả được quy ra điểm cho vé / bắp nước. 1 điểm = 1.000 đ khi dùng để trả tiền.
  const LOYALTY = {
    POINT_VALUE: 1000,
    MAX_SHARE: 0.5,          // điểm trả tối đa 50% giá trị đơn (sau voucher)
    EXPIRE_MONTHS: 12,       // điểm hết hạn sau 12 tháng
    BIRTHDAY_POINTS: 50,     // quà sinh nhật: 50 điểm (= 50.000 đ), dùng trong 60 ngày
    BIRTHDAY_DAYS: 60,
    TIERS: [
      { id: 'MEMBER', label: 'Thành viên', min: 0, ticket: 5, fnb: 3 },
      { id: 'VIP', label: 'VIP', min: 2000000, ticket: 7, fnb: 4 },
      { id: 'VVIP', label: 'VVIP', min: 4000000, ticket: 10, fnb: 5 }
    ]
  };
  const tierOf = (spend) => LOYALTY.TIERS.filter(t => (spend || 0) >= t.min).pop();
  // Số điểm tối đa được dùng cho một đơn có giá trị `amount` (sau voucher)
  const maxPointsFor = (amount) => Math.max(0, Math.floor((amount || 0) * LOYALTY.MAX_SHARE / LOYALTY.POINT_VALUE));
  const MAX_SEATS = 8;

  // Voucher giảm thẳng vào tổng đơn (không giảm quá tổng)
  // Voucher: kind AMOUNT (giảm số tiền) | PERCENT (giảm %, có trần max_discount) | PER_SEAT (giảm mỗi ghế)
  // Điều kiện: min_total (đơn tối thiểu, tính trước giảm), need_combo (phải mua kèm bắp nước),
  // weekdays (chỉ suất chiếu vào các thứ này, 0 = Chủ nhật). Máy chủ lấy bản trong database.
  // Danh sách mã voucher KHÔNG để ở đây (file này trình duyệt tải về, ai cũng đọc được): máy chủ đọc trong database,
  // dữ liệu chạy thử nằm ở lib/catalog-db.js (SEED_VOUCHERS).
  const VOUCHERS = {};
  const DOW_NAME = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
  const vndText = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';

  // Tính tiền giảm của một voucher cho đơn; không đạt điều kiện thì báo lỗi (http 400) nói rõ vì sao
  function voucherDiscount(code, v, { base = 0, combo_total = 0, seat_count = 0, show_dow = null } = {}) {
    if (v.min_total && base < Number(v.min_total)) throw err('Mã ' + code + ' áp dụng cho đơn từ ' + vndText(v.min_total) + ' (đơn hiện tại ' + vndText(base) + ').');
    if (v.need_combo && !(combo_total > 0)) throw err('Mã ' + code + ' chỉ áp dụng khi mua kèm bắp nước.');
    const days = Array.isArray(v.weekdays) ? v.weekdays.map(Number) : [];
    if (days.length && show_dow != null && !days.includes(Number(show_dow))) {
      throw err('Mã ' + code + ' chỉ áp dụng cho suất chiếu vào ' + days.map(d => DOW_NAME[d]).join(', ') + '.');
    }
    const kind = String(v.kind || 'AMOUNT').toUpperCase();
    let d = kind === 'PERCENT' ? Math.round(base * (Number(v.percent) || 0) / 100)
      : kind === 'PER_SEAT' ? (Number(v.discount) || 0) * seat_count
      : (Number(v.discount) || 0);
    if (Number(v.max_discount) > 0) d = Math.min(d, Number(v.max_discount));
    return Math.max(0, Math.min(d, base));
  }

  // Loại vé theo đối tượng: giảm thẳng vào giá ghế (không áp dụng cho ghế đôi Sweetbox).
  // Giá trị mặc định; máy chủ lấy bảng loại vé đang áp dụng trong database (admin > Danh mục > Bảng giá).
  const TICKET_TYPES = {
    ADULT:   { label: 'Người lớn', off: 0, note: '' },
    STUDENT: { label: 'HSSV / U22', off: 10000, note: 'Xuất trình thẻ học sinh, sinh viên hoặc CCCD (dưới 22 tuổi) khi soát vé' },
    CHILD:   { label: 'Trẻ em', off: 15000, note: 'Dưới 13 tuổi hoặc cao dưới 1m30; phim phải phù hợp độ tuổi' },
    SENIOR:  { label: 'Người cao tuổi', off: 15000, note: 'Từ 60 tuổi, xuất trình CCCD khi soát vé' }
  };

  const err = (msg) => Object.assign(new Error(msg), { http: 400 });

  // Toàn bộ ghế của phòng chiếu (dùng để đếm ghế trống)
  const SEAT_IDS = seatsOf(DEFAULT_LAYOUT).map(s => s.id);

  // Tính tiền một đơn. Ném lỗi (http 400) nếu ghế/combo/voucher không hợp lệ.
  //   prices   : giá ghế của suất chiếu (mặc định SEAT_PRICES)
  //   vouchers : danh sách voucher hợp lệ (mặc định VOUCHERS; máy chủ truyền voucher đã kiểm tra trong DB)
  //   ticket_types : số vé theo loại, vd { STUDENT: 1, CHILD: 1 } (phần còn lại là Người lớn)
  //   types        : bảng loại vé đang áp dụng (mặc định TICKET_TYPES)
  //   show_dow     : thứ trong tuần của suất chiếu (để kiểm tra voucher chỉ áp dụng vài thứ)
  //   points       : số điểm Beta Club khách muốn dùng (máy chủ đã kiểm tra số dư)
  //   fnb          : đơn chỉ mua bắp nước (không có ghế)
  function quote({ seats = [], combos = {}, voucher = null, prices = SEAT_PRICES, vouchers = VOUCHERS, ticket_types = {}, types = TICKET_TYPES, show_dow = null, points = 0, fnb = false, layout = null } = {}) {
    prices = { ...SEAT_PRICES, ...(prices || {}) };
    const list = fnb ? [] : (Array.isArray(seats) ? seats : String(seats).split(','))
      .map(s => String(s).trim().toUpperCase()).filter(Boolean);
    if (!list.length && !fnb) throw err('Chưa chọn ghế');
    if (list.length > MAX_SEATS) throw err(`Mỗi đơn tối đa ${MAX_SEATS} ghế`);
    if (new Set(list).size !== list.length) throw err('Danh sách ghế bị trùng');
    const seatLines = list.map(id => {
      const type = seatType(id, layout);
      if (!type) throw err('Ghế không tồn tại: ' + id);
      return { id, type, price: prices[type] };
    });
    // Gán loại vé ưu đãi cho các ghế thường/VIP (ghế đắt hơn được gán trước, kết quả không phụ thuộc thứ tự chọn)
    const want = [];
    for (const [code, raw] of Object.entries(ticket_types || {})) {
      const n = Number(raw);
      if (!n || code === 'ADULT') continue;
      if (!types[code]) throw err('Loại vé không tồn tại: ' + code);
      if (!Number.isInteger(n) || n < 0) throw err('Số lượng loại vé không hợp lệ');
      for (let i = 0; i < n; i++) want.push(code);
    }
    const eligible = seatLines.filter(x => x.type !== 'sweetbox').sort((a, b) => b.price - a.price || (a.id < b.id ? -1 : 1));
    if (want.length > eligible.length) throw err('Số vé ưu đãi (' + want.length + ') nhiều hơn số ghế thường/VIP đã chọn (' + eligible.length + '). Ghế đôi Sweetbox không áp dụng vé ưu đãi.');
    want.sort((a, b) => (types[b].off || 0) - (types[a].off || 0));
    seatLines.forEach(x => { x.ticket_type = x.type === 'sweetbox' ? 'COUPLE' : 'ADULT'; x.base_price = x.price; });
    want.forEach((code, i) => {
      const x = eligible[i];
      x.ticket_type = code;
      x.price = Math.max(0, x.base_price - (Number(types[code].off) || 0));
    });
    const type_discount = seatLines.reduce((s, x) => s + (x.base_price - x.price), 0);
    const type_counts = {};
    seatLines.forEach(x => { if (x.ticket_type !== 'ADULT' && x.ticket_type !== 'COUPLE') type_counts[x.ticket_type] = (type_counts[x.ticket_type] || 0) + 1; });
    const seat_total = seatLines.reduce((s, x) => s + x.price, 0);

    const comboLines = [];
    for (const [key, raw] of Object.entries(combos || {})) {
      const qty = Number(raw);
      if (!qty) continue;
      if (!COMBOS[key]) throw err('Combo không tồn tại: ' + key);
      if (!Number.isInteger(qty) || qty < 0 || qty > MAX_COMBO_QTY) throw err('Số lượng combo không hợp lệ');
      comboLines.push({ key, name: COMBOS[key].name, qty, price: COMBOS[key].price, amount: qty * COMBOS[key].price });
    }
    const combo_total = comboLines.reduce((s, x) => s + x.amount, 0);
    if (fnb && !combo_total) throw err('Chưa chọn món bắp nước');

    const code = voucher ? String(voucher).trim().toUpperCase() : null;
    if (code && !(vouchers || {})[code]) throw err('Mã giảm giá không hợp lệ hoặc đã hết lượt dùng');
    const discount = code ? voucherDiscount(code, vouchers[code], { base: seat_total + combo_total, combo_total, seat_count: seatLines.length, show_dow }) : 0;

    const after = seat_total + combo_total - discount;
    const want_points = Math.max(0, Math.floor(Number(points) || 0));
    if (want_points > maxPointsFor(after)) throw err('Điểm dùng tối đa ' + maxPointsFor(after) + ' điểm cho đơn này (không quá ' + Math.round(LOYALTY.MAX_SHARE * 100) + '% giá trị đơn).');
    const points_discount = want_points * LOYALTY.POINT_VALUE;
    return {
      seats: seatLines, combos: comboLines, voucher: code, ticket_types: type_counts, type_discount,
      seat_total, combo_total, discount, points_used: want_points, points_discount, total: after - points_discount
    };
  }

  function getMovie(key) {
    const k = String(key || '').trim().toLowerCase();
    return MOVIES[k] || null;
  }

  return { DEFAULT_LAYOUT, normLayout, seatsOf, layoutToText, layoutFromText, LOYALTY, tierOf, maxPointsFor, voucherDiscount, MOVIES, MOVIE_ALIASES, CINEMAS, SEAT_IDS, SEAT_PRICES, SEAT_LABEL, TICKET_TYPES, seatType, COMBOS, VOUCHERS, MAX_SEATS, MAX_COMBO_QTY, quote, getMovie };
});
