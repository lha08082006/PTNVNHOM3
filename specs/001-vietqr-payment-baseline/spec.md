# Feature Specification: Hệ thống đặt vé & thanh toán VietQR (Baseline toàn dự án)

**Feature Branch**: `001-vietqr-payment-baseline`

**Created**: 2026-11-19

**Status**: Draft (baseline — mô tả hệ thống hiện có + khoảng trống cần khắc phục)

**Input**: User description: "Chạy Spec Kit cho toàn bộ dự án: đặc tả hệ thống đặt vé Beta Cinemas
với thanh toán chuyển khoản VietQR, tự động xử lý trả thiếu / trả thừa / trả trễ / trễ webhook,
hoàn tiền và tra cứu đơn hàng."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đặt vé và thanh toán đủ bằng VietQR (Priority: P1)

Khách chọn phim, rạp, suất chiếu, ghế và combo bắp nước; hệ thống giữ ghế 10 phút và hiển thị mã
QR chuyển khoản có sẵn số tiền và nội dung là mã đơn. Khách chuyển khoản đúng số tiền; trong vài
giây trang thanh toán tự chuyển sang vé điện tử.

**Why this priority**: đây là luồng tạo ra doanh thu; mọi tính năng khác chỉ là xử lý ngoại lệ.

**Independent Test**: tạo một đơn, gửi một thông báo chuyển khoản đúng số tiền và đúng mã đơn,
kiểm tra đơn chuyển sang "Đã thanh toán" và vé hiển thị được.

**Acceptance Scenarios**:

1. **Given** khách đã chọn 2 ghế và 1 combo, **When** bấm "Thanh toán", **Then** hệ thống tạo đơn
   có mã duy nhất, tổng tiền do hệ thống tính và thời hạn giữ ghế 10 phút.
2. **Given** đơn đang giữ ghế, **When** ngân hàng báo nhận đúng số tiền với nội dung chứa mã đơn,
   **Then** đơn chuyển "Đã thanh toán", ghi nhận thời điểm thanh toán và khách được dẫn tới vé.
3. **Given** đơn đã thanh toán, **When** cùng một thông báo ngân hàng được gửi lại, **Then** hệ
   thống không cộng tiền lần hai và trả lời "đã ghi nhận trước đó".

---

### User Story 2 - Trả thiếu tiền và chuyển bù (Priority: P1)

Khách chuyển ít hơn số tiền đơn. Hệ thống giữ ghế, báo số tiền còn thiếu và hiển thị QR mới cho
phần còn lại; khi khách chuyển bù đủ trong thời hạn, vé được xuất.

**Why this priority**: lỗi gõ nhầm số tiền là tình huống phổ biến; xử lý sai gây mất vé hoặc mất tiền.

**Independent Test**: gửi giao dịch thiếu, kiểm tra trạng thái "Thanh toán một phần" và số tiền
còn lại; gửi giao dịch bù, kiểm tra trạng thái "Đã thanh toán".

**Acceptance Scenarios**:

1. **Given** đơn 179.000đ còn hạn, **When** nhận 100.000đ, **Then** đơn ở trạng thái "Thanh toán
   một phần", còn thiếu 79.000đ và trang trả thiếu hiển thị QR cho 79.000đ.
2. **Given** đơn trả thiếu còn hạn, **When** nhận thêm 79.000đ, **Then** đơn "Đã thanh toán".
3. **Given** đơn trả thiếu đã hết hạn giữ ghế, **When** nhận thêm tiền, **Then** đơn "Hết hạn" và
   một hồ sơ hoàn toàn bộ số tiền đã nhận được tạo (lý do: trả thiếu).

---

### User Story 3 - Trả thừa tiền (Priority: P2)

Khách chuyển nhiều hơn số tiền đơn. Vé vẫn được xuất ngay; phần thừa tự động được lập hồ sơ hoàn.

**Why this priority**: khách không bị chặn xem phim, tiền thừa vẫn được trả lại.

**Independent Test**: gửi giao dịch thừa 21.000đ, kiểm tra đơn "Đã thanh toán" và có hồ sơ hoàn
21.000đ lý do "trả thừa".

**Acceptance Scenarios**:

1. **Given** đơn còn hạn, **When** nhận nhiều hơn tổng tiền, **Then** đơn "Đã thanh toán" và hồ sơ
   hoàn đúng phần chênh lệch ở trạng thái "Chờ thông tin".
