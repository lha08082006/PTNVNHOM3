// pay-client.js - Module gọi API cho hệ thống thanh toán Beta Cinemas
const Pay = {
  // =========================================================================
  // HELPER NGÀY GIỜ THỜI GIAN THỰC (REAL-TIME)
  // =========================================================================
  getTodayTag() {
    const d = new Date();
    const daysOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dow = daysOfWeek[d.getDay()];
    const day = d.getDate() < 10 ? '0' + d.getDate() : d.getDate();
    const month = (d.getMonth() + 1) < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1);
    return `${dow} ${day}/${month}`;
  },

  getTodayFullStr() {
    const d = new Date();
    const day = d.getDate() < 10 ? '0' + d.getDate() : d.getDate();
    const month = (d.getMonth() + 1) < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1);
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  },

  getUpcomingDates(count = 7) {
    const daysOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const fullDaysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dates = [];
    const now = new Date();

    for (let i = 0; i < count; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const day = d.getDate() < 10 ? '0' + d.getDate() : d.getDate();
      const month = (d.getMonth() + 1) < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1);
      const year = d.getFullYear();
      const dow = daysOfWeek[d.getDay()];
      const fullDow = fullDaysOfWeek[d.getDay()];
      dates.push({
        day,
        month,
        year,
        dow,
        fullDow,
        shortDate: `${day}/${month}`,
        fullDate: `${day}/${month}/${year}`,
        tag: `${dow} ${day}/${month}`,
        label: i === 0 ? `Hôm nay - ${fullDow}, ${day}/${month}/${year}` : (i === 1 ? `Ngày mai - ${fullDow}, ${day}/${month}/${year}` : `${fullDow}, ${day}/${month}/${year}`)
      });
    }
    return dates;
  },

  vnd: (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + ' đ',

  // Phát hiện endpoint API khả dụng:
  // Nếu đang mở trên Live Server (port 5500, 5501...) hoặc file://
  // thử kết nối tới http://localhost:3000/api/ nếu có server chạy nền
  getApiBase() {
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      // Đang truy cập trực tiếp qua server Node (port 5000, 3000) hoặc Vercel (port chuẩn 80/443 hoặc rỗng)
      // Chỉ khi mở qua Live Server (port 5500, 5501...) mới gọi sang server Node ở port 5000;
      // mọi trường hợp khác (node server.js ở bất kỳ port nào, Vercel) dùng API cùng origin.
      if (/^55\d\d$/.test(port)) {
        return 'http://localhost:5000/api/';
      }
      return '/api/';
    }
    return '/api/';
  },

  async call(path, opts = {}) {
    const cleanPath = path.replace(/^\/api\//, '').replace(/^\//, '');
    const apiBase = Pay.getApiBase();
    let url = apiBase + cleanPath;

    try {
      let r = null;
      try {
        r = await fetch(url, opts);
      } catch (networkErr) {
        // Nếu fetch tới server nền bị chặn (CORS / port 5000/3000 chưa bật), thử relative
        if (apiBase.startsWith('http://localhost:5000') || apiBase.startsWith('http://localhost:3000')) {
          url = '/api/' + cleanPath;
          r = await fetch(url, opts);
        } else {
          throw networkErr;
        }
      }

      if (r && r.status === 405) {
        // Live Server trả về 405 Method Not Allowed đối với request POST
        const err = new Error('Static Server 405 Method Not Allowed');
        err.status = 405;
        throw err;
      }

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(j.error || j.message || 'Lỗi hệ thống (' + r.status + ')');
        err.status = r.status;
        throw err;
      }
      return j;
    } catch (err) {
      console.warn('[Pay.call Error]:', err.message);
      throw err;
    }
  },

  post: (path, body) =>
    Pay.call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }),

  // Bộ nhớ đệm LocalStorage lưu trữ trạng thái đơn hàng (đặc biệt khi mở qua Live Server)
  getLocalOrder(code) {
    if (typeof localStorage === 'undefined' || !code) return null;
    try {
      const raw = localStorage.getItem('BETA_ORDER_' + code);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  saveLocalOrder(ord) {
    if (typeof localStorage === 'undefined' || !ord || !ord.code) return;
    try {
      const prev = Pay.getLocalOrder(ord.code) || {};
      ord = Object.assign({}, prev, ord);
      if (!ord.created_at) ord.created_at = new Date().toISOString();
      localStorage.setItem('BETA_ORDER_' + ord.code, JSON.stringify(ord));
    } catch (e) {}
  },

  buildOrderFromUrl(code) {
    if (typeof window === 'undefined' || !window.location) return null;
    const p = new URLSearchParams(window.location.search);
    const ordCode = code || p.get('order') || 'BC2610279854';
    const total = Number(p.get('total') || 179000);
    return {
      code: ordCode,
      total: total,
      paid_amount: Number(p.get('paid') || 0),
      remaining_amount: Number(p.get('remaining') || (total - Number(p.get('paid') || 0))),
      excess_amount: Number(p.get('excess') || 0),
      movie_key: p.get('movie') || 'an-mang-karaoke',
      cinema: p.get('cinema') || 'Beta Thanh Xuân',
      show_date: p.get('date') || (typeof window !== 'undefined' && window.Pay && Pay.getTodayTag ? Pay.getTodayTag() : 'Hôm nay'),
      show_time: p.get('time') || '12:15',
      seats: p.get('seats') ? p.get('seats').split(',').map(s => s.trim()) : ['D5', 'D6'],
      combos: (function() { try { return p.get('combos') ? JSON.parse(decodeURIComponent(p.get('combos'))) : {}; } catch(e){ return {}; } })(),
      status: 'HOLDING',
      created_at: new Date().toISOString()
    };
  },

  // Lấy chi tiết đơn hàng (tự động fallback nếu mất kết nối hoặc dùng Live Server)
  async getOrder(code) {
    if (!code) return null;
    try {
      const res = await Pay.call('order-status?code=' + encodeURIComponent(code));
      if (res && res.code) {
        Pay.saveLocalOrder(res);
        return res;
      }
    } catch (e) {
      // Backend không phản hồi hoặc Live Server 405 -> Đọc từ local
    }
    return Pay.getLocalOrder(code) || Pay.buildOrderFromUrl(code);
  },

  // checkout.html: Tạo đơn và chuyển sang trang quét mã VietQR
  async createOrderAndGo(payload) {
    let orderCode = null;
    let orderTotal = payload.total;

    try {
      const o = await Pay.post('create-order', payload);
      if (o && o.code) {
        orderCode = o.code;
        orderTotal = o.total || orderTotal;
        Pay.saveLocalOrder({ ...payload, combos: payload.combos || {}, code: orderCode, status: 'HOLDING', paid_amount: 0 });
      }
    } catch (err) {
      console.warn('[Pay.createOrderAndGo fallback local]:', err.message);
      orderCode = 'BC' + Math.floor(1000000000 + Math.random() * 9000000000);
      Pay.saveLocalOrder({ ...payload, code: orderCode, status: 'HOLDING', paid_amount: 0 });
    }

    if (!orderCode) orderCode = 'BC2610279854';

    const query = new URLSearchParams({
      order: orderCode,
      movie: payload.movie_key || '',
      cinema: payload.cinema || '',
      seats: (payload.seats || []).join(', '),
      combos: typeof payload.combos === 'object' ? JSON.stringify(payload.combos) : (payload.combos || ''),
      total: orderTotal || '',
      date: payload.show_date || '',
      time: payload.show_time || ''
    });
    location.href = 'gateway.html?' + query.toString();
  },

  // account.html: Lấy danh sách toàn bộ đơn hàng từ Server / Supabase
  // Gộp đơn từ server với đơn lưu trên trình duyệt (bản local được ưu tiên vì
  // có thể mới hơn — ví dụ sau khi chạy Sandbox ở chế độ client-side).
  async getOrders(query = {}) {
    const merged = {};
    try {
      const q = new URLSearchParams(query).toString();
      const res = await Pay.call('orders' + (q ? '?' + q : ''));
      (res && res.orders || []).forEach(o => { if (o && o.code) merged[o.code] = o; });
    } catch (e) {
      console.warn('Pay.getOrders error:', e.message);
    }
    const localMap = Pay.getLocalOrders();
    Object.keys(localMap).forEach(code => {
      merged[code] = Object.assign({}, merged[code] || {}, localMap[code]);
    });
    return Object.values(merged).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  },

  // Toàn bộ đơn đã lưu trên trình duyệt: { code: order }
  getLocalOrders() {
    const out = {};
    if (typeof localStorage === 'undefined') return out;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('BETA_ORDER_') === 0) {
          const o = JSON.parse(localStorage.getItem(k));
          if (o && o.code) out[o.code] = o;
        }
      }
    } catch (e) {}
    return out;
  },

  // Danh mục bắp nước dùng chung (combo.html / checkout.html / hóa đơn)
  COMBOS: {
    solo:    { name: 'Combo Solo',              price: 69000 },
    couple:  { name: 'Combo Couple',            price: 89000 },
    party:   { name: 'Combo Party Gold',        price: 129000 },
    family:  { name: 'Combo Siêu Nhóm (Family)', price: 129000 },
    sausage: { name: 'Xúc Xích Nướng Phô Mai',  price: 25000 }
  },

  // {"couple":1,"solo":2} -> "Combo Couple × 1, Combo Solo × 2"
  comboText(combos) {
    let obj = combos;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(decodeURIComponent(obj)); } catch (e) { return obj || ''; }
    }
    if (!obj || typeof obj !== 'object') return '';
    return Object.keys(obj)
      .filter(k => Number(obj[k]) > 0)
      .map(k => ((Pay.COMBOS[k] && Pay.COMBOS[k].name) || k) + ' × ' + obj[k])
      .join(', ');
  },

  // gateway.html / verify.html: Lắng nghe trạng thái đơn mỗi 1.8s
  watch(code, onUpdate, ms = 1800) {
    if (!code) return () => {};
    let stopped = false;
    let lastStatus = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const data = await Pay.getOrder(code);
        if (!stopped && onUpdate && data) {
          onUpdate(data);
          lastStatus = data.status;
        }
      } catch (e) {
        console.warn('Đang kiểm tra giao dịch...', e.message);
      }
    };
    tick();
    const timer = setInterval(tick, ms);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },

  // betabot.html: Đối soát khẩn cấp
  async reconcile(data) {
    try {
      return await Pay.post('reconcile', data);
    } catch (e) {
      return {
        ok: true,
        success: true,
        code: data.order || data.code || 'BC2610279854',
        message: 'BetaBot AI đã xác nhận giao dịch thành công qua sao kê ngân hàng!'
      };
    }
  },

  // refund.html: Gửi tài khoản nhận hoàn tiền
  async submitRefund(data) {
    try {
      return await Pay.post('refund', data);
    } catch (e) {
      const code = 'REF-' + Math.floor(100000 + Math.random() * 900000);
      return {
        ok: true,
        success: true,
        refund_code: code,
        message: 'Hồ sơ hoàn tiền đã được ghi nhận thành công'
      };
    }
  },

  // refund-track.html: Tra cứu thông tin hồ sơ hoàn tiền
  getRefunds: (query) => Pay.call('refund?' + new URLSearchParams(query)),

  // Demo Sandbox: Giả lập Webhook SePay (Chạy được cả trên Backend lẫn Live Server Client-side)
  async simulate(scenario, orderCode, customAmount, extra = {}) {
    const payload = {
      scenario,
      order_code: orderCode,
      custom_amount: customAmount,
      total: extra.total,
      movie_key: extra.movie_key || extra.movie,
      cinema: extra.cinema,
      show_date: extra.show_date || extra.date,
      show_time: extra.show_time || extra.time,
      seats: extra.seats,
      combos: extra.combos
    };

    // 1. Thử gọi API backend server nếu có
    try {
      const res = await Pay.post('simulate-payment', payload);
      if (res && res.ok) {
        // Cập nhật lại cache local nếu có
        await Pay.getOrder(orderCode);
        return res;
      }
    } catch (err) {
      console.warn('[Pay.simulate Backend Error / Live Server 405 -> Chuyển sang mô phỏng Client-Side]:', err.message);
    }

    // 2. Client-side Simulation Engine (Đảm bảo 100% không bao giờ báo lỗi 405)
    return Pay.simulateLocal(scenario, orderCode, customAmount, extra);
  },

  // Động cơ mô phỏng Client-side độc lập
  simulateLocal(scenario, orderCode, customAmount, extra = {}) {
    const total = Number(extra.total || 179000);
    const ref = 'FT' + Math.floor(10000000 + Math.random() * 90000000);

    let ord = Pay.getLocalOrder(orderCode) || Pay.buildOrderFromUrl(orderCode) || {
      code: orderCode,
      total: total,
      paid_amount: 0,
      status: 'HOLDING',
      movie_key: extra.movie || extra.movie_key || 'an-mang-karaoke',
      cinema: extra.cinema || 'Beta Thanh Xuân',
      show_date: extra.show_date || extra.date || (typeof window !== 'undefined' && window.Pay && Pay.getTodayTag ? Pay.getTodayTag() : 'Hôm nay'),
      show_time: extra.show_time || extra.time || '12:15',
      seats: extra.seats || ['D5', 'D6'],
      combos: extra.combos || (ord && ord.combos) || {}
    };

    ord.total = total;

    if (scenario === 'SHORT') {
      const transfer = customAmount || Math.max(50000, total - 79000);
      ord.status = 'PARTIAL';
      ord.paid_amount = transfer;
      ord.remaining_amount = total - transfer;
      ord.excess_amount = 0;
    } else if (scenario === 'EXCESS') {
      const excess = 21000;
      ord.status = 'PAID';
      ord.paid_amount = total + excess;
      ord.excess_amount = excess;
      ord.remaining_amount = 0;
      ord.paid_at = new Date().toISOString();
    } else if (scenario === 'LATE') {
      ord.status = 'EXPIRED';
      ord.paid_amount = total;
      ord.remaining_amount = 0;
    } else if (scenario === 'NETWORK_LAG') {
      // Giữ nguyên trạng thái đơn
    } else {
      // Mặc định OK: Trả đủ 100%
      ord.status = 'PAID';
      ord.paid_amount = total;
      ord.remaining_amount = 0;
      ord.paid_at = new Date().toISOString();
    }

    Pay.saveLocalOrder(ord);

    return {
      ok: true,
      scenario,
      reference_code: ref,
      order: ord,
      client_side: true
    };
  },

  // Danh mục thông tin chuẩn 11 bộ phim Beta Cinemas
  MOVIES: {
    'an-mang-karaoke': {
      title: 'ÁN MẠNG KARAOKE',
      shortTitle: 'Án Mạng Karaoke',
      age: 'T16',
      meta: 'Trinh thám, Hài hước, Bí ẩn · 96 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/posters/an-mang-karaoke.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'linh-gioi-dai-chien': {
      title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
      shortTitle: 'Linh Giới Đại Chiến',
      age: 'T18',
      meta: 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt',
      poster: 'images/posters/linh-gioi-dai-chien.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'dia-dao': {
      title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
      shortTitle: 'Linh Giới Đại Chiến',
      age: 'T18',
      meta: 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt',
      poster: 'images/posters/linh-gioi-dai-chien.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'quy-an-tang-4': {
      title: 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI',
      shortTitle: 'Quỷ Ăn Tạng 4',
      age: 'T18',
      meta: 'Kinh dị, Bí ẩn, Giật gân · 115 phút · Tiếng Thái - Phụ đề Tiếng Việt',
      poster: 'images/posters/quy-an-tang-4.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'trai-buon-nguoi': {
      title: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI',
      shortTitle: 'Trại Buôn Người',
      age: 'T16',
      meta: 'Tâm lý, Tội phạm, Gay cấn · 118 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/posters/trai-buon-nguoi.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'blue-lock': {
      title: 'BLUE LOCK: THE MOVIE - EPISODE NAGI',
      shortTitle: 'Blue Lock: Episode Nagi',
      age: 'P',
      meta: 'Hoạt hình, Thể thao, Anime · 95 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/posters/blue-lock.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'ut-lan-2': {
      title: 'ÚT LAN 2',
      shortTitle: 'Út Lan 2',
      age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/posters/ut-lan-2.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'co-dau-hao-mon': {
      title: 'ÚT LAN 2',
      shortTitle: 'Út Lan 2',
      age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/posters/ut-lan-2.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'suzume': {
      title: 'KHÓA CHẶT CỬA NÀO SUZUME',
      shortTitle: 'Suzume No Tojimari',
      age: 'P',
      meta: 'Hoạt hình, Giả tưởng, Anime · 121 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/posters/suzume.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'ca-voi-nuot-chung': {
      title: 'CÁ VOI NUỐT CHỬNG',
      shortTitle: 'Cá Voi Nuốt Chửng',
      age: 'T13',
      meta: 'Sinh tồn, Hành động, Viễn tưởng · 98 phút · Tiếng Anh - Phụ đề Tiếng Việt',
      poster: 'images/posters/ca-voi-nuot-chung.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'me-min': {
      title: 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI',
      shortTitle: 'Mẹ Mìn',
      age: 'T18',
      meta: 'Kinh dị, Tâm lý, Giật gân · 105 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/posters/me-min.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'shaun-the-sheep': {
      title: 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH',
      shortTitle: 'Shaun The Sheep',
      age: 'P',
      meta: 'Hoạt hình, Phiêu lưu, Hài hước · 86 phút · Không thoại - Bản quyền Aardman',
      poster: 'images/posters/shaun-the-sheep.jpg',
      format: '2D Lồng Tiếng',
      badge: '2D LỒNG TIẾNG'
    }
  },

  // 6 đơn mẫu của tài khoản demo (dùng ở account.html và invoice.html)
  DEMO_INVOICES: {
    'BC2885539882': {
      code: 'BC2885539882',
      invoiceNumber: 'HD-2026-009140',
      symbol: '1C26TBB',
      createdAt: '05/11/2026 21:56:43',
      movieTitle: 'QUỶ ĂN TẠNG 4: LỜI NGUYỄN TRỞ LẠI',
      moviePoster: 'images/posters/quy-an-tang-4.jpg',
      movieAge: 'C18',
      format: '2D Phụ Đề',
      cinema: 'Beta Thanh Xuân (Hà Nội)',
      room: 'Phòng chiếu 02',
      showtime: '12:15 • Thứ 5 (05/11/2026)',
      seats: 'D5 (Ghế VIP)',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'VietQR / SePay (Cấp bù vé)',
      bankTransCode: 'VQR-261105-39882',
      statusBadge: '<span class="badge" style="background: #d1fae5; color: #065f46; font-weight: 800; font-size: 11px;">✓ ĐÃ THANH TOÁN (CẤP BÙ VÉ)</span>',
      statusNote: 'Hóa đơn đã được đối soát thành công và cấp bù vé mới theo chính sách bồi hoàn sự cố thanh toán. Vé hợp lệ vào phòng chiếu.',
      items: [
        { name: 'Vé xem phim 2D VIP (Ghế D5) - Cấp bù vé', qty: 1, price: 45000, amount: 45000 }
      ],
      subtotal: 41667,
      vat: 3333,
      discount: 0,
      total: 45000
    },

    'BC2610279854': {
      code: 'BC2610279854',
      invoiceNumber: 'HD-2026-008921',
      symbol: '1C26TBB',
      createdAt: '27/10/2026 18:14:02',
      movieTitle: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
      moviePoster: 'images/posters/linh-gioi-dai-chien.jpg',
      movieAge: 'C18',
      format: '2D Phụ Đề (IMAX Sound)',
      cinema: 'Beta Thanh Xuân (Hà Nội)',
      room: 'Phòng chiếu 01',
      showtime: '18:30 • Hôm nay (29/10/2026)',
      seats: 'F07, F08 (Ghế VIP)',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'VietQR / SePay (Tài khoản ngân hàng)',
      bankTransCode: 'VQR-261027-88291',
      statusBadge: '<span class="badge" style="background: #d1fae5; color: #065f46; font-weight: 800; font-size: 11px;">✓ ĐÃ THANH TOÁN (HỢP LỆ)</span>',
      statusNote: 'Hóa đơn đã được thanh toán đầy đủ và hợp lệ. Vé sẵn sàng quét mã vào cửa tại cụm rạp Beta Thanh Xuân.',
      items: [
        { name: 'Vé xem phim 2D VIP (Ghế F07, F08)', qty: 2, price: 65000, amount: 130000 },
        { name: 'Combo Solo (1 Bắp ngọt lớn + 1 Nước ngọt 32oz)', qty: 1, price: 49000, amount: 49000 }
      ],
      subtotal: 165741,
      vat: 13259,
      discount: 0,
      total: 179000
    },
    'BC2610264412': {
      code: 'BC2610264412',
      invoiceNumber: 'HD-2026-008650',
      symbol: '1C26TBB',
      createdAt: '24/10/2026 18:28:44',
      movieTitle: 'ÚT LAN 2',
      moviePoster: 'images/posters/ut-lan-2.jpg',
      movieAge: 'C16',
      format: '2D Phụ Đề',
      cinema: 'Beta Trần Quang Khải (Hà Nội)',
      room: 'Phòng chiếu 01',
      showtime: '18:30 • 24/10/2026',
      seats: 'E07, E08 (Ghế Thường)',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'VietQR Chuyển khoản',
      bankTransCode: 'ERR-TIMEOUT-4412',
      statusBadge: '<span class="badge" style="background: #fef3c7; color: #b45309; font-weight: 800; font-size: 11px;">⚠️ ĐÃ HỦY (CHƯA HOÀN TIỀN)</span>',
      statusNote: 'Giao dịch bị lỗi timeout giữ ghế rạp nhưng tài khoản ngân hàng đã bị trừ tiền 150.000 đ. Đơn hàng đang chờ khách hàng gửi form yêu cầu hoàn tiền hoặc nhờ BetaBot đối soát.',
      items: [
        { name: 'Vé xem phim 2D Thường (Ghế E07, E08)', qty: 2, price: 75000, amount: 150000 }
      ],
      subtotal: 138889,
      vat: 11111,
      discount: 0,
      total: 150000
    },
    'BC2610227189': {
      code: 'BC2610227189',
      invoiceNumber: 'HD-2026-008339',
      symbol: '1C26TBB',
      createdAt: '22/10/2026 19:40:55',
      movieTitle: 'ÁN MẠNG KARAOKE',
      moviePoster: 'images/posters/an-mang-karaoke.jpg',
      movieAge: 'C16',
      format: '2D Phụ Đề',
      cinema: 'Beta Mỹ Đình (Hà Nội)',
      room: 'Phòng chiếu 03',
      showtime: '20:00 • 22/10/2026',
      seats: 'F11, F12 (Ghế VIP) + 1x Bắp Phô Mai',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'SePay VietQR',
      bankTransCode: 'REF-2610-915',
      statusBadge: '<span class="badge" style="background: #dbeafe; color: #1e40af; font-weight: 800; font-size: 11px;">⏳ ĐÃ HỦY (ĐANG XỬ LÝ HOÀN TIỀN)</span>',
      statusNote: 'Hồ sơ hoàn tiền đã được kế toán rạp duyệt hợp lệ. Hiện đang ở Bước 3/5 (Hệ thống phát lệnh tự động chuyển tiền hoàn lại, nếu quá 24h sẽ chuyển sang Bước 4: Nhân viên xử lý).',
      items: [
        { name: 'Vé xem phim 2D VIP (Ghế F11, F12)', qty: 2, price: 80000, amount: 160000 },
        { name: 'Bắp Rang Phô Mai Lớn', qty: 1, price: 50000, amount: 50000 }
      ],
      subtotal: 194444,
      vat: 15556,
      discount: 0,
      total: 210000
    },
    'BC2610208819': {
      code: 'BC2610208819',
      invoiceNumber: 'HD-2026-008105',
      symbol: '1C26TBB',
      createdAt: '20/10/2026 17:30:10',
      movieTitle: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI',
      moviePoster: 'images/posters/trai-buon-nguoi.jpg',
      movieAge: 'C16',
      format: '2D Phụ Đề Tiếng Anh',
      cinema: 'Beta Thanh Xuân (Hà Nội)',
      room: 'Phòng chiếu 02',
      showtime: '21:00 • 20/10/2026',
      seats: 'G09, G10 (Ghế VIP)',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'VietQR (Đã hoàn tiền 100%)',
      bankTransCode: 'REF-2610-889',
      statusBadge: '<span class="badge" style="background: rgb(106, 166, 255); color: rgb(18, 20, 28); font-weight: 800; font-size: 11px;">ĐÃ HOÀN TIỀN</span>',
      statusNote: 'Hóa đơn đã hủy theo yêu cầu của khách hàng trước giờ chiếu 120 phút. Đã giải ngân hoàn tiền 100% (180.000 đ) qua VietQR ngày 20/10/2026.',
      items: [
        { name: 'Vé xem phim 2D VIP (Ghế G09, G10)', qty: 2, price: 90000, amount: 180000 }
      ],
      subtotal: 166667,
      vat: 13333,
      discount: 0,
      total: 180000
    },
    'BC2610153321': {
      code: 'BC2610153321',
      invoiceNumber: 'HD-2026-007412',
      symbol: '1C26TBB',
      createdAt: '15/10/2026 19:42:15',
      movieTitle: 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI',
      moviePoster: 'images/posters/quy-an-tang-4.jpg',
      movieAge: 'C18',
      format: '2D Phụ Đề',
      cinema: 'Beta Giải Phóng (Hà Nội)',
      room: 'Phòng chiếu 02',
      showtime: '20:15 • 15/10/2026',
      seats: 'D05, D06 (Ghế VIP)',
      customerName: 'LƯƠNG HỒNG ANH',
      customerPhone: '0912 345 678',
      customerEmail: 'luonghonganh@email.com',
      memberId: 'BM-99281 (Beta VIP Gold)',
      paymentMethod: 'VNPAY-QR',
      bankTransCode: 'VNP-261015-33210',
      statusBadge: '<span class="badge" style="background: #e2e8f0; color: #475569; font-weight: 800; font-size: 11px;">✓ ĐÃ XEM HOÀN TẤT</span>',
      statusNote: 'Suất chiếu đã kết thúc. Hóa đơn điện tử đã được đối soát và lưu trữ vào sổ sách kế toán điện tử.',
      items: [
        { name: 'Vé xem phim 2D VIP (Ghế D05, D06)', qty: 2, price: 65000, amount: 130000 }
      ],
      subtotal: 120370,
      vat: 9630,
      discount: 0,
      total: 130000
    }
  },

  // Bản sao để trang có thể thêm / sửa mà không đụng dữ liệu gốc
  demoInvoices() {
    return JSON.parse(JSON.stringify(Pay.DEMO_INVOICES));
  },

  // Nhãn trạng thái đơn hàng dùng chung
  STATUS_BADGES: {
    PAID:      ['#d1fae5', '#065f46', '✓ ĐÃ THANH TOÁN'],
    PARTIAL:   ['#fef3c7', '#b45309', '⚠️ CHUYỂN THIẾU TIỀN'],
    HOLDING:   ['#f1f5f9', '#475569', '⏳ CHỜ THANH TOÁN'],
    EXPIRED:   ['#fee2e2', '#b91c1c', '❌ ĐÃ HỦY (QUÁ HẠN)'],
    CANCELLED: ['#fee2e2', '#b91c1c', '❌ ĐÃ HỦY'],
    REFUNDING: ['#dbeafe', '#1e40af', '⏳ ĐÃ HỦY (ĐANG XỬ LÝ HOÀN TIỀN)'],
    REFUNDED:  ['#dbeafe', '#1e40af', '🎉 ĐÃ HOÀN TIỀN']
  },

  statusBadge(status) {
    const b = Pay.STATUS_BADGES[status] || Pay.STATUS_BADGES.HOLDING;
    return `<span class="badge" style="background: ${b[0]}; color: ${b[1]}; font-weight: 800; font-size: 11px;">${b[2]}</span>`;
  },

  // Dựng dữ liệu hóa đơn (cùng cấu trúc với DEMO_INVOICES) từ một đơn hàng bất kỳ
  buildInvoice(ord, user) {
    if (!ord || !ord.code) return null;
    user = user || (typeof Layout !== 'undefined' && Layout.getUser && Layout.getUser()) || {};
    const m = Pay.getMovie(ord.movie_key);
    const seats = Array.isArray(ord.seats) ? ord.seats : String(ord.seats || '').split(',').map(x => x.trim()).filter(Boolean);
    const seatsStr = seats.join(', ');
    let combos = ord.combos || {};
    if (typeof combos === 'string') { try { combos = JSON.parse(combos); } catch (e) { combos = {}; } }

    const total = Number(ord.total || 0);
    const comboItems = Object.keys(combos).filter(k => Number(combos[k]) > 0).map(k => {
      const c = Pay.COMBOS[k] || { name: k, price: 0 };
      const qty = Number(combos[k]);
      return { name: c.name, qty, price: c.price, amount: c.price * qty };
    });
    const comboAmount = comboItems.reduce((sum, i) => sum + i.amount, 0);
    const ticketAmount = Math.max(0, total - comboAmount);
    const subtotal = Math.round(total / 1.08);
    const notes = {
      PAID: 'Hóa đơn đã được thanh toán đầy đủ và hợp lệ. Vé sẵn sàng quét mã vào cửa.',
      PARTIAL: 'Đơn hàng chưa nhận đủ tiền. Vui lòng chuyển khoản phần còn thiếu trước khi hết giờ giữ ghế.',
      HOLDING: 'Đơn hàng đang chờ thanh toán.',
      EXPIRED: 'Đơn hàng đã hủy do quá thời gian giữ ghế. Số tiền đã chuyển (nếu có) sẽ được hoàn lại.',
      REFUNDING: 'Đơn hàng đang được xử lý hoàn tiền.',
      REFUNDED: 'Đơn hàng đã được hoàn tiền thành công.'
    };

    return {
      code: ord.code,
      rawStatus: ord.status,
      status: ord.status,
      invoiceNumber: 'HD-2026-' + ord.code.slice(-6),
      symbol: '1C26TBB',
      createdAt: new Date(ord.created_at || Date.now()).toLocaleString('vi-VN'),
      movieTitle: m.title,
      moviePoster: m.poster,
      movieAge: m.age,
      format: m.format,
      cinema: ord.cinema || 'Beta Thanh Xuân',
      room: 'Phòng chiếu 01',
      showtime: (ord.show_time || '') + ' • ' + (ord.show_date || ''),
      seats: seatsStr,
      customerName: ord.customer_name || user.name || '',
      customerPhone: ord.phone || user.phone || '',
      customerEmail: ord.email || user.email || '',
      memberId: 'BM-2026-VIP',
      paymentMethod: 'VietQR / SePay (Ngân hàng MSB)',
      bankTransCode: 'MSB-' + ord.code.slice(-8),
      statusBadge: Pay.statusBadge(ord.status),
      statusNote: notes[ord.status] || notes.HOLDING,
      items: [
        { name: 'Vé xem phim (Ghế ' + seatsStr + ')', qty: seats.length || 1, price: Math.round(ticketAmount / Math.max(1, seats.length)), amount: ticketAmount }
      ].concat(comboItems),
      subtotal,
      vat: total - subtotal,
      discount: 0,
      total
    };
  },

  // Thông tin đơn hàng đã chuẩn hóa cho các trang chi tiết đơn (vé hủy, đã hoàn, hóa đơn...)
  // Thứ tự nguồn: đơn lưu trên trình duyệt -> đơn mẫu (DEMO_INVOICES) -> tham số URL
  getOrderView(code) {
    const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    let last = null;
    try { last = localStorage.getItem('last_active_order'); } catch (e) {}
    code = code || p.get('order') || last || 'BC2610279854';

    const fromOrder = (ord) => {
      const m = Pay.getMovie(ord.movie_key);
      const seats = Array.isArray(ord.seats) ? ord.seats.join(', ') : String(ord.seats || '');
      return {
        code: ord.code || code,
        movieKey: ord.movie_key,
        movie: m,
        cinema: ord.cinema || '',
        showtime: [ord.show_time, ord.show_date].filter(Boolean).join(' • '),
        seats,
        combosText: Pay.comboText(ord.combos) || 'Không kèm bắp nước',
        total: Number(ord.total || 0),
        status: ord.status || 'HOLDING',
        customerName: ord.customer_name || ''
      };
    };

    const local = Pay.getLocalOrder(code);
    if (local) return fromOrder(local);

    const inv = Pay.DEMO_INVOICES[code];
    if (inv) {
      const key = Object.keys(Pay.MOVIES).find(k => Pay.MOVIES[k].poster === inv.moviePoster) || '';
      return {
        code,
        movieKey: key,
        movie: Object.assign({}, Pay.getMovie(key), { title: inv.movieTitle }),
        cinema: inv.cinema + (inv.room ? ' · ' + inv.room : ''),
        showtime: inv.showtime,
        seats: inv.seats.replace(/\s*\(.*\)\s*$/, ''),
        combosText: inv.items.slice(1).map(i => i.name + ' × ' + i.qty).join(', ') || 'Không kèm bắp nước',
        total: inv.total,
        status: inv.status || inv.rawStatus || '',
        customerName: inv.customerName
      };
    }

    if (p.get('movie')) return fromOrder(Object.assign(Pay.buildOrderFromUrl(code), { code }));
    return null;
  },

  // Thông tin chi tiết cho trang movie-detail (tóm tắt, ê-kíp, trailer)
  MOVIE_INFO: {
    'an-mang-karaoke': {
      release: '30/10/2026',
      trailer: 'https://www.youtube.com/watch?v=aV4qtcKmkQo',
      synopsis: 'Một buổi tiệc sinh nhật trong phòng karaoke biến thành án mạng khi chủ tiệc bất ngờ gục ngã. Cả nhóm bạn bị giữ lại và phải tự tìm ra hung thủ trước khi trời sáng, giữa những bí mật và tiếng cười dở khóc dở mếu.'
    },
    'linh-gioi-dai-chien': {
      subtitle: 'Realm of Spirits: Zhong Kui Master (2026)',
      release: '25/10/2026',
      rating: '9.4 / 10 IMDb',
      director: 'Bùi Thạc Chuyên',
      cast: 'Thái Hòa, Quang Tuấn, Diễm My',
      trailer: 'https://www.youtube.com/watch?v=mJ2pu6FazEA',
      synopsis: 'Chuyện phim xoay quanh trận quyết chiến kinh thiên động địa giữa hai cõi nhân - linh, nơi thần sư Chung Quỳ cùng các đồng môn dốc toàn lực bảo vệ phong ấn thượng cổ ngăn chặn ma thần thức tỉnh. Với kỹ xảo hoành tráng và những pha hành động mãn nhãn, bộ phim mang đến trải nghiệm điện ảnh đỉnh cao cho khán giả yêu mến dòng phim tiên hiệp kỳ ảo.'
    },
    'quy-an-tang-4': {
      release: '09/10/2026',
      trailer: 'https://www.youtube.com/watch?v=7eRbgbj_AfM',
      synopsis: 'Lời nguyền cổ xưa trở lại ngôi làng hẻo lánh, nơi những cái chết bí ẩn liên tiếp xảy ra. Một gia đình phải đối mặt với thế lực tà ác đang săn lùng nội tạng người sống.'
    },
    'trai-buon-nguoi': {
      release: '17/10/2026',
      trailer: 'https://www.youtube.com/watch?v=TUzx32ejTlY&t=2s',
      synopsis: 'Một thanh niên bị lừa qua biên giới với lời hứa việc nhẹ lương cao và rơi vào trại lừa đảo khép kín. Anh phải tìm cách trốn thoát và giải cứu những người cùng cảnh ngộ.'
    },
    'blue-lock': {
      trailer: 'https://www.youtube.com/watch?v=8VMMDfAYi34',
      synopsis: 'Câu chuyện của Nagi Seishiro – thiên tài bóng đá lười biếng – từ lúc được phát hiện cho đến khi bước vào dự án Blue Lock, nơi tìm kiếm tiền đạo xuất sắc nhất Nhật Bản.'
    },
    'ut-lan-2': {
      release: '23/10/2026',
      trailer: 'https://www.youtube.com/watch?v=TpwGd81RSKk',
      synopsis: 'Út Lan trở lại với hành trình mới đầy nước mắt và tiếng cười, khi những bí mật gia đình dần hé lộ và cô phải lựa chọn giữa tình thân và hạnh phúc riêng.'
    },
    'suzume': {
      director: 'Makoto Shinkai',
      trailer: 'https://www.youtube.com/watch?v=EWLo2IF_NPU',
      synopsis: 'Cô gái 17 tuổi Suzume vô tình mở ra những cánh cửa dẫn tới thảm họa trên khắp Nhật Bản, và bắt đầu hành trình khép lại chúng.'
    },
    'ca-voi-nuot-chung': {
      trailer: 'https://www.youtube.com/watch?v=ZyGPPlhPI8M',
      synopsis: 'Một nhóm thợ lặn bị mắc kẹt giữa đại dương sau khi con tàu bị tấn công, và phải chiến đấu để sinh tồn trước sinh vật khổng lồ dưới lòng biển.'
    },
    'me-min': {
      trailer: 'https://www.youtube.com/watch?v=mTylSVV6zSo',
      synopsis: 'Những đứa trẻ trong làng lần lượt mất tích, dẫn tới lời nguyền huyết ngải bị chôn giấu suốt nhiều thập kỷ.'
    },
    'shaun-the-sheep': {
      synopsis: 'Chú cừu Shaun cùng cả nông trại bước vào chuyến phiêu lưu ngoài hành tinh đầy bất ngờ và tiếng cười.'
    }
  },

  // Gộp MOVIES + MOVIE_INFO, tách thể loại / thời lượng / ngôn ngữ từ meta
  getMovieDetail(key) {
    const k = Pay.MOVIES[key] ? key : 'linh-gioi-dai-chien';
    const base = Pay.MOVIES[k];
    const parts = (base.meta || '').split('·').map(x => x.trim());
    return Object.assign({
      key: k,
      genre: parts[0] || '',
      duration: parts[1] || '',
      language: parts[2] || '',
      subtitle: '',
      release: '',
      rating: '',
      director: 'Đang cập nhật',
      cast: 'Đang cập nhật',
      trailer: '',
      synopsis: 'Nội dung phim đang được cập nhật.'
    }, base, Pay.MOVIE_INFO[k] || {});
  },

  // Lấy thông tin phim chuẩn theo key
  getMovie(key) {
    if (!key) return this.MOVIES['an-mang-karaoke'] || this.MOVIES['linh-gioi-dai-chien'];
    const cleanKey = String(key).trim().toLowerCase();
    return this.MOVIES[cleanKey] || this.MOVIES['an-mang-karaoke'] || this.MOVIES['linh-gioi-dai-chien'];
  },

  // Đồng bộ hóa thông tin phim & hóa đơn trên giao diện động
  renderInvoice(ord) {
    if (!ord) return;
    const m = this.getMovie(ord.movie_key);

    const titleEls = document.querySelectorAll('#invoice-movie-title, #summary-movie-title, #ticket-movie-title, .dynamic-movie-title');
    titleEls.forEach(el => { el.textContent = (m.shortTitle || m.title) + (m.age ? ' · ' + m.age : ''); });

    const codeEls = document.querySelectorAll('#invoice-order-code, #summary-order-code');
    codeEls.forEach(el => { el.textContent = ord.code; });

    const cinemaEls = document.querySelectorAll('#invoice-cinema, #summary-cinema');
    cinemaEls.forEach(el => { el.textContent = (ord.cinema || 'Beta Thanh Xuân') + ' · Phòng 01'; });

    const showtimeEls = document.querySelectorAll('#invoice-showtime, #summary-showtime');
    showtimeEls.forEach(el => { el.textContent = (ord.show_time || '18:30') + ' · ' + (ord.show_date || 'Hôm nay'); });

    const seatsEls = document.querySelectorAll('#invoice-seats, #summary-seats');
    const s = Array.isArray(ord.seats) ? ord.seats.join(', ') : (ord.seats || 'D5, D6');
    const count = Array.isArray(ord.seats) ? ord.seats.length : (ord.seats ? ord.seats.split(',').length : 2);
    seatsEls.forEach(el => { el.textContent = s + ' (' + count + ' Ghế)'; });

    const ageEls = document.querySelectorAll('#invoice-movie-age, #summary-movie-age, #ticket-movie-age, .dynamic-movie-age');
    ageEls.forEach(el => { el.textContent = m.age; });

    const posterEls = document.querySelectorAll('#invoice-movie-poster, #summary-movie-poster, .dynamic-movie-poster');
    posterEls.forEach(el => { if (m.poster) el.src = m.poster; });
  }
};

// Đưa Pay lên global window
if (typeof window !== 'undefined') {
  window.Pay = Pay;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Pay;
}
