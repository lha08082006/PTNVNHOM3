// js/home.js - mã của home.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
let currentSlideIndex = 0;
let slides = document.querySelectorAll('.slider-item');
let dots = document.querySelectorAll('.slider-dot');
let autoSlideTimer = null;

function showSlide(n) {
  if (n >= slides.length) currentSlideIndex = 0;
  else if (n < 0) currentSlideIndex = slides.length - 1;
  else currentSlideIndex = n;

  slides.forEach(s => s.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));

  slides[currentSlideIndex].classList.add('active');
  dots[currentSlideIndex].classList.add('active');
  slides.forEach((s, i) => s.setAttribute('aria-hidden', i === currentSlideIndex ? 'false' : 'true'));
  dots.forEach((d, i) => { if (i === currentSlideIndex) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
}

function changeSlide(step) {
  clearInterval(autoSlideTimer);
  showSlide(currentSlideIndex + step);
  startAutoSlide();
}

function setSlide(n) {
  clearInterval(autoSlideTimer);
  showSlide(n);
  startAutoSlide();
}

// Tự chuyển banner: có nút dừng, dừng khi hover/focus, tắt nếu người dùng bật "giảm chuyển động" (WCAG 2.2.2)
const sliderWrap = document.querySelector('.slider-official-wrap');
const pauseBtn = document.getElementById('slider-pause');
let autoSlidePaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let sliderHovered = false;

function startAutoSlide() {
  clearInterval(autoSlideTimer);
  if (autoSlidePaused || sliderHovered) return;
  autoSlideTimer = setInterval(() => {
    showSlide(currentSlideIndex + 1);
  }, 4000);
}

function updatePauseBtn() {
  pauseBtn.setAttribute('aria-label', autoSlidePaused ? 'Tiếp tục tự chuyển banner' : 'Tạm dừng tự chuyển banner');
  pauseBtn.firstElementChild.innerHTML = autoSlidePaused ? '<i class=ph-play aria-hidden=true></i>' : '<i class=ph-pause aria-hidden=true></i>';
}

function toggleAutoSlide() {
  autoSlidePaused = !autoSlidePaused;
  updatePauseBtn();
  if (autoSlidePaused) clearInterval(autoSlideTimer); else startAutoSlide();
}

const holdSlider = () => { sliderHovered = true; clearInterval(autoSlideTimer); };
const releaseSlider = () => { sliderHovered = false; startAutoSlide(); };
sliderWrap.addEventListener('mouseenter', holdSlider);
sliderWrap.addEventListener('mouseleave', releaseSlider);
sliderWrap.addEventListener('focusin', holdSlider);
sliderWrap.addEventListener('focusout', e => { if (!sliderWrap.contains(e.relatedTarget)) releaseSlider(); });

updatePauseBtn();
showSlide(0);
startAutoSlide();

// Đợt 10: banner do Quản lý đặt ở admin > Danh mục > Banner (ảnh máy tính + ảnh điện thoại, link khi bấm)
window.applyBanners = function (list) {
  if (!Array.isArray(list) || !list.length) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const wrap = document.querySelector('.slider-official-wrap');
  const before = wrap.querySelector('.slider-btn');
  wrap.querySelectorAll('.slider-item').forEach(n => n.remove());
  list.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'slider-item';
    const pic = `<picture>${b.image_mobile ? `<source media="(max-width: 640px)" srcset="${esc(b.image_mobile)}">` : ''}<img src="${esc(b.image)}" alt="${esc(b.title)}" width="1702" height="621" ${i ? 'loading="lazy" decoding="async"' : 'fetchpriority="high"'}></picture>`;
    item.innerHTML = b.link ? `<a href="${esc(b.link)}">${pic}</a>` : pic;
    wrap.insertBefore(item, before);
  });
  const box = wrap.querySelector('.slider-dots');
  box.innerHTML = list.map((b, i) => `<button type="button" class="slider-dot" data-on-click="setSlide(${i})" aria-label="Banner ${i + 1}: ${esc(b.title)}"></button>`).join('');
  box.hidden = list.length < 2;
  wrap.querySelectorAll('.slider-btn.prev, .slider-btn.next, .slider-btn.pause').forEach(x => { x.hidden = list.length < 2; });
  slides = wrap.querySelectorAll('.slider-item');
  dots = wrap.querySelectorAll('.slider-dot');
  showSlide(0);
  startAutoSlide();
};