2. **Given** đơn đã hết hạn, **When** nhận nhiều hơn tổng tiền, **Then** đơn "Hết hạn" và hồ sơ
   hoàn 100% số tiền đã nhận (lý do: trễ hạn).

---

### User Story 4 - Thanh toán trễ sau khi hết thời gian giữ ghế (Priority: P2)

Khách chuyển tiền sau khi 10 phút giữ ghế đã qua; ghế có thể đã được nhả. Hệ thống không xuất vé
mà lập hồ sơ hoàn 100%.

**Why this priority**: bảo vệ tính toàn vẹn của sơ đồ ghế và quyền lợi khách.

**Independent Test**: đặt đơn hết hạn, gửi giao dịch đủ tiền, kiểm tra hồ sơ hoàn 100% lý do "trễ".

**Acceptance Scenarios**:

1. **Given** đơn đã hết hạn giữ ghế, **When** nhận đủ tiền, **Then** đơn "Hết hạn", giao dịch ghi
   kết quả "trễ" và hồ sơ hoàn 100% được tạo.

---

### User Story 5 - Đối soát khi "tiền đã trừ nhưng chưa có vé" qua BetaBot (Priority: P2)

Khách báo mã đơn và/hoặc mã giao dịch ngân hàng cho trợ lý BetaBot. Hệ thống tra sổ cái giao dịch:
nếu tìm thấy và đơn còn hạn thì xuất vé ngay; nếu đơn hết hạn thì lập hồ sơ hoàn; nếu chưa thấy
giao dịch thì lập phiếu khiếu nại để nhân viên xử lý.

**Why this priority**: giảm tải CSKH cho tình huống trễ thông báo từ ngân hàng.

**Independent Test**: lưu một giao dịch chưa khớp đơn, gọi đối soát với mã giao dịch, kiểm tra đơn
được khôi phục; gọi với mã giao dịch không tồn tại, kiểm tra phiếu khiếu nại được tạo.

**Acceptance Scenarios**:

1. **Given** sổ cái có giao dịch khớp đơn còn hạn, **When** khách đối soát, **Then** đơn "Đã thanh
   toán" và giao dịch được đánh dấu "đã khôi phục".
2. **Given** giao dịch khớp đơn đã hết hạn, **When** khách đối soát, **Then** trả về mã hồ sơ hoàn.
3. **Given** không tìm thấy giao dịch, **When** khách đối soát với mã giao dịch, **Then** tạo phiếu
   khiếu nại có mã tra cứu và thông báo thời gian phản hồi dự kiến.
4. **Given** khách không cung cấp mã đơn lẫn mã giao dịch, **When** đối soát, **Then** từ chối với
   thông báo yêu cầu bổ sung thông tin.

---

### User Story 6 - Khai báo tài khoản nhận hoàn và theo dõi tiến trình (Priority: P3)

Khách có hồ sơ hoàn khai báo ngân hàng, số tài khoản, tên chủ tài khoản; sau đó theo dõi tiến
trình 5 bước: Chờ thông tin → Đã tiếp nhận → Đang đối soát → Đã duyệt → Hoàn tất (kèm mã giao dịch
hoàn tiền). Nhân viên cập nhật trạng thái; mốc thời gian mỗi bước được ghi tự động.

**Why this priority**: hoàn thiện vòng đời tiền của khách sau các ngoại lệ.

**Independent Test**: gửi thông tin tài khoản cho một hồ sơ, kiểm tra trạng thái "Đã tiếp nhận" và
tên chủ tài khoản được chuẩn hóa chữ hoa; tra cứu theo mã hồ sơ hoặc mã đơn.

**Acceptance Scenarios**:

1. **Given** hồ sơ "Chờ thông tin", **When** khách gửi đủ 3 trường, **Then** hồ sơ "Đã tiếp nhận".
2. **Given** thiếu một trong 3 trường, **When** gửi, **Then** bị từ chối với thông báo rõ ràng.
3. **Given** nhân viên đổi trạng thái hồ sơ, **When** khách mở trang theo dõi, **Then** thấy bước hiện
   tại và mốc thời gian của từng bước đã qua.

---

### User Story 7 - Lịch sử đặt vé và tra cứu đơn (Priority: P3)

