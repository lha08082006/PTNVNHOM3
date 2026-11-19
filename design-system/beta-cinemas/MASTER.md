# Design System Master File — Beta Cinemas

> **LOGIC:** Khi làm một trang cụ thể, xem trước `design-system/beta-cinemas/pages/[page-name].md`.
> Nếu file đó tồn tại, quy tắc trong đó ghi đè file Master này. Nếu không, dùng file này.

**Project:** Beta Cinemas (website đặt vé xem phim + thanh toán VietQR/SePay)
**Stack:** HTML tĩnh + CSS thuần (`css/prototype-theme.css`) + JS thuần. Không dùng framework.
**Nguồn token:** `:root` trong `css/prototype-theme.css` — luôn dùng biến CSS, không viết mã hex mới trong trang.

---

## Global Rules

### Color Palette (nhận diện Beta — giữ nguyên)

| Role | Hex | CSS Variable | Ghi chú |
|------|-----|--------------|---------|
| Primary (Navy) | `#005198` | `--beta-navy` | Header, link, nút chính, ghế VIP |
| Primary dark | `#003768` | `--beta-navy-dark` | Hover/active của navy |
| Primary soft | `#f0f7ff` | `--beta-blue-soft` | Nền khối thông tin |
| Accent / CTA | `#ff5400` | `--beta-orange` | Nút "Đặt vé", giá tiền, nhãn tuổi |
| Accent hover | `#e04a00` | `--beta-orange-hover` | |
| Warning | `#f59e0b` | `--beta-yellow` / `--color-warning` | Chờ xử lý, cảnh báo |
| Success | `#10b981` | `--color-success` | Đã thanh toán, hoàn tiền xong |
| Danger | `#ef4444` | `--color-danger` | Đã hủy, lỗi |
| Text | `#0f172a` | `--slate-900` | Văn bản chính |
| Text muted | `#64748b` | `--slate-500` | Văn bản phụ (≥ 13px) |
| Border | `#e2e8f0` | `--slate-200` | |
| Background | `#f8fafc` | `--slate-50` | Nền trang |

**Lưu ý tương phản (WCAG):**
- Chữ trắng trên `--beta-orange` chỉ đạt ~3.3:1 → chỉ dùng cho chữ **đậm ≥ 14px** (nút, badge). Chữ cam nhỏ trên nền trắng: dùng `--beta-orange-hover` (#e04a00).
- Chữ trắng trên `--beta-navy` đạt ~8:1 — an toàn mọi cỡ.
- Không truyền đạt trạng thái chỉ bằng màu: badge luôn có icon + chữ (vd. icon check + "ĐÃ THANH TOÁN").

### Typography

- **Heading / số liệu nổi bật:** Montserrat (600–900)
- **Body / UI:** Be Vietnam Pro (400–800) — hỗ trợ đầy đủ dấu tiếng Việt
- **Google Fonts:** `https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Montserrat:wght@600;700;800;900&display=swap`
- Body tối thiểu 14px (khuyến nghị 15–16px), line-height 1.5. Chữ < 12px chỉ cho nhãn phụ in hoa.

### Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Khoảng cách icon–chữ |
| sm | 8px | Gap trong nhóm nút/chip |
| md | 16px | Padding chuẩn |
| lg | 24px | Padding card |
| xl | 32px | Khoảng cách section |
| radius | 8px (input, nút) / 12–16px (card) / 999px (chip, badge) | |

### Shadows

| Level | Value | Usage |
|-------|-------|-------|
| sm | `0 1px 2px rgba(15,23,42,.06)` | Chip, input |
| md | `0 4px 12px rgba(15,23,42,.08)` | Card |
| lg | `0 12px 32px rgba(15,23,42,.12)` | Modal, dropdown |

---

## Icons

- **Không dùng emoji làm icon.** Dùng SVG inline kiểu Lucide (stroke 2, `stroke="currentColor"`), class `ic`:
  ```html
  <svg class="ic" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>
  ```
- Icon tự theo cỡ chữ (1em) và màu chữ cha. Icon trang trí luôn `aria-hidden="true"`.
- Nút chỉ có icon (đóng, tìm kiếm, slider…) **bắt buộc** có `aria-label`.
- Bảng icon dùng chung: x (đóng), check, hourglass (chờ), alert (cảnh báo), circle-x (hủy), ticket, receipt (hóa đơn), banknote/wallet (tiền), card (thanh toán), map-pin (rạp), clock (suất chiếu), calendar, seat (ghế), user, bot, phone, search.

## Component Specs

### Buttons
- Primary CTA: nền `--beta-orange`, chữ trắng đậm, radius 8px, cao ≥ 44px, hover `--beta-orange-hover`, transition 200ms.
- Secondary: nền `--beta-navy`, chữ trắng; Outline: viền navy, chữ navy.
- Disabled: opacity .5, `cursor: not-allowed`.

### Cards
- Nền trắng, viền `--slate-200`, radius 12–16px, shadow md, padding 24px.

### Badges trạng thái đơn
| Trạng thái | Nền | Chữ | Icon |
|-----------|-----|-----|------|
| Đã thanh toán | `#d1fae5` | `#065f46` | check |
| Đang xử lý hoàn tiền | `#dbeafe` | `#1e40af` | hourglass |
| Chưa hoàn tiền / cảnh báo | `#fef3c7` | `#b45309` | alert |
| Đã hủy | `#fee2e2` | `#b91c1c` | circle-x |

### Inputs
- Label hiển thị phía trên (không dùng placeholder thay label), viền `--slate-300`, focus viền navy + ring.
- Lỗi hiển thị ngay dưới ô, màu danger, kèm icon alert.

### Ghế ngồi
- Thường `--seat-standard`, VIP `--seat-vip`, Sweetbox `--seat-sweetbox`; ghế đã bán phải khác biệt cả về **hình** (gạch chéo/icon x), không chỉ màu.

---

## Accessibility & Motion (đã có trong `prototype-theme.css`)
- `:focus-visible` viền cam 3px — không được `outline: none` mà không thay thế.
- `prefers-reduced-motion` tắt animation/transition.
- `cursor: pointer` cho mọi phần tử bấm được.

## Anti-Patterns (Do NOT Use)
- Emoji làm icon
- Mã hex rải rác trong trang thay vì biến CSS
- Chữ xám nhạt trên nền xám (< 4.5:1)
- Nút icon không có `aria-label`
- Luồng đặt vé không có tiến trình / không có nút quay lại rõ ràng

## Pre-Delivery Checklist
- [ ] Không có emoji làm icon (dùng SVG `.ic`)
- [ ] Màu lấy từ biến trong `:root`
- [ ] Tương phản chữ ≥ 4.5:1
- [ ] Focus bàn phím nhìn thấy được
- [ ] `prefers-reduced-motion` được tôn trọng
- [ ] Vùng chạm ≥ 44×44px trên mobile
- [ ] Responsive: 375px, 768px, 1024px, 1440px — không cuộn ngang
