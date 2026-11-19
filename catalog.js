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
      poster: 'images/an-mang-karaoke-kc-30-10-2026-kt-chuan-114723-300926-76.jpg',
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
      poster: 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.jpg',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'trai-buon-nguoi': {
      title: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI', shortTitle: 'Trại Buôn Người', age: 'T16',
      meta: 'Tâm lý, Tội phạm, Gay cấn · 118 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/media_images_2026_09_15_official-poster-trai-buon-nguoi-final-142318-150926-62.jpg',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'blue-lock': {
      title: 'BLUE LOCK: THE MOVIE - EPISODE NAGI', shortTitle: 'Blue Lock: Episode Nagi', age: 'P',
      meta: 'Hoạt hình, Thể thao, Anime · 95 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_28_091026-blue-lock-170502-280926-25.jpg',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'ut-lan-2': {
      title: 'ÚT LAN 2', shortTitle: 'Út Lan 2', age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/ul2-main-dam-hoi-digital-094550-140926-42.jpg',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'suzume': {
      title: 'KHÓA CHẶT CỬA NÀO SUZUME', shortTitle: 'Suzume No Tojimari', age: 'P',
      meta: 'Hoạt hình, Giả tưởng, Anime · 121 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/poster-khoa-chat-cua-nao-suzum-1-092028-280926-82.jpg',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'ca-voi-nuot-chung': {
      title: 'CÁ VOI NUỐT CHỬNG', shortTitle: 'Cá Voi Nuốt Chửng', age: 'T13',
      meta: 'Sinh tồn, Hành động, Viễn tưởng · 98 phút · Tiếng Anh - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_21_ca-voi-nuot-chung-091717-210926-56.jpg',
      format: '2D Phụ đề Tiếng Việt', badge: '2D PHỤ ĐỀ'
    },
    'me-min': {
      title: 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI', shortTitle: 'Mẹ Mìn', age: 'T18',
      meta: 'Kinh dị, Tâm lý, Giật gân · 105 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/me-min-teaser-poster-dkkc-23102026-132757-170926-76.jpg',
      format: '2D Phụ đề Tiếng Anh', badge: '2D PHỤ ĐỀ'
    },
    'shaun-the-sheep': {
      title: 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH', shortTitle: 'Shaun The Sheep', age: 'P',
      meta: 'Hoạt hình, Phiêu lưu, Hài hước · 86 phút · Không thoại - Bản quyền Aardman',
      poster: 'images/media_images_2026_10_05_161026-shaun-the-sheep-152403-051026-14.jpg',
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
  function seatType(id) {
    const s = String(id || '').trim().toUpperCase();
    let m = /^([A-G])(\d{1,2})$/.exec(s);
    if (m && +m[2] >= 1 && +m[2] <= 10) return m[1] <= 'E' ? 'standard' : 'vip';
    m = /^H(\d)-H(\d{1,2})$/.exec(s);
    if (m && +m[1] % 2 === 1 && +m[2] === +m[1] + 1 && +m[2] <= 8) return 'sweetbox';
    return null;
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
  const MAX_SEATS = 8;

  // Voucher giảm thẳng vào tổng đơn (không giảm quá tổng)
  const VOUCHERS = {
    BETAVIP: { discount: 20000, label: 'Giảm 20.000 đ cho thành viên' },
    ALPHA:   { discount: 20000, label: 'Giảm 20.000 đ' },
    CINEMA:  { discount: 20000, label: 'Giảm 20.000 đ' }
  };

  const err = (msg) => Object.assign(new Error(msg), { http: 400 });

  // Toàn bộ ghế của phòng chiếu (dùng để đếm ghế trống)
  const SEAT_IDS = [];
  for (const r of 'ABCDEFG') for (let n = 1; n <= 10; n++) SEAT_IDS.push(r + n);
  for (let n = 1; n <= 7; n += 2) SEAT_IDS.push(`H${n}-H${n + 1}`);

  // Tính tiền một đơn. Ném lỗi (http 400) nếu ghế/combo/voucher không hợp lệ.
  //   prices   : giá ghế của suất chiếu (mặc định SEAT_PRICES)
  //   vouchers : danh sách voucher hợp lệ (mặc định VOUCHERS; máy chủ truyền voucher đã kiểm tra trong DB)
  function quote({ seats = [], combos = {}, voucher = null, prices = SEAT_PRICES, vouchers = VOUCHERS } = {}) {
    prices = { ...SEAT_PRICES, ...(prices || {}) };
    const list = (Array.isArray(seats) ? seats : String(seats).split(','))
      .map(s => String(s).trim().toUpperCase()).filter(Boolean);
    if (!list.length) throw err('Chưa chọn ghế');
    if (list.length > MAX_SEATS) throw err(`Mỗi đơn tối đa ${MAX_SEATS} ghế`);
    if (new Set(list).size !== list.length) throw err('Danh sách ghế bị trùng');
    const seatLines = list.map(id => {
      const type = seatType(id);
      if (!type) throw err('Ghế không tồn tại: ' + id);
      return { id, type, price: prices[type] };
    });
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

    const code = voucher ? String(voucher).trim().toUpperCase() : null;
    if (code && !(vouchers || {})[code]) throw err('Mã giảm giá không hợp lệ hoặc đã hết lượt dùng');
    const discount = code ? Math.min(vouchers[code].discount, seat_total + combo_total) : 0;

    return {
      seats: seatLines, combos: comboLines, voucher: code,
      seat_total, combo_total, discount, total: seat_total + combo_total - discount
    };
  }

  function getMovie(key) {
    const k = String(key || '').trim().toLowerCase();
    return MOVIES[k] || null;
  }

  return { MOVIES, MOVIE_ALIASES, CINEMAS, SEAT_IDS, SEAT_PRICES, SEAT_LABEL, seatType, COMBOS, VOUCHERS, MAX_SEATS, MAX_COMBO_QTY, quote, getMovie };
});
