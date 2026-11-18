# Feature Specification: Baseline hệ thống Beta Cinemas (đặt vé, thanh toán VietQR, đối soát & hoàn tiền)

**Feature Branch**: `feat/quy-trinh-doi-soat-3-tang` (không tạo nhánh mới — spec baseline)

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Chạy spec-kit cho toàn bộ dự án" — đặc tả baseline (brownfield) mô tả hệ thống
đang có, làm nguồn sự thật cho các tính năng sau.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Khách đặt vé và thanh toán bằng chuyển khoản VietQR (Priority: P1)

Khách chọn phim → rạp/suất chiếu → ghế → combo/voucher → nhận mã VietQR kèm số tiền và nội dung
chuyển khoản. Ghế được giữ 10 phút. Khi tiền về, vé (kèm QR) được xuất tự động trong vài giây và
khách nhận thông báo trên web/email.

**Why this priority**: đây là luồng doanh thu duy nhất của hệ thống.

**Independent Test**: tạo đơn, mô phỏng giao dịch đúng số tiền → đơn chuyển "Đã xuất vé", ghế
chuyển sang đã bán, trang vé hiển thị QR.

**Acceptance Scenarios**:

1. **Given** ghế A5 còn trống, **When** khách tạo đơn, **Then** ghế bị giữ 10 phút và không khách
   nào khác chọn được.
2. **Given** khách gửi tổng tiền đã bị sửa từ trình duyệt, **When** tạo đơn, **Then** hệ thống tự
   tính lại giá từ danh mục và bỏ qua giá trị gửi lên.
3. **Given** đơn đang chờ thanh toán, **When** giao dịch đúng số tiền và đúng nội dung về trong 10
   phút, **Then** đơn chuyển CONFIRMED và vé được xuất đúng một lần dù webhook đến nhiều lần.
4. **Given** hai khách cùng chọn một ghế, **When** cả hai tạo đơn, **Then** chỉ một đơn giữ được ghế.

---

### User Story 2 - Cứu vé trước, hoàn tiền sau khi tiền về muộn hoặc sai (Priority: P1)

Khi tiền về sau 10 phút, chuyển thiếu, chuyển thừa hoặc chuyển trùng, hệ thống tự xử lý theo 3
tầng: tra cứu trong thời gian giữ ghế; trong 24 giờ sau đó cấp vé bù nếu còn ghế và còn ≥ 30 phút
trước giờ chiếu; nếu không thì tự hoàn tiền; quá 24 giờ chưa hoàn được thì chuyển xử lý thủ công.

**Why this priority**: bảo đảm khách không bao giờ mất tiền mà không có vé hoặc đường hoàn.

**Independent Test**: tạo đơn, để hết hạn giữ ghế, mô phỏng tiền về muộn → chạy job → đơn thành
CONFIRMED_LATE (còn ghế) hoặc REFUND_REQUESTED → REFUNDED (hết ghế/gần giờ chiếu).

**Acceptance Scenarios**:

1. **Given** đơn EXPIRED, ghế còn trống và còn > 30 phút trước giờ chiếu, **When** tiền về trong 24
   giờ, **Then** cấp vé bù (CONFIRMED_LATE).
2. **Given** đơn EXPIRED nhưng ghế đã bán cho người khác, **When** tiền về, **Then** tạo lệnh hoàn
   lý do SEAT_TAKEN với khóa chống trùng.
3. **Given** khách chuyển thừa, **When** đơn được xác nhận, **Then** phần thừa được hoàn (EXCESS).
4. **Given** lệnh hoàn tự động thất bại liên tục quá 24 giờ, **When** job chạy, **Then** lệnh chuyển
   MANUAL_REVIEW, mở RefundForm cho khách và tạo phiếu hỗ trợ cho CSKH.
5. **Given** khách bấm "Đã chuyển tiền nhưng chưa có vé", **When** gửi báo cáo, **Then** hệ thống
   tra cứu lại ngay và mở phiếu hỗ trợ nếu vẫn chưa khớp.

---

### User Story 3 - Hoàn tiền thủ công có tách nhiệm CSKH ↔ Kế toán (Priority: P2)

CSKH đối chiếu hồ sơ hoàn tiền (kèm thông tin tài khoản nhận và biên lai khách gửi), quyết định
"Cần hoàn tiền" hoặc "Ngoại lệ", gửi sang Kế toán. Kế toán duyệt chi hoặc trả hồ sơ về kèm lý do;
người gửi hồ sơ không được tự duyệt chi. Khách theo dõi tiến độ ở trang theo dõi hoàn tiền.

**Why this priority**: cần cho các ca ngoại lệ, nhưng tần suất thấp hơn luồng tự động.

**Independent Test**: tạo lệnh MANUAL_REVIEW → khách gửi form → CSKH gửi Kế toán → Kế toán trả về
→ CSKH gửi lại → Kế toán chi → hoàn tất; mọi bước có trong nhật ký.