function switchMovieTab(tab) {
  document.querySelectorAll('.movie-tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('tab-' + tab);
  if (activeBtn) activeBtn.classList.add('active');

  const cards = document.querySelectorAll('#movie-grid .movie-card');
  cards.forEach(card => {
    const cardTab = card.getAttribute('data-tab') || 'now';
    const tabList = cardTab.split(' ');
    const g = window.__genre || '';
    const genreOk = !g || (card.dataset.genre || '').toLowerCase().split(',').map(x => x.trim()).includes(g.toLowerCase());
    if ((tabList.includes(tab) || tabList.includes('all')) && genreOk) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
  const grid = document.getElementById('movie-grid');
  if (grid && grid.classList.contains('syncing')) return; // đang tải danh sách thật
  const shown = [...cards].filter(c => c.style.display !== 'none').length;
  let empty = document.getElementById('movie-empty');
  if (!empty && grid) { empty = document.createElement('div'); empty.id = 'movie-empty'; empty.className = 'movie-empty'; empty.setAttribute('role', 'status'); grid.after(empty); }
  if (!empty) return;
  empty.hidden = shown > 0;
  if (!shown) {
    const msg = window.__genre ? 'Chưa có phim thể loại này ở mục đang xem.' : tab === 'soon' ? 'Chưa có phim sắp chiếu – quay lại sau nhé' : tab === 'special' ? 'Chưa có suất chiếu đặc biệt nào.' : 'Chưa có phim nào.';
    empty.innerHTML = '<p>' + msg + '</p>' + (tab !== 'now' ? '<button type="button" class="btn btn-primary" data-on-click="switchMovieTab(\'now\')">Xem phim đang chiếu</button>' : '');
  }
}

// ====================================================================================
// 🎬 CẤU HÌNH LINK YOUTUBE TRAILER CÁC PHIM (BẠN TỰ THAY LINK CỦA BẠN TẠI ĐÂY)
// ====================================================================================
// Bạn có thể dán link trực tiếp vào đây hoặc vào thuộc tính data-trailer trong thẻ <button>
// Hỗ trợ tất cả dạng link:
//   - https://www.youtube.com/watch?v=...
//   - https://youtu.be/...
//   - https://www.youtube.com/embed/...
//   - hoặc chỉ cần mã ID video YouTube (ví dụ: 'yY13kvdVpvg')
// ====================================================================================
const MOVIE_TRAILERS = {
  // 1. Phim: LINH GIỚI ĐẠI CHIẾN: THẦN SƯ CHUNG QUỲ
  'linh-gioi-dai-chien': 'https://www.youtube.com/watch?v=mJ2pu6FazEA',
  'dia-dao': 'https://www.youtube.com/watch?v=mJ2pu6FazEA', // alias dự phòng

  // 2. Phim: QUỶ ĂN TẠNG 4: LỜI NGUYỀN TRỞ LẠI
  'quy-an-tang-4': 'https://www.youtube.com/watch?v=7eRbgbj_AfM',

  // 3. Phim: TRẠI BUÔN NGƯỜI: VÙNG CẤM BIÊN GIỚI
  'trai-buon-nguoi': 'https://www.youtube.com/watch?v=TUzx32ejTlY&t=2s',

  // 4. Phim: BLUE LOCK: THE MOVIE - EPISODE NAGI
  'blue-lock': 'https://www.youtube.com/watch?v=8VMMDfAYi34',

  // 5. Phim: ÁN MẠNG KARAOKE
  'an-mang-karaoke': 'https://www.youtube.com/watch?v=aV4qtcKmkQo',

  // 6. Phim: ÚT LAN 2 (CÔ DÂU HÀO MÔN)
  'ut-lan-2': 'https://www.youtube.com/watch?v=TpwGd81RSKk',
  'co-dau-hao-mon': 'https://www.youtube.com/watch?v=TpwGd81RSKk', // alias dự phòng

  // 7. Phim: KHÓA CHẶT CỬA NÀO SUZUME
  'suzume': 'https://www.youtube.com/watch?v=EWLo2IF_NPU',

  // 8. Phim: CÁ VOI NUỐT CHỬNG
  'ca-voi-nuot-chung': 'https://www.youtube.com/watch?v=ZyGPPlhPI8M',

  // 9. Phim: MẸ MÌN
  'me-min': 'https://www.youtube.com/watch?v=mTylSVV6zSo',

  // 10. Phim: SHAUN THE SHEEP – chưa có trailer chính thức (Quản lý nhập ở admin > Danh mục > Phim nếu có)
};

/**
 * Tự động trích xuất YouTube Video ID từ link bất kỳ
 */
function extractYouTubeVideoId(input) {
  if (!input) return '';
  input = input.trim();
  // Nếu là mã Video ID 11 ký tự
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  // Trích xuất ID từ mọi dạng link YouTube thông dụng
  const match = input.match(/(?:youtu\.be\/|(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : '';
}

/**
 * Mở popup phát Trailer YouTube
 * @param {string} movieId Mã định danh phim (key trong MOVIE_TRAILERS)
 * @param {string} movieTitle Tên phim hiển thị trên tiêu đề modal
 * @param {HTMLElement} [triggerEl] Nút bấm kích hoạt (để đọc data-trailer nếu có)
 */

let currentActiveWatchUrl = '';

function openExternalYouTube() {
  if (currentActiveWatchUrl) {
    window.open(currentActiveWatchUrl, '_blank');
  }
}


function openTrailerModal(movieId, movieTitle, triggerEl) {
  const modal = document.getElementById('trailer-modal');
  const iframe = document.getElementById('trailer-iframe');
  const titleEl = document.getElementById('trailer-modal-title');
  const ytbLinkEl = document.getElementById('trailer-modal-ytb-link');

  // 1. Lấy link YouTube: ưu tiên thuộc tính data-trailer của nút, sau đó đến MOVIE_TRAILERS
  let rawUrl = '';
  if (triggerEl && triggerEl.getAttribute('data-trailer')) {
    rawUrl = triggerEl.getAttribute('data-trailer').trim();
  }
  if (!rawUrl && MOVIE_TRAILERS[movieId]) {
    rawUrl = MOVIE_TRAILERS[movieId].trim();
  }
  if (!rawUrl) return; // phim chưa có trailer: không mở khung xem

  // 2. Trích xuất ID và cấu hình Embed URL
  const videoId = extractYouTubeVideoId(rawUrl);
  // Cấu hình URL nhúng chuẩn YouTube với origin và playsinline
  let embedUrl = rawUrl;
  if (videoId) {
    const originParam = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
      ? `&origin=${encodeURIComponent(window.location.origin)}`
      : '';
    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&vq=hd1080&hd=1${originParam}`;
  }
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : rawUrl;

  // 3. Gán dữ liệu vào modal
  if (titleEl) titleEl.textContent = movieTitle || 'Trailer phim';
  if (ytbLinkEl) ytbLinkEl.href = watchUrl;
  currentActiveWatchUrl = watchUrl;

  const fallback = document.getElementById('trailer-file-fallback');
  const fallbackThumb = document.getElementById('trailer-fallback-thumb');
  const fallbackTitle = document.getElementById('trailer-fallback-title');
  const warn = document.getElementById('trailer-file-protocol-warning');

  if (window.location.protocol === 'file:') {
    // Giao thức file://: YouTube chặn nhúng gây lỗi 153 -> Hiển thị thumbnail preview 1-click thông minh
    if (iframe) {
      iframe.style.display = 'none';
      iframe.src = '';
    }
    if (fallback) {
      fallback.style.display = 'block';
      if (fallbackThumb && videoId) {
        fallbackThumb.src = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
      }
      if (fallbackTitle) {
        fallbackTitle.textContent = movieTitle || 'Trailer Phim';
      }
    }
    if (warn) warn.style.display = 'block';
  } else {
    // Giao thức http:// hoặc https:// (Localhost / Vercel): Phát trực tiếp qua iframe
    if (fallback) fallback.style.display = 'none';
    if (iframe) {
      iframe.style.display = 'block';
      iframe.src = embedUrl;
    }
    if (warn) warn.style.display = 'none';
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/**
 * Đóng popup trailer và NGẮT TIẾNG / NGỪNG PHÁT video ngay lập tức
 */
function closeTrailerModal() {
  const modal = document.getElementById('trailer-modal');
  const iframe = document.getElementById('trailer-iframe');

  if (modal) {
    modal.classList.remove('open');
  }
  // Quan trọng: xóa src của iframe để lập tức ngắt tiếng và dừng phát
  if (iframe) {
    iframe.src = '';
  }
  // Khôi phục thanh cuộn cho trang web
  document.body.style.overflow = '';
}

/**
 * Bấm ra vùng backdrop bên ngoài để đóng modal
 */
function handleTrailerBackdropClick(event) {
  if (event.target.id === 'trailer-modal') {
    closeTrailerModal();
  }
}

// Đóng trailer khi người dùng nhấn phím ESC
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape' || event.key === 'Esc') {
    const modal = document.getElementById('trailer-modal');
    if (modal && modal.classList.contains('open')) {
      closeTrailerModal();
    }
  }
});
