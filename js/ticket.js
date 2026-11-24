// js/ticket.js - mã của ticket.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
const CINEMA_ADDRESSES = {
  'Beta Thanh Xuân (Hà Nội)': 'Tầng B1, Golden West, Lê Văn Thiêm, Q. Thanh Xuân',
  'Beta Thanh Xuân': 'Tầng B1, Golden West, Lê Văn Thiêm, Q. Thanh Xuân',
  'Beta Giải Phóng (Hà Nội)': 'Tầng 3, Imperial Plaza, 360 Giải Phóng, Q. Hoàng Mai',
  'Beta Giải Phóng': 'Tầng 3, Imperial Plaza, 360 Giải Phóng, Q. Hoàng Mai',
  'Beta Mỹ Đình (Hà Nội)': 'Tầng hầm B1, Tòa nhà Golden Palace, Mễ Trì',
  'Beta Mỹ Đình': 'Tầng hầm B1, Tòa nhà Golden Palace, Mễ Trì',
  'Beta Trần Quang Khải': 'Tầng 2, 130 Trần Quang Khải, Q.1, TP.HCM',
  'Beta Quang Trung (TP.HCM)': '645 Quang Trung, P.11, Q. Gò Vấp, TP.HCM',
  'Beta Quang Trung': '645 Quang Trung, P.11, Q. Gò Vấp, TP.HCM',
  'Beta Ung Văn Khiêm (TP.HCM)': 'Tòa nhà D2, 60 Ung Văn Khiêm, P.25, Q. Bình Thạnh',
  'Beta Ung Văn Khiêm': 'Tòa nhà D2, 60 Ung Văn Khiêm, P.25, Q. Bình Thạnh',
  'Beta Thái Nguyên': 'Tầng 4, TTTM Phổ Yên Plaza, Thái Nguyên',
  'Beta Bắc Giang': 'Tầng 4, Tòa nhà Hapro, Quảng Trường 3/2, Bắc Giang',
  'Beta Nha Trang': 'Tầng 4, TTTM Nha Trang Center, 20 Trần Phú'
};

const params = new URLSearchParams(window.location.search);
const orderParam = params.get('order');
if (!orderParam) location.replace('account.html');
const ticketMain = document.querySelector('main');
if (ticketMain) ticketMain.style.visibility = 'hidden';
const movieParam = params.get('movie');
const cinemaParam = params.get('cinema');
const dateParam = params.get('date');
const timeParam = params.get('time');
const seatsParam = params.get('seats');
const formatParam = params.get('format');
const totalParam = params.get('total');
const combosParam = params.get('combos');

const MOVIE_CATALOG_FALLBACK = {
  'trai-buon-nguoi': {
    title: 'TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI',
    format: '2D Phụ đề Tiếng Anh',
    badge: '2D PHỤ ĐỀ'
  },
  'an-mang-karaoke': {
    title: 'ÁN MẠNG KARAOKE',
    format: '2D Phụ đề Tiếng Anh',
    badge: '2D PHỤ ĐỀ'
  },
  'linh-gioi-dai-chien': {
    title: 'LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ',
    format: '2D Phụ đề Tiếng Việt',
    badge: '2D PHỤ ĐỀ'
  },
  'quy-an-tang-4': {
    title: 'QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI',
    format: '2D Phụ đề Tiếng Việt',
    badge: '2D PHỤ ĐỀ'
  },
  'blue-lock': {
    title: 'BLUE LOCK: THE MOVIE - EPISODE NAGI',
    format: '2D Phụ đề Tiếng Việt',
    badge: '2D PHỤ ĐỀ'
  },
  'ut-lan-2': {
    title: 'ÚT LAN 2',
    format: '2D Phụ đề Tiếng Anh',
    badge: '2D PHỤ ĐỀ'
  },
  'co-dau-hao-mon': {
    title: 'ÚT LAN 2',
    format: '2D Phụ đề Tiếng Anh',
    badge: '2D PHỤ ĐỀ'
  },
  'suzume': {
    title: 'KHÓA CHẶT CỬA NÀO SUZUME',
    format: '2D Phụ đề Tiếng Việt',
    badge: '2D PHỤ ĐỀ'
  },
  'ca-voi-nuot-chung': {
    title: 'CÁ VOI NUỐT CHỬNG',
    format: '2D Phụ đề Tiếng Việt',
    badge: '2D PHỤ ĐỀ'
  },
  'me-min': {
    title: 'MẸ MÌN: LỜI NGUYỀN HUYẾT NGẢI',
    format: '2D Phụ đề Tiếng Anh',
    badge: '2D PHỤ ĐỀ'
  },
  'shaun-the-sheep': {
    title: 'SHAUN THE SHEEP: CHUYẾN PHIÊU LƯU NGOÀI HÀNH TINH',
    format: '2D Lồng Tiếng',
    badge: '2D LỒNG TIẾNG'
  }
};

