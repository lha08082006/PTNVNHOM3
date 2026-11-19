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
      // Mở qua Live Server của VS Code (port 5500, 5501...) hoặc file:// -> gọi API ở server Node port 5000
      if (/^55\d\d$/.test(port) || window.location.protocol === 'file:') {
        return 'http://localhost:5000/api/';
      }
      // Còn lại (server Node ở bất kỳ port nào, Vercel): API cùng nguồn
      return '/api/';
    }
    return '/api/';
  },

  async call(path, opts = {}) {
    const cleanPath = path.replace(/^\/api\//, '').replace(/^\//, '');
    const apiBase = Pay.getApiBase();
    let url = apiBase + cleanPath;
    // Gửi kèm phiên đăng nhập thành viên (auth-client.js) để máy chủ biết đơn của ai
    let token = null;
    try { token = localStorage.getItem('BETA_AUTH_TOKEN'); } catch (e) {}
    if (token) opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } };

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
      Pay._absorb(j);
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

  // Chủ đơn (đã đăng nhập): hủy đơn chưa thanh toán để nhả ghế / gửi lại vé qua email
  cancelOrder: (code) => Pay.post('order-action?action=cancel&code=' + encodeURIComponent(code)),
  resendTicket: (code) => Pay.post('order-action?action=resend-ticket&code=' + encodeURIComponent(code)),

  // Gửi lại vé qua email, báo kết quả ngay trên nút
  async resendTicketUI(code, btn) {
    if (!code) return;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi…'; }
    try {
      const r = await Pay.resendTicket(code);
      const msg = r.sent ? '✓ Đã gửi vé tới ' + r.email : 'Máy chủ chưa cấu hình gửi email – vé chưa được gửi (' + r.email + ')';
      if (btn) btn.textContent = msg;
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = label; } }, 6000);
    } catch (e) {
      alert('Chưa gửi được vé: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  },

  // Hủy đơn sau khi khách xác nhận; xong thì mở trang theo dõi đơn
  async confirmCancel(code, btn) {
    if (!code) return;
    if (!confirm('Hủy đơn ' + code + ' và nhả ghế ngay?\n\nChỉ hủy khi bạn CHƯA chuyển khoản. Nếu lỡ đã chuyển, hệ thống vẫn tự cấp vé bù hoặc hoàn tiền.')) return;
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Đang hủy…'; }
    try {
      await Pay.cancelOrder(code);
      location.href = 'order.html?code=' + encodeURIComponent(code);
    } catch (e) {
      alert('Chưa hủy được đơn: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    }
  },

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

  // Danh mục phim lấy từ catalog.js (dùng chung với máy chủ)
  get MOVIES() {
    const C = (typeof window !== "undefined" && window.BetaCatalog) || (typeof require === "function" ? require("./catalog") : null);
    return (C && C.MOVIES) || {};
  },

  // Lấy thông tin phim theo key; mã không có trong danh mục thì trả bản "chưa rõ phim" thay vì đoán sai phim
  getMovie(key) {
    const k = String(key || "").trim().toLowerCase();
    const m = Pay._movies[k] || this.MOVIES[k];
    return m || { title: "PHIM ĐANG CẬP NHẬT", shortTitle: "Phim đang cập nhật", age: "", meta: "", poster: "images/400x633-145627-230926-40.jpg", format: "2D", badge: "2D" };
  },

  // Phim lấy từ database (qua API) được ghi nhớ để getMovie() dùng, kể cả phim Quản lý mới thêm
  _movies: {},
  _absorb(j) {
    const take = (m, key) => { if (m && (m.key || key)) Pay._movies[String(m.key || key).toLowerCase()] = m; };
    if (!j || typeof j !== "object") return;
    take(j.movie, j.movie_key);
    (j.orders || []).forEach(o => take(o.movie, o.movie_key));
    (j.movies || []).forEach(m => take(m));
    (j.showtimes || []).forEach(st => take(st.movie, st.movie_key));
    if (j.showtime) take(j.showtime.movie, j.showtime.movie_key);
  },

  // Danh mục từ database
  catalog: (action, params = {}) => Pay.call("catalog?" + new URLSearchParams({ action, ...params })),
  // Bảng giá (loại vé, quy tắc giá theo khung giờ, ngày lễ) – tải một lần mỗi trang
  _pricing: null,
  async pricing() {
    if (!Pay._pricing) Pay._pricing = Pay.catalog("pricing").catch(() => null);
    return Pay._pricing;
  },
  // Số vé theo loại khách chọn ở bước Ghế, truyền qua URL: ?types={"STUDENT":1}
  typesFromUrl() {
    try {
      const raw = new URLSearchParams(location.search).get("types");
      const o = raw ? JSON.parse(raw) : {};
      return Object.fromEntries(Object.entries(o).filter(([k, v]) => /^[A-Z_]{3,20}$/.test(k) && Number.isInteger(+v) && +v > 0).map(([k, v]) => [k, +v]));
    } catch (e) { return {}; }
  },
  async getShowtime(id) {
    if (!id) return null;
    try { return (await Pay.catalog("showtime", { id })).showtime; } catch (e) { return null; }
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
    seatsEls.forEach(el => { el.textContent = s + ' (' + count + ' ghế)'; });

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