Thành viên xem danh sách đơn mới nhất trước, lọc theo "Đã thanh toán", "Đã hủy", "Đang hoàn tiền /
Đã hoàn tiền", mở chi tiết vé, hóa đơn hoặc tiến trình hoàn tiền.

**Why this priority**: tiện ích tự phục vụ; không ảnh hưởng dòng tiền.

**Independent Test**: tạo vài đơn ở các trạng thái khác nhau, kiểm tra từng bộ lọc hiển thị đúng.

**Acceptance Scenarios**:

1. **Given** khách có nhiều đơn, **When** mở lịch sử, **Then** đơn mới nhất ở đầu, tối đa 50 đơn.
2. **Given** một đơn, **When** tra cứu theo mã, **Then** thấy trạng thái, tổng tiền, đã trả, còn
   thiếu, tiền thừa, ghế, combo và hồ sơ hoàn (nếu có).

### Edge Cases

- Nội dung chuyển khoản không chứa mã đơn: giao dịch được lưu là "không khớp" để đối soát; hệ thống
  KHÔNG tự ghép vào đơn đang chờ gần nhất (FR-004).
- Thông báo ngân hàng gửi lại nhiều lần với cùng mã tham chiếu: chỉ xử lý một lần.
- Mã đơn trong nội dung không tồn tại: giao dịch lưu "không khớp"; KHÔNG tự tạo đơn giả (FR-005).
- Đơn đã thanh toán lại nhận thêm tiền: vé giữ nguyên, khoản mới được lập hồ sơ hoàn (lý do: trùng).
- Đơn đã trả một phần nhưng hết hạn giữ ghế: phần đã trả được lập hồ sơ hoàn (lý do: trả thiếu).
- Hai khách cùng chọn một ghế trong cùng suất: chỉ một đơn được giữ ghế.
- Thông báo ngân hàng giả mạo (không từ cổng thanh toán): bị từ chối, không ghi nhận tiền.
- Giao dịch tiền ra (không phải tiền vào): bị bỏ qua và đánh dấu "bỏ qua".
- Mất kết nối cơ sở dữ liệu: hệ thống vẫn chạy ở chế độ dữ liệu tạm để demo, nhưng ở môi trường
  production phải báo lỗi thay vì âm thầm mất dữ liệu.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống MUST tạo đơn có mã duy nhất dạng `BC` + 10 chữ số, dùng làm nội dung chuyển
  khoản, kèm thời hạn giữ ghế 10 phút.
- **FR-002**: Hệ thống MUST tự tính tổng tiền đơn từ ghế, combo và voucher; không tin tổng tiền do
  trình duyệt gửi.
- **FR-003**: Hệ thống MUST hiển thị QR VietQR với số tài khoản nhận, số tiền và nội dung cố định.
- **FR-004**: Hệ thống MUST nhận diện mã đơn từ nội dung chuyển khoản; khi không nhận diện được,
  MUST lưu giao dịch ở trạng thái "không khớp" và MUST NOT tự ghép vào đơn khác.
- **FR-005**: Hệ thống MUST NOT tự tạo đơn mới từ một giao dịch có mã đơn không tồn tại.
- **FR-006**: Hệ thống MUST xử lý mỗi giao dịch ngân hàng đúng một lần theo mã tham chiếu.
- **FR-007**: Hệ thống MUST xác thực thông báo từ cổng thanh toán trước khi ghi nhận tiền.
- **FR-008**: Hệ thống MUST cộng dồn số tiền đã nhận và phân loại kết quả: đủ, thiếu, thừa, trễ.
- **FR-009**: Với trả thiếu còn hạn, hệ thống MUST giữ đơn ở "thanh toán một phần" và cho phép
  chuyển bù phần còn thiếu.
- **FR-010**: Với trả thừa còn hạn, hệ thống MUST xuất vé và tạo hồ sơ hoàn phần chênh lệch.
- **FR-011**: Với mọi khoản tiền nhận sau khi hết hạn giữ ghế, hệ thống MUST đánh dấu đơn "hết hạn"
  và tạo hồ sơ hoàn 100% số tiền đã nhận.
- **FR-012**: Hệ thống MUST cho phép đối soát theo mã đơn và/hoặc mã giao dịch ngân hàng, với ba
  kết quả: khôi phục vé, tạo hồ sơ hoàn, hoặc tạo phiếu khiếu nại.
