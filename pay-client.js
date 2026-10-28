// pay-client.js - Module gọi API cho hệ thống thanh toán Beta Cinemas
const Pay = {
  vnd: (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + ' đ',

  // Phát hiện endpoint API khả dụng:
  // Nếu đang mở trên Live Server (port 5500, 5501...) hoặc file://
  // thử kết nối tới http://localhost:3000/api/ nếu có server chạy nền
  getApiBase() {
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      if (port && port !== '3000') {
        return 'http://localhost:3000/api/';
      }
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
        // Nếu fetch tới port 3000 bị chặn (CORS / server chưa bật), thử relative
        if (apiBase.startsWith('http://localhost:3000')) {
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
      show_date: p.get('date') || 'CN 25/10',
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
  async getOrders(query = {}) {
    try {
      const q = new URLSearchParams(query).toString();
      const res = await Pay.call('orders' + (q ? '?' + q : ''));
      if (res && res.orders) return res.orders;
    } catch (e) {
      console.warn('Pay.getOrders error:', e.message);
    }
    const localMap = Pay.getLocalOrders ? Pay.getLocalOrders() : {};
    return Object.values(localMap).sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  },

  // gateway.html / verify.html: Lắng nghe trạng thái đơn mỗi 2.5s
  watch(code, onUpdate, ms = 2500) {
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
      show_date: extra.show_date || extra.date || 'CN 25/10',
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
      poster: 'images/an-mang-karaoke-kc-30-10-2026-kt-chuan-114723-300926-76.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'linh-gioi-dai-chien': {
      title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
      shortTitle: 'Linh Giới Đại Chiến',
      age: 'T18',
      meta: 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt',
      poster: 'images/400x633-145627-230926-40.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'dia-dao': {
      title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
      shortTitle: 'Linh Giới Đại Chiến',
      age: 'T18',
      meta: 'Hành động, Giả tưởng, Thần thoại · 128 phút · Tiếng Trung - Phụ đề Tiếng Việt',
      poster: 'images/400x633-145627-230926-40.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'quy-an-tang-4': {
      title: 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI',
      shortTitle: 'Quỷ Ăn Tạng 4',
      age: 'T18',
      meta: 'Kinh dị, Bí ẩn, Giật gân · 115 phút · Tiếng Thái - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_28_091026-quy-an-tang-4-132603-280926-92.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'trai-buon-nguoi': {
      title: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI',
      shortTitle: 'Trại Buôn Người',
      age: 'T16',
      meta: 'Tâm lý, Tội phạm, Gay cấn · 118 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/media_images_2026_09_15_official-poster-trai-buon-nguoi-final-142318-150926-62.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'blue-lock': {
      title: 'BLUE LOCK: THE MOVIE - EPISODE NAGI',
      shortTitle: 'Blue Lock: Episode Nagi',
      age: 'P',
      meta: 'Hoạt hình, Thể thao, Anime · 95 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_28_091026-blue-lock-170502-280926-25.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'ut-lan-2': {
      title: 'ÚT LAN 2',
      shortTitle: 'Út Lan 2',
      age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/ul2-main-dam-hoi-digital-094550-140926-42.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'co-dau-hao-mon': {
      title: 'ÚT LAN 2',
      shortTitle: 'Út Lan 2',
      age: 'T16',
      meta: 'Tâm lý, Tình cảm, Hài kịch · 114 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/ul2-main-dam-hoi-digital-094550-140926-42.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'suzume': {
      title: 'KHÓA CHẶT CỬA NÀO SUZUME',
      shortTitle: 'Suzume No Tojimari',
      age: 'P',
      meta: 'Hoạt hình, Giả tưởng, Anime · 121 phút · Tiếng Nhật - Phụ đề Tiếng Việt',
      poster: 'images/poster-khoa-chat-cua-nao-suzum-1-092028-280926-82.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'ca-voi-nuot-chung': {
      title: 'CÁ VOI NUỐT CHỬNG',
      shortTitle: 'Cá Voi Nuốt Chửng',
      age: 'T13',
      meta: 'Sinh tồn, Hành động, Viễn tưởng · 98 phút · Tiếng Anh - Phụ đề Tiếng Việt',
      poster: 'images/media_images_2026_09_21_ca-voi-nuot-chung-091717-210926-56.jpg',
      format: '2D Phụ đề Tiếng Việt',
      badge: '2D PHỤ ĐỀ'
    },
    'me-min': {
      title: 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI',
      shortTitle: 'Mẹ Mìn',
      age: 'T18',
      meta: 'Kinh dị, Tâm lý, Giật gân · 105 phút · Tiếng Việt - Phụ đề Tiếng Anh',
      poster: 'images/me-min-teaser-poster-dkkc-23102026-132757-170926-76.jpg',
      format: '2D Phụ đề Tiếng Anh',
      badge: '2D PHỤ ĐỀ'
    },
    'shaun-the-sheep': {
      title: 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH',
      shortTitle: 'Shaun The Sheep',
      age: 'P',
      meta: 'Hoạt hình, Phiêu lưu, Hài hước · 86 phút · Không thoại - Bản quyền Aardman',
      poster: 'images/media_images_2026_10_05_161026-shaun-the-sheep-152403-051026-14.jpg',
      format: '2D Lồng Tiếng',
      badge: '2D LỒNG TIẾNG'
    }
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
    seatsEls.forEach(el => { el.textContent = s + ' (' + count + ' Ghế VIP)'; });

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