function resolveMovie(key) {
  if (window.Pay && Pay.getMovie) return Pay.getMovie(key);
  const clean = String(key || '').trim().toLowerCase();
  return MOVIE_CATALOG_FALLBACK[clean] || MOVIE_CATALOG_FALLBACK['trai-buon-nguoi'] || {
    title: String(key).toUpperCase(),
    format: '2D Phụ đề',
    badge: '2D PHỤ ĐỀ'
  };
}

// Hiển thị danh sách Combo bắp nước động chuẩn xác
function renderTicketCombos(combosData) {
  let parsed = {};
  if (typeof combosData === 'string' && combosData.trim()) {
    try {
      parsed = JSON.parse(decodeURIComponent(combosData));
    } catch (e) {
      try { parsed = JSON.parse(combosData); } catch (e2) {}
    }
  } else if (typeof combosData === 'object' && combosData !== null) {
    parsed = combosData;
  }

  const COMBO_MAP = {
    solo: { name: 'Combo Solo', desc: '1 Bắp lớn + 1 Nước lớn' },
    couple: { name: 'Beta Couple', desc: '1 Bắp caramel/phô mai lớn + 2 Nước lớn' },
    party: { name: 'Combo Party Gold', desc: '2 Bắp lớn + 3 Nước lớn + 1 Snack' },
    family: { name: 'Combo Siêu Nhóm (Family)', desc: '2 Bắp lớn + 3 Nước lớn + 1 Snack' },
    sausage: { name: 'Xúc Xích Nướng Phô Mai', desc: '1 Que xúc xích nướng' }
  };

  const items = [];
  for (const key in parsed) {
    const qty = Number(parsed[key]) || 0;
    if (qty > 0) {
      const info = COMBO_MAP[key] || { name: key, desc: '' };
      const qtyStr = qty < 10 ? '0' + qty : qty;
      const descStr = info.desc ? ' (' + info.desc + ')' : '';
      items.push(qtyStr + 'x ' + info.name + descStr);
    }
  }

  const rowEl = document.getElementById('ticket-combo-row');
  const detailEl = document.getElementById('ticket-combo-detail');

  if (items.length > 0) {
    if (rowEl) rowEl.style.display = 'flex';
    if (detailEl) detailEl.textContent = items.join(' + ');
    const badge = rowEl ? rowEl.querySelector('span') : null;
    if (badge) badge.style.display = '';
  } else {
    if (detailEl) detailEl.textContent = 'Không kèm combo bắp nước';
    const badge = rowEl ? rowEl.querySelector('span') : null;
    if (badge) badge.style.display = 'none';
  }
}