- **FR-013**: Hệ thống MUST cho phép khách khai báo tài khoản nhận hoàn (bắt buộc đủ 3 trường) và
  tra cứu hồ sơ theo mã hồ sơ hoặc mã đơn.
- **FR-014**: Hồ sơ hoàn MUST đi qua đúng 5 trạng thái và ghi mốc thời gian mỗi lần đổi trạng thái.
- **FR-015**: Mỗi cặp (giao dịch, lý do hoàn) MUST tạo tối đa một hồ sơ hoàn.
- **FR-016**: Hệ thống MUST đảm bảo mỗi ghế của một suất chỉ được giữ/bán cho một đơn tại một thời
  điểm.
- **FR-017**: Hệ thống MUST cung cấp danh sách đơn (mới nhất trước, tối đa 50) và chi tiết đơn,
  và chỉ trả dữ liệu cá nhân cho đúng chủ đơn.
- **FR-018**: Công cụ giả lập thanh toán (để demo các tình huống) MUST chỉ khả dụng ngoài production.
- **FR-019**: Hệ thống MUST lưu nguyên văn mọi thông báo ngân hàng nhận được để đối soát về sau.

### Key Entities *(include if feature involves data)*

- **Đơn hàng (Order)**: mã đơn, khách (SĐT/tài khoản), phim, rạp, ngày, giờ, ghế, combo, voucher,
  tổng tiền, đã trả, trạng thái, hạn giữ ghế, thời điểm thanh toán.
- **Giữ ghế (Seat hold)**: suất chiếu + ghế (duy nhất), đơn sở hữu, trạng thái giữ/đã bán, hạn.
- **Giao dịch ngân hàng (Bank transaction)**: mã giao dịch cổng, mã tham chiếu ngân hàng, số tiền,
  nội dung, đơn liên quan, kết quả xử lý, payload gốc.
- **Hồ sơ hoàn tiền (Refund)**: mã hồ sơ, đơn, giao dịch, số tiền, lý do, trạng thái 5 bước, thông
  tin tài khoản nhận, mốc thời gian từng bước, mã giao dịch hoàn.
- **Phiếu khiếu nại (Complaint)**: mã phiếu, mã giao dịch khách báo, mã đơn, SĐT, số tiền, mô tả,
  trạng thái mở/đã giải quyết.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% đơn thanh toán đủ được chuyển sang "Đã thanh toán" trong vòng 10 giây kể từ khi
  ngân hàng báo nhận tiền.
- **SC-002**: 100% khoản tiền vào được ghi sổ cái; 0 trường hợp cộng tiền trùng khi thông báo lặp.
- **SC-003**: 100% giao dịch trả thiếu-quá-hạn, trả thừa, trả trễ sinh đúng một hồ sơ hoàn với số
  tiền chính xác tới từng đồng.
- **SC-004**: Khách hoàn tất đặt vé (chọn suất → nhận vé) trong dưới 3 phút ở luồng chuẩn.
- **SC-005**: 80% yêu cầu "tiền đã trừ chưa có vé" được tự giải quyết qua đối soát mà không cần
  nhân viên.
- **SC-006**: 0 khóa bí mật xuất hiện trong mã nguồn hoặc lịch sử commit mới.

## Assumptions

- Phạm vi baseline gồm toàn bộ repo hiện tại: các trang HTML tĩnh (trang chủ, chi tiết phim, đặt
  suất, chọn ghế, combo, thanh toán, cổng VietQR, trả thiếu/thừa, vé, hóa đơn, hoàn tiền, theo dõi
  hoàn tiền, tài khoản, BetaBot, hỗ trợ) và các API trong `api/`.
- Chỉ có một ngân hàng nhận tiền và một cổng báo biến động (SePay).
- Danh mục phim, rạp, suất chiếu hiện là dữ liệu tĩnh trong giao diện; quản trị nội dung ngoài phạm vi.
- Đăng nhập/đăng ký hiện ở mức giao diện demo; xác thực thành viên thật ngoài phạm vi baseline,
  nhưng FR-017 yêu cầu bảo vệ dữ liệu theo chủ đơn khi có xác thực.
- Nhân viên xử lý hoàn tiền bằng cách đổi trạng thái trực tiếp trong bảng quản trị cơ sở dữ liệu.
- Các FR-002, FR-004, FR-005, FR-007, FR-016, FR-018 ban đầu chưa được code đáp ứng; đã được khắc
  phục theo `tasks.md` (2026-11-19).
