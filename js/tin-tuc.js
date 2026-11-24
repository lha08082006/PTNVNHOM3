// js/tin-tuc.js - mã của tin-tuc.html (tách khỏi <script> inline: CSP không cho chạy script viết thẳng trong HTML)
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('vi-VN') : '';
  const until = (p) => p.ends_at ? 'Đến hết ' + fmtDate(p.ends_at) : '';
  const img = (p) => p.image || 'images/logo-official.png';
  // Ảnh banner 1702px của web có sẵn bản 800px (tools/optimize-images.js) -> thẻ tin dùng bản nhỏ
  const small = (p) => /^images\/[^/]*1702x621[^/]*\.webp$/.test(p.image || '') ? p.image.replace(/\.webp$/, '-800w.webp') : img(p);
  const params = new URLSearchParams(location.search);

  // Chi tiết một bài: ?id=<mã bài>
  const id = params.get('id');
  if (id) {
    $('tt-list-view').hidden = true;
    const box = $('tt-detail-view');
    box.hidden = false;
    try {
      const { post: p } = await Pay.catalog('post', { id });
      document.title = p.title + ' - Beta Cinemas';
      const md = document.querySelector('meta[name="description"]');
      if (md) md.content = p.summary || p.title;
      // Nội dung là chữ thuần: mỗi đoạn (cách nhau dòng trống) thành một <p>, không chèn HTML
      const paras = String(p.body || p.summary || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
      box.className = 'tt-detail';
      box.innerHTML = `<img src="${esc(img(p))}" alt="" data-fallback="none">
            <div class="b">
              <span class="tt-badge ${esc(p.type)}">${esc(p.type_label)}</span>
              <h1>${esc(p.title)}</h1>
              <p class="tt-meta">${esc(fmtDate(p.created_at))}${until(p) ? ' · ' + esc(until(p)) : ''}</p>
              ${p.summary ? `<p style="font-weight:700;font-size:15.5px;line-height:1.6;">${esc(p.summary)}</p>` : ''}
              <div class="body">${paras.map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}</div>
              <div class="tt-cta">
                <a class="btn btn-primary" href="${p.movie_id ? 'phim/' + encodeURIComponent(p.movie_id) : p.cinema_id ? 'schedule.html?cinema=' + encodeURIComponent(p.cinema_id) : 'schedule.html'}"><i class="ph-ticket" aria-hidden="true"></i> Đặt vé ngay</a>
                <a class="btn btn-outline" href="tin-tuc.html">← Tất cả tin & ưu đãi</a>
              </div>
            </div>`;
    } catch (e) {
      box.innerHTML = `<h1>Không tìm thấy bài viết</h1><p class="m">Bài viết không tồn tại hoặc ưu đãi đã kết thúc.</p><p><a class="btn btn-outline" href="tin-tuc.html">← Xem tin & ưu đãi khác</a></p>`;
    }
    return;
  }

  // Danh sách + lọc theo loại
  let all = [], types = {}, current = (params.get('type') || '').toUpperCase();
  const draw = () => {
    $('tt-tabs').innerHTML = [['', 'Tất cả'], ...Object.entries(types)].map(([k, v]) =>
      `<button type="button" class="tt-tab" aria-pressed="${current === k}" data-k="${k}">${esc(v)}</button>`).join('');
    $('tt-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { current = b.dataset.k; draw(); });
    const list = all.filter(p => !current || p.type === current);
    $('tt-grid').innerHTML = list.length ? list.map(p => `
          <a class="tt-card" href="tin-tuc.html?id=${encodeURIComponent(p.id)}">
            <img loading="lazy" decoding="async" src="${esc(small(p))}" width="800" height="292" alt="" data-fallback="${esc(img(p))}">
            <div class="b">
              <span class="tt-badge ${esc(p.type)}">${p.pinned ? '<i class="ph-tag" aria-hidden="true"></i> Ghim · ' : ''}${esc(p.type_label)}</span>
              <h2>${esc(p.title)}</h2>
              ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
              ${until(p) ? `<span class="tt-meta">${esc(until(p))}</span>` : ''}
            </div>
          </a>`).join('') : '<p class="m">Chưa có bài viết nào trong mục này.</p>';
  };
  try {
    const r = await Pay.catalog('posts');
    all = r.posts; types = r.types;
    draw();
  } catch (e) {
    $('tt-grid').innerHTML = '<p class="m">Không tải được tin tức. <button type="button" class="btn btn-outline btn-sm" data-on-click="location.reload()">Thử lại</button></p>';
  }
})();