// Lưu vé thành ảnh PNG (thông tin vé + mã vạch soát vé) để mở nhanh tại quầy khi không có mạng
async function saveTicketImage() {
  const btn = document.getElementById('btn-save-ticket');
  const txt = (id) => ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const barText = window.__ticketBarcode;
  if (!barText || !window.BetaBarcode) { alert('Vé chưa có mã vạch. Vui lòng đợi trang tải xong rồi thử lại.'); return; }
  if (btn) btn.disabled = true;
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const W = 720, P = 44, S = 2;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = 1120 * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    const font = (w, px) => `${w} ${px}px "Be Vietnam Pro", "Segoe UI", Arial, sans-serif`;
    const wrap = (text, x, y, maxW, lh) => {
      const words = String(text).split(' ');
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
      }
      if (line) { g.fillText(line, x, y); y += lh; }
      return y;
    };
    // nền + đầu vé
    g.fillStyle = '#f1f5f9'; g.fillRect(0, 0, W, 1120);
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(20, 20, W - 40, 1080, 24); g.fill();
    g.fillStyle = '#005198'; g.beginPath(); g.roundRect(20, 20, W - 40, 110, [24, 24, 0, 0]); g.fill();
    g.fillStyle = '#ffffff'; g.font = font(900, 30); g.fillText('BETA CINEMAS', P, 82);
    g.font = font(600, 15); g.textAlign = 'right'; g.fillText('VÉ XEM PHIM ĐIỆN TỬ', W - P, 82); g.textAlign = 'left';
    // phim
    let y = 182;
    g.fillStyle = '#0f172a'; g.font = font(900, 28);
    y = wrap(txt('ticket-movie-title'), P, y, W - 2 * P, 36);
    g.fillStyle = '#0369a1'; g.font = font(700, 16); g.fillText(txt('ticket-badge-format'), P, y + 4); y += 40;
    // các ô thông tin
    const field = (label, value, x, yy, w, color) => {
      g.fillStyle = '#64748b'; g.font = font(700, 13); g.fillText(label.toUpperCase(), x, yy);
      g.fillStyle = color || '#0f172a'; g.font = font(800, 19);
      return wrap(value || '—', x, yy + 28, w, 26);
    };
    const half = (W - 2 * P - 24) / 2;
    const y1 = field('Rạp chiếu', txt('ticket-cinema-name'), P, y, half, '#005198');
    const y2 = field('Phòng chiếu', txt('ticket-hall-name'), P + half + 24, y, half);
    y = Math.max(y1, y2) + 18;
    const y3 = field('Suất chiếu', txt('ticket-showtime'), P, y, half, '#c2410c');
    const y4 = field('Ghế', txt('ticket-seats-list'), P + half + 24, y, half, '#005198');
    y = Math.max(y3, y4) + 18;
    y = field('Tổng tiền', txt('ticket-total-price'), P, y, W - 2 * P, '#c2410c') + 10;
    // đường xé vé
    g.strokeStyle = '#cbd5e1'; g.setLineDash([8, 8]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(P, y + 10); g.lineTo(W - P, y + 10); g.stroke(); g.setLineDash([]);
    y += 44;
    // mã vạch (vẽ thẳng lên canvas, mỗi module là số nguyên điểm ảnh để vạch sắc nét)
    BetaBarcode.draw(g, barText, P, y, W - 2 * P, 150);
    y += 150 + 44;
    g.textAlign = 'center';
    g.fillStyle = '#0f172a'; g.font = '800 24px "Courier New", monospace';
    g.fillText(txt('ticket-barcode-num') || txt('ticket-order-code-foot'), W / 2, y); y += 32;
    g.fillStyle = '#64748b'; g.font = font(500, 14);
    g.fillText('Đưa mã vạch này cho nhân viên soát vé. Mỗi vé chỉ dùng được một lần.', W / 2, y); y += 22;
    g.fillText('Khách hàng: ' + (txt('ticket-card-customer') || txt('ticket-customer-name')), W / 2, y);
    g.textAlign = 'left';

    // cắt bỏ phần trống phía dưới theo chiều cao nội dung thật
    const H = Math.min(1120, Math.ceil(y + 40));
    const out = document.createElement('canvas');
    out.width = W * S; out.height = (H + 20) * S;
    const o2 = out.getContext('2d');
    o2.fillStyle = '#f1f5f9'; o2.fillRect(0, 0, out.width, out.height);
    o2.drawImage(c, 0, 0, W * S, H * S, 0, 0, W * S, H * S);
    const code = (txt('ticket-order-code-foot') || 've').replace(/[^\w-]/g, '');
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    const file = new File([blob], 've-' + code + '.png', { type: 'image/png' });
    // Điện thoại: dùng bảng chia sẻ để lưu vào Ảnh; máy tính: tải file về
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: 'Vé Beta Cinemas ' + code });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') alert('Không lưu được ảnh vé: ' + e.message + '. Bạn có thể chụp màn hình mã vạch thay thế.');
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveTicketImage = saveTicketImage;

