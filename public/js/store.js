/**
 * js/store.js - Lớp lưu trữ dữ liệu duy nhất của giao diện
 *
 * Mọi trang đọc / ghi dữ liệu qua Store thay vì gọi localStorage trực tiếp.
 * Khi nối database (Supabase), chỉ cần thay phần thân các hàm dưới đây
 * (hoặc chuyển từng nhóm khóa sang gọi API) — các trang không phải sửa.
 *
 * BẢNG KHÓA  ->  BẢNG DATABASE TƯƠNG ỨNG (xem schema.sql)
 * ---------------------------------------------------------------------------
 *  BETA_USER                    phiên đăng nhập             -> Supabase Auth session
 *  BETA_ACCOUNTS                tài khoản (mật khẩu băm)     -> auth.users + profiles
 *  BETA_ORDER_<mã đơn>          đơn hàng                    -> orders (+ seat_holds)
 *  last_active_order            đơn đang thao tác gần nhất   -> (chỉ ở trình duyệt)
 *  refund_detail_<mã đơn>       hồ sơ hoàn tiền              -> refunds
 *  reported_refund_orders       đơn đã báo lỗi / chờ hoàn    -> refunds.status
 *  BETA_SUPPORT_TICKETS         phiếu hỗ trợ + phản hồi      -> support_tickets, ticket_replies
 *  BETA_CUSTOM_VOUCHERS         voucher do quản trị tạo      -> vouchers
 *  BETA_VOUCHER_USED_<email>    voucher đã dùng của khách    -> voucher_usages
 *  quick_dock_state, hold_sec_*, autorefund_*, layer2_outcome_*
 *                               trạng thái giao diện demo    -> (chỉ ở trình duyệt)
 */
(function () {
  function backend() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  const Store = {
    // Chuỗi thô (giống localStorage.getItem); null nếu không có
    getRaw(key) {
      try { const b = backend(); return b ? b.getItem(key) : null; } catch (e) { return null; }
    },

    setRaw(key, value) {
      try { const b = backend(); if (b) b.setItem(key, String(value)); } catch (e) {}
    },

    remove(key) {
      try { const b = backend(); if (b) b.removeItem(key); } catch (e) {}
    },

    // Đọc JSON, trả về fallback nếu không có / lỗi
    get(key, fallback) {
      const raw = Store.getRaw(key);
      if (raw === null || raw === undefined) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },

    set(key, value) {
      Store.setRaw(key, JSON.stringify(value));
    },

    // Tất cả khóa bắt đầu bằng prefix
    keys(prefix) {
      const out = [];
      try {
        const b = backend();
        if (!b) return out;
        for (let i = 0; i < b.length; i++) {
          const k = b.key(i);
          if (k && (!prefix || k.indexOf(prefix) === 0)) out.push(k);
        }
      } catch (e) {}
      return out;
    }
  };

  window.Store = Store;
})();