**Acceptance Scenarios**:

1. **Given** hồ sơ do nhân viên X gửi, **When** chính X cố duyệt chi, **Then** bị từ chối.
2. **Given** Kế toán trả hồ sơ về, **When** CSKH xem, **Then** thấy lý do, số lần bị trả và có thể
   gửi lại.

---

### User Story 4 - Tài khoản thành viên (Priority: P2)

Khách đăng ký, đăng nhập, sửa hồ sơ, đổi mật khẩu, quên mật khẩu qua mã OTP; xem lịch sử đơn, hóa
đơn và vé của riêng mình; gửi yêu cầu hỗ trợ và hỏi chatbot dựa trên đơn thật.

**Independent Test**: đăng ký → đặt vé → chỉ thấy đơn của mình; đổi mật khẩu làm phiên cũ hết hạn;
sai mật khẩu nhiều lần bị khóa tạm.

**Acceptance Scenarios**:

1. **Given** sai mật khẩu 5 lần trong 15 phút, **When** đăng nhập lần nữa, **Then** bị khóa tạm 15 phút.
2. **Given** khách A đăng nhập, **When** truy vấn đơn của khách B, **Then** bị từ chối.

---

### User Story 5 - Vận hành nội bộ: danh mục, soát vé, báo cáo, nhân sự (Priority: P3)

Quản lý quản lý phim, rạp, suất chiếu, voucher (giới hạn lượt), tài khoản nhân viên và xem nhật ký;
Quầy soát vé bằng QR ký số (mỗi vé hợp lệ một lần, trong khung giờ quanh suất chiếu); Kế toán xem
báo cáo; bảng tổng quan hiển thị doanh thu, vé bán và tỉ lệ lấp đầy; IT xem log cổng thanh toán và
chạy job thủ công.

**Independent Test**: tạo suất chiếu và voucher → đặt vé → soát QR lần 1 thành công, lần 2 bị chặn,
QR giả bị chặn; tổng quan phản ánh đơn vừa bán.

**Acceptance Scenarios**:

1. **Given** vai trò Quầy, **When** gọi thao tác sửa danh mục, **Then** bị từ chối (403).
2. **Given** QR có chữ ký sai, **When** soát vé, **Then** báo vé giả.

---

### Edge Cases

- Webhook trùng hoặc đến song song với tra cứu chủ động → không xuất vé/hoàn trùng.
- Giao dịch có nội dung không khớp đơn nào → tạo phiếu UNMATCHED_TX cho CSKH.
- Cổng thanh toán lỗi liên tiếp (≥ 3 lần) → cảnh báo vận hành.
- Tiền về khi còn < 30 phút trước giờ chiếu → không cấp vé bù, chuyển hoàn (NEAR_SHOWTIME).
- Chuyển thiếu rồi hết giờ giữ ghế → hoàn phần đã chuyển (SHORT).
- Voucher hết lượt hoặc hết hạn → từ chối khi tạo đơn.
- Soát vé ngoài khung từ 2 giờ trước đến 3 giờ sau giờ chiếu → từ chối.

## Requirements *(mandatory)*

### Functional Requirements

**Đặt vé & thanh toán**

- **FR-001**: Hệ thống MUST hiển thị phim, rạp, suất chiếu và sơ đồ ghế với ghế đã giữ/đã bán.
- **FR-002**: Hệ thống MUST tính tổng tiền phía máy chủ từ danh mục (vé, combo, voucher).
- **FR-003**: Hệ thống MUST giữ ghế 10 phút khi tạo đơn và bảo đảm không bán trùng ghế.
- **FR-004**: Hệ thống MUST tạo mã VietQR với số tiền và nội dung chứa mã đơn.
- **FR-005**: Hệ thống MUST xác nhận thanh toán từ webhook ngân hàng có khóa xác thực, và tự tra
  cứu theo lịch (chờ webhook 2 phút, 4 lần mỗi 15 giây, rồi mỗi 3 phút, lần chốt khi hết 10 phút).
- **FR-006**: Hệ thống MUST xuất vé có QR ký số và thông báo khách qua web/email khi thanh toán đủ.

**Đối soát & hoàn tiền tự động**

- **FR-007**: Hệ thống MUST quét đơn hết hạn mỗi 30 phút trong cửa sổ 24 giờ và kiểm tra chéo giao dịch.
- **FR-008**: Hệ thống MUST cấp vé bù khi tiền về muộn nếu ghế còn và còn ≥ 30 phút trước giờ chiếu.
- **FR-009**: Hệ thống MUST tạo lệnh hoàn cho các lý do LATE, SEAT_TAKEN, NEAR_SHOWTIME, SHORT,
  EXCESS, DUPLICATE, MISMATCH, mỗi lệnh có khóa chống trùng.
- **FR-010**: Hệ thống MUST thử lại hoàn tự động mỗi chu kỳ job trong hạn 24 giờ; quá hạn MUST chuyển
  xử lý thủ công, mở RefundForm và phiếu hỗ trợ.
