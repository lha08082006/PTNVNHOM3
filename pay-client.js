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
      if (port === '5000' || port === '3000' || !port) {
        return '/api/';
      }
      // Đang mở qua Live Server (port 5500, 5501...) -> ưu tiên kết nối tới port 5000
      return 'http://localhost:5000/api/';
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

  // Lấy chi tiết đơn hàng từ máy chủ; mất kết nối thì trả trạng thái thật gần nhất đã lưu (nếu có)
  async getOrder(code) {
    if (!code) return null;
    try {
      const res = await Pay.call('order-status?code=' + encodeURIComponent(code));
      if (res && res.code) { Pay.saveLocalOrder(res); return res; }
    } catch (e) {}
    return Pay.getLocalOrder(code);
  },

  // checkout.html: Tạo đơn (khóa ghế 10 phút ở máy chủ) rồi sang trang quét mã VietQR.
  // Không bao giờ tự sinh mã đơn ở trình duyệt: khách chuyển tiền vào mã đơn không tồn tại là mất dấu tiền.
  async createOrderAndGo(payload) {
    const o = await Pay.post('create-order', payload);
    Pay.saveLocalOrder(o);
    location.href = 'gateway.html?order=' + encodeURIComponent(o.code);
    return o;
  },

  // account.html: Danh sách đơn hàng thật từ máy chủ
  async getOrders(query = {}) {
    const q = new URLSearchParams(query).toString();
    const res = await Pay.call('orders' + (q ? '?' + q : ''));
    return (res && res.orders) || [];
  },

  // Theo dõi trạng thái đơn (mỗi lần hỏi máy chủ cũng chạy lịch tra cứu Tầng 1/Tầng 2)
  watch(code, onUpdate, ms = 3000) {
    if (!code) return () => {};
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const data = await Pay.call('order-status?code=' + encodeURIComponent(code));
        if (!stopped && data && data.code) { Pay.saveLocalOrder(data); onUpdate && onUpdate(data); }
      } catch (e) {
        console.warn('Đang kiểm tra giao dịch...', e.message);
      }
    };
    tick();
    const timer = setInterval(tick, ms);
    return () => { stopped = true; clearInterval(timer); };
  },

  // Nút "Báo cáo lỗi: Đã chuyển tiền nhưng chưa có vé" (BR-10)
  reportIssue: (code, extra = {}) => Pay.post('report-issue', { order_code: code, ...extra }),

  // betabot.html: Hỗ trợ đối soát (tạo phiếu CSKH + tra cứu ngay)
  reconcile: (data) => Pay.post('reconcile', data),

  // refund.html: RefundForm (chỉ khi đơn ở trạng thái Chờ xử lý thủ công)
  submitRefund: (data) => Pay.post('refund', data),

  getRefunds: (query) => Pay.call('refund?' + new URLSearchParams(query)),

  // seats.html: ghế đang giữ / đã bán của một suất
  async getTakenSeats(showtimeKey) {
    try {
      const r = await Pay.call('seats?showtime_key=' + encodeURIComponent(showtimeKey));
      return (r && r.seats) || [];
    } catch (e) {
      return [];
    }
  },

  // Sandbox mô phỏng ngân hàng (demo / UAT). Không chuyển tiền thật.
  simulate: (scenario, orderCode, customAmount, extra = {}) =>
    Pay.post('simulate-payment', { scenario, order_code: orderCode, custom_amount: customAmount, ...extra }),

  // Trang nên mở cho một đơn theo trạng thái hiện tại
  routeFor(o) {
    if (!o) return null;
    const c = encodeURIComponent(o.code);
    if (o.has_ticket) {
      const excess = (o.refunds || []).some(r => r.reason === 'EXCESS');
      return excess ? 'overpay.html?order=' + c : 'ticket.html?order=' + c;
    }
    if (o.status === 'PENDING') return o.paid_amount > 0 ? 'underpay.html?order=' + c : 'gateway.html?order=' + c;
    return 'order.html?code=' + c;
  },

  // Màu nhãn trạng thái cho giao diện
  statusTone(status) {
    return ({
      PENDING: 'warn', EXPIRED: 'warn', CONFIRMED: 'ok', CONFIRMED_LATE: 'ok',
      REFUND_REQUESTED: 'info', REFUNDED: 'muted', MANUAL_REVIEW: 'danger', CANCELLED: 'muted', FAILED: 'danger'
    })[status] || 'muted';
  },

  fmtTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
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
