// js/movie-trailer.js - mã của movie-detail.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
const MOVIE_TRAILERS = {
  'linh-gioi-dai-chien': 'https://www.youtube.com/watch?v=mJ2pu6FazEA',
  'dia-dao': 'https://www.youtube.com/watch?v=mJ2pu6FazEA',
  'quy-an-tang-4': 'https://www.youtube.com/watch?v=7eRbgbj_AfM',
  'trai-buon-nguoi': 'https://www.youtube.com/watch?v=TUzx32ejTlY&t=2s',
  'blue-lock': 'https://www.youtube.com/watch?v=8VMMDfAYi34',
  'an-mang-karaoke': 'https://www.youtube.com/watch?v=aV4qtcKmkQo',
  'ut-lan-2': 'https://www.youtube.com/watch?v=TpwGd81RSKk',
  'co-dau-hao-mon': 'https://www.youtube.com/watch?v=TpwGd81RSKk',
  'suzume': 'https://www.youtube.com/watch?v=EWLo2IF_NPU',
  'ca-voi-nuot-chung': 'https://www.youtube.com/watch?v=ZyGPPlhPI8M',
  'me-min': 'https://www.youtube.com/watch?v=mTylSVV6zSo'
};

function extractYouTubeVideoId(input) {
  if (!input) return '';
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const match = input.match(/(?:youtu\.be\/|(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : '';
}


let currentActiveWatchUrl = '';

function openExternalYouTube() {
  if (currentActiveWatchUrl) {
    window.open(currentActiveWatchUrl, '_blank');
  }
}


function openTrailerModal(movieKey, movieTitle) {
  const trailerUrl = MOVIE_TRAILERS[movieKey] || 'https://www.youtube.com/watch?v=mJ2pu6FazEA';
  const videoId = extractYouTubeVideoId(trailerUrl);

  const modal = document.getElementById('trailer-modal');
  const titleElem = document.getElementById('trailer-modal-movie-name');
  const iframe = document.getElementById('trailer-iframe');
  const ytbLink = document.getElementById('trailer-modal-ytb-link');

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : trailerUrl;
  const originParam = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? `&origin=${encodeURIComponent(window.location.origin)}`
    : '';
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&vq=hd1080&hd=1${originParam}`
    : trailerUrl;

  if (titleElem) titleElem.textContent = movieTitle || 'Trailer Phim';
  if (ytbLink) ytbLink.href = watchUrl;
  currentActiveWatchUrl = watchUrl;

  const fallback = document.getElementById('trailer-file-fallback');
  const fallbackThumb = document.getElementById('trailer-fallback-thumb');
  const fallbackTitle = document.getElementById('trailer-fallback-title');
  const warn = document.getElementById('trailer-file-protocol-warning');

  if (window.location.protocol === 'file:') {
    if (iframe) {
      iframe.style.display = 'none';
      iframe.src = '';
    }
    if (fallback) {
      fallback.style.display = 'block';
      if (fallbackThumb && videoId) {
        fallbackThumb.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      }
      if (fallbackTitle) {
        fallbackTitle.textContent = movieTitle || 'Trailer Phim';
      }
    }
    if (warn) warn.style.display = 'block';
  } else {
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

function closeTrailerModal() {
  const modal = document.getElementById('trailer-modal');
  const iframe = document.getElementById('trailer-iframe');
  if (modal) modal.classList.remove('open');
  if (iframe) iframe.src = '';
  document.body.style.overflow = '';
}

function handleBackdropClick(e) {
  if (e.target && e.target.id === 'trailer-modal') {
    closeTrailerModal();
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' || e.key === 'Esc') {
    const modal = document.getElementById('trailer-modal');
    if (modal && modal.classList.contains('open')) {
      closeTrailerModal();
    }
  }
});