- **FR-011**: Khách MUST theo dõi được trạng thái đơn và từng mốc hoàn tiền.

**Hoàn tiền thủ công & hỗ trợ**

- **FR-012**: CSKH MUST đối chiếu, quyết định và gửi hồ sơ hoàn sang Kế toán; Kế toán MUST duyệt chi
  hoặc trả về kèm lý do; người gửi MUST NOT tự duyệt chi.
- **FR-013**: Hệ thống MUST quản lý phiếu hỗ trợ (PAYMENT_REPORT, MANUAL_REVIEW, DATA_MISMATCH,
  UNMATCHED_TX, GENERAL) với trạng thái OPEN → WAITING_* → RESOLVED.

**Tài khoản**

- **FR-014**: Khách MUST đăng ký/đăng nhập, sửa hồ sơ, đổi mật khẩu (vô hiệu phiên cũ) và đặt lại
  mật khẩu bằng OTP.
- **FR-015**: Hệ thống MUST khóa tạm 15 phút sau 5 lần sai trong 15 phút.
- **FR-016**: Khách MUST chỉ xem được đơn, hóa đơn và vé của chính mình.

**Vận hành nội bộ**

- **FR-017**: Nhân viên MUST đăng nhập bằng tài khoản riêng; quyền theo vai trò Quản lý / Kế toán /
  CSKH / Quầy; tài khoản Quản lý đầu tiên tạo một lần bằng khóa quản trị.
- **FR-018**: Mọi thao tác nhân viên làm thay đổi dữ liệu MUST ghi nhật ký (ai, lúc nào, gì).
- **FR-019**: Quản lý MUST quản lý phim, rạp, suất chiếu, voucher (giảm giá, giới hạn lượt).
- **FR-020**: Quầy MUST soát vé QR: hợp lệ một lần, chặn vé giả, chặn ngoài khung giờ.
- **FR-021**: Hệ thống MUST cung cấp tổng quan doanh thu, vé bán, lấp đầy và báo cáo cho Kế toán.
- **FR-022**: Chế độ mô phỏng thanh toán MUST bị tắt trên môi trường thật.

### Key Entities

- **Khách hàng (customer)**: tài khoản thành viên; sở hữu nhiều đơn.
- **Đơn (order)**: mã BC + 10 số, suất chiếu, ghế, combo, voucher, tổng tiền, số đã trả, trạng thái
  (PENDING, CONFIRMED, CONFIRMED_LATE, EXPIRED, REFUND_REQUESTED, REFUNDED, MANUAL_REVIEW, CANCELLED,
  FAILED), các mốc thời gian và lịch sử.
- **Giữ ghế (seat hold)**: (suất, ghế) duy nhất, HELD hoặc SOLD.
- **Giao dịch ngân hàng**: dữ liệu nhận từ cổng, gắn với đơn hoặc chưa khớp.
- **Lệnh hoàn (refund)**: số tiền, lý do, khóa chống trùng, hạn 24 giờ, trạng thái REQUESTED →
  RETRYING → DONE, hoặc MANUAL_REVIEW → FORM_SUBMITTED → CS_APPROVED ⇄ ACC_RETURNED → PAID_OUT.
- **Phiếu hỗ trợ, Thông báo, Log cổng**.
- **Nhân viên, Nhật ký thao tác**.
- **Phim, Rạp, Suất chiếu, Voucher, Lượt soát vé, Mã đặt lại mật khẩu, Bộ đếm chặn dò**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Khi tiền về đúng trong thời gian giữ ghế, vé được xuất trong ≤ 10 giây.
- **SC-002**: 0 ca bán trùng ghế và 0 ca xuất vé/hoàn tiền trùng, kể cả khi thông báo thanh toán lặp.
- **SC-003**: 100% đơn có tiền về nhưng không có vé được cấp vé bù hoặc hoàn tiền tự động trong 24 giờ,
  hoặc chuyển cho người xử lý.
- **SC-004**: 0 ca khách xem được đơn của người khác hay nhân viên làm thao tác ngoài quyền.
- **SC-005**: 100% thao tác nhân viên thay đổi dữ liệu truy vết được trong nhật ký.
- **SC-006**: Khách hoàn tất đặt vé (chọn phim → nhận QR thanh toán) trong dưới 3 phút.

## Assumptions

- Chỉ hỗ trợ thanh toán chuyển khoản VietQR qua SePay; không có thẻ/ví điện tử.
- Email gửi qua Resend nếu đã cấu hình; SMS hiện chỉ ghi nhận, không gửi thật.
- Hoàn tiền tự động phụ thuộc khả năng của cổng thanh toán; khi không làm được thì đi luồng thủ công.
- Múi giờ nghiệp vụ là giờ Việt Nam.
- Spec này mô tả hệ thống hiện có; không yêu cầu viết lại mã.