// Lịch & lời mời (Đợt 5)
let ORDER_FOR_CAL = null;
function calInfo() {
  const o = ORDER_FOR_CAL;
  const title = (o.movie && o.movie.title) || document.getElementById('ticket-movie-title').textContent.trim();
  const start = new Date(o.show_at);
  const end = new Date(start.getTime() + ((o.movie && o.movie.duration_min) || 120) * 60000 + 15 * 60000);
  return { o, title, start, end, where: o.cinema + (CINEMA_ADDRESSES[o.cinema] ? ', ' + CINEMA_ADDRESSES[o.cinema] : '') };
}
function addToCalendar() {
  const c = calInfo();
  const ics = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Beta Cinemas//Ve xem phim//VI', 'BEGIN:VEVENT',
    'UID:' + c.o.code + '@betacinemas', 'DTSTAMP:' + ics(new Date()), 'DTSTART:' + ics(c.start), 'DTEND:' + ics(c.end),
    'SUMMARY:' + esc('🎬 ' + c.title), 'LOCATION:' + esc(c.where),
    'DESCRIPTION:' + esc('Ghế ' + (c.o.seats || []).join(', ') + ' · Mã đơn ' + c.o.code + '. Mở vé (mã vạch) trong mục Tài khoản trước khi vào rạp.'),
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('1 giờ nữa: ' + c.title), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  a.download = 've-' + c.o.code + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
}
async function inviteFriends() {
  const c = calInfo();
  const when = c.start.toLocaleString('vi-VN', { weekday: 'long', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  const text = 'Đi xem "' + c.title + '" cùng mình nhé! ' + when + ' tại ' + c.o.cinema + ', ghế ' + (c.o.seats || []).join(', ') + '.';
  const url = location.origin + '/phim/' + encodeURIComponent(c.o.movie_key);
  try {
    if (navigator.share) await navigator.share({ title: c.title, text, url });
    else { await navigator.clipboard.writeText(text + ' ' + url); alert('Đã sao chép lời mời – dán vào Zalo / Messenger để gửi bạn bè.'); }
  } catch (e) { if (e && e.name !== 'AbortError') alert('Không chia sẻ được: ' + e.message); }
}
window.addToCalendar = addToCalendar;
window.inviteFriends = inviteFriends;

function applyOrderToTicket(ord) {
  if (!ord) return;
  if (ord.kind !== 'FNB' && ord.show_at) {
    ORDER_FOR_CAL = ord;
    document.getElementById('btn-add-cal').hidden = false;
    document.getElementById('btn-invite').hidden = false;
  }
  const movieObj = ord.kind === 'FNB' ? Pay.FNB_MOVIE : resolveMovie(ord.movie_key);
  if (ord.kind === 'FNB') {
    // Đơn bắp nước: không có suất / ghế – nhân viên quầy quét mã vạch để giao món
    document.getElementById('ticket-seats-list').textContent = 'Không có ghế';
    document.getElementById('ticket-showtime').textContent = 'Nhận tại quầy trong 30 ngày kể từ ngày mua';
    const cls = document.getElementById('ticket-seat-class');
    if (cls) cls.textContent = 'PHIẾU BẮP NƯỚC';
    const hall = document.getElementById('ticket-hall-name');
    if (hall) { hall.textContent = 'Quầy bắp nước'; const lb = hall.previousElementSibling; if (lb) lb.textContent = 'Nơi nhận'; }
    const st = document.getElementById('ticket-showtime');
    if (st && st.previousElementSibling) st.previousElementSibling.textContent = 'Thời hạn nhận';
    const h1 = document.querySelector('main h1');
    if (h1) h1.textContent = 'Đặt Bắp Nước Thành Công!';
    document.querySelectorAll('main div').forEach((d) => {
      if (d.children.length === 0 && /^Đưa mã vạch này cho nhân viên soát vé/.test(d.textContent.trim())) d.textContent = 'Đưa mã vạch này cho nhân viên quầy bắp nước để nhận món. Mỗi phiếu chỉ dùng được một lần.';
    });
  }
  if (movieObj) {
    document.getElementById('ticket-movie-title').textContent = movieObj.title;
    document.getElementById('ticket-movie-format').textContent = movieObj.format;
    document.getElementById('ticket-badge-format').textContent = movieObj.badge;
  }

  if (ord.cinema) {
    document.getElementById('ticket-cinema-name').textContent = ord.cinema;
    if (CINEMA_ADDRESSES[ord.cinema]) {
      document.getElementById('ticket-cinema-address').textContent = CINEMA_ADDRESSES[ord.cinema];
    }
  }

  if (ord.show_time || ord.show_date) {
    document.getElementById('ticket-showtime').textContent = [ord.show_time, ord.show_date].filter(Boolean).join(' • ');
  }

  // Phòng chiếu + định dạng lấy từ suất chiếu thật
  if (ord.showtime_id && Pay.getShowtime) {
    Pay.getShowtime(ord.showtime_id).then((st) => {
      if (!st) return;
      const hall = document.getElementById('ticket-hall-name');
      if (hall) hall.textContent = st.room || '—';
      if (st.format) document.getElementById('ticket-badge-format').textContent = st.format;
    }).catch(() => {});
  }

  if (ord.seats && ord.seats.length > 0) {
    const s = Array.isArray(ord.seats) ? ord.seats.join(', ') : ord.seats;
    const count = Array.isArray(ord.seats) ? ord.seats.length : ord.seats.split(',').length;
    document.getElementById('ticket-seats-list').textContent = s + ' (' + count + ' ghế)';
    // Vé ưu đãi theo đối tượng: nhắc khách mang giấy tờ khi vào rạp
    const special = Object.entries(ord.ticket_types || {}).filter(([, c]) => c && c !== 'ADULT' && c !== 'COUPLE');
    if (special.length) {
      Pay.pricing().then(pr => {
        const T = (pr && pr.ticket_types) || BetaCatalog.TICKET_TYPES;
        const el = document.getElementById('ticket-seats-list');
        const note = document.createElement('div');
        note.style.cssText = 'font-size: 12.5px; font-weight: 700; color: #92400e; margin-top: 4px;';
        note.textContent = 'Vé ưu đãi: ' + special.map(([seat, c]) => seat + ' – ' + ((T[c] || {}).label || c)).join(', ') + '. Vui lòng mang giấy tờ để nhân viên kiểm tra.';
        el.after(note);
      });
    }
    // Nhãn hạng vé theo ghế thật (thường / VIP / Sweetbox)
    const types = new Set((Array.isArray(ord.seats) ? ord.seats : String(ord.seats).split(',')).map((x) => window.BetaCatalog ? BetaCatalog.seatType(x) : null));
    const cls = document.getElementById('ticket-seat-class');
    if (cls) cls.textContent = types.has('sweetbox') ? 'VÉ SWEETBOX' : types.has('vip') ? 'VÉ VIP' : 'VÉ ĐIỆN TỬ';
  }

  if (ord.total) {
    document.getElementById('ticket-total-price').textContent = window.Pay ? Pay.vnd(ord.total) : new Intl.NumberFormat('vi-VN').format(ord.total) + ' đ';
  }

  if (ord.combos) {
    renderTicketCombos(ord.combos);
  }

  if (ord.code) {
    const codeClean = ord.code.replace(/\s/g, '');
    const parts = codeClean.match(/.{1,4}/g);
    if (parts) {
      document.getElementById('ticket-barcode-num').textContent = parts.join(' ');
    }
  }

  const custName = ord.customer_name || 'Khách hàng';
  const custEmail = ord.email || '(chưa có email)';
  const custPhone = ord.phone || '(chưa có SĐT)';

  const custNameEl = document.getElementById('ticket-customer-name');
  if (custNameEl) custNameEl.textContent = custName;
  const cardCustEl = document.getElementById('ticket-card-customer');
  if (cardCustEl) cardCustEl.textContent = custName;
  const custEmailEl = document.getElementById('ticket-customer-email');
  if (custEmailEl) custEmailEl.textContent = custEmail;
  const custPhoneEl = document.getElementById('ticket-customer-phone');
  if (custPhoneEl) custPhoneEl.textContent = custPhone;

  // Mã vạch Code 128 ký số (máy chủ cấp) cho nhân viên quầy quét – Đợt 11 thay mã QR
  const barText = ord.ticket_barcode || ord.ticket_qr; // vé lưu offline từ trước chỉ có nội dung QR cũ – quầy vẫn nhận
  if (barText && window.BetaBarcode) {
    window.__ticketBarcode = barText;
    const box = document.getElementById('ticket-barcode');
    box.innerHTML = '<div style="width: 100%; max-width: 420px;">' + BetaBarcode.svg(barText, { height: 84 }) + '</div>';
  }
  // Chỉ chủ vé (đăng nhập đúng tài khoản đặt vé) mới thấy mã vạch vào rạp
  if (ord.limited) {
    const box = document.getElementById('ticket-barcode');
    const next = encodeURIComponent('ticket.html?order=' + ord.code);
    box.innerHTML = '<div style="padding: 14px; text-align: center; color: #475569; font-size: 14px; line-height: 1.5;"><i class=ph-lock aria-hidden=true></i> Mã vạch vào rạp chỉ hiện với tài khoản đã đặt vé.<br><a href="auth.html?next=' + next + '#login" style="font-weight: 700; color: #005198;">Đăng nhập để xem mã vạch →</a></div>';
  }
  const ck = document.getElementById('ticket-checkin-state');
  if (ck && ord.checked_in_at) { ck.style.display = 'block'; ck.textContent = '✓ Vé đã được soát lúc ' + new Date(ord.checked_in_at).toLocaleString('vi-VN'); }
  const foot = document.getElementById('ticket-order-code-foot');
  if (foot) foot.textContent = ord.code;
  const ca = document.getElementById('ticket-created-at');
  if (ca && ord.created_at) ca.textContent = new Date(ord.created_at).toLocaleString('vi-VN');

  if (ord.status === 'CONFIRMED_LATE') {
    const noteEl = document.getElementById('ticket-pay-status-note');
    if (noteEl) noteEl.textContent = '✓ Đã thanh toán (Cấp bù vé VietQR)';
  }
}

// 1. Áp dụng ngay từ URL parameters nếu có
if (movieParam) {
  const movieObj = resolveMovie(movieParam);
  document.getElementById('ticket-movie-title').textContent = movieObj.title;
  document.getElementById('ticket-movie-format').textContent = movieObj.format;
  document.getElementById('ticket-badge-format').textContent = movieObj.badge;
}

if (cinemaParam) {
  const c = decodeURIComponent(cinemaParam);
  document.getElementById('ticket-cinema-name').textContent = c;
  if (CINEMA_ADDRESSES[c]) document.getElementById('ticket-cinema-address').textContent = CINEMA_ADDRESSES[c];
}

if (timeParam || dateParam) {
  document.getElementById('ticket-showtime').textContent = [timeParam, dateParam].filter(Boolean).join(' • ');
}

if (seatsParam) {
  const s = decodeURIComponent(seatsParam);
  const count = s.split(',').length;
  document.getElementById('ticket-seats-list').textContent = s + ' (' + count + ' ghế)';
}

if (totalParam) {
  const numTotal = parseInt(String(totalParam).replace(/\D/g, '')) || 0;
  if (numTotal > 0) {
    document.getElementById('ticket-total-price').textContent = new Intl.NumberFormat('vi-VN').format(numTotal) + ' đ';
  }
}

// Render combo từ query params ngay khi vào trang
if (combosParam) {
  renderTicketCombos(combosParam);
} else {
  // Đọc từ LocalStorage nếu có đơn lưu trước đó
  if (window.Pay && orderParam) {
    const local = Pay.getLocalOrder ? Pay.getLocalOrder(orderParam) : null;
    if (local && local.combos) {
      renderTicketCombos(local.combos);
    }
  }
}

// 2. Tra cứu chi tiết đơn hàng từ API hoặc Storage
if (orderParam && window.Pay && Pay.getOrder) {
  Pay.getOrder(orderParam).then(ord => {
    // Chỉ hiển thị vé khi đơn đã CONFIRMED / CONFIRMED_LATE; trạng thái khác chuyển sang trang theo dõi đơn
    if (ord && ord.has_ticket === false) { location.replace('order.html?code=' + encodeURIComponent(ord.code)); return; }
    if (!ord) {
      ticketMain.innerHTML = '<div style="max-width:520px;margin:60px auto;text-align:center;padding:32px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;"><h2>Không tìm thấy vé</h2><p style="color:#64748b;margin:8px 0 20px;">Mã đơn không tồn tại hoặc máy chủ đang bận. Vui lòng thử lại sau.</p><a class="btn btn-primary" href="account.html">Về lịch sử đơn hàng</a></div>';
    } else {
      applyOrderToTicket(ord);
    }
    ticketMain.style.visibility = 'visible';
  }).catch(e => console.warn('Lỗi lấy đơn hàng ticket:', e.message));
}
// Nút gửi lại vé (data-on-click="resendThisTicket(this)"): mã đơn lấy từ ?order=
function resendThisTicket(btn) { Pay.resendTicketUI(new URLSearchParams(location.search).get('order'), btn); }
