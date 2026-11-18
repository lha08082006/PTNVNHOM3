# Research: Baseline hệ thống Beta Cinemas

Không còn mục NEEDS CLARIFICATION trong Technical Context. Ghi lại các quyết định đang áp dụng và
phương án cho khoảng hở G1/G2.

## R1. Xác nhận thanh toán: webhook + tra cứu chủ động

- **Decision**: webhook SePay là đường chính; song song tra cứu theo lịch Tầng 1 (2:00, 2:15, 2:30,
  2:45, rồi mỗi 3 phút, chốt ở 10:00).
- **Rationale**: webhook có thể trễ/mất; tra cứu bảo đảm SC-001 và không phụ thuộc một kênh.
- **Alternatives**: chỉ webhook (rủi ro mất sự kiện); chỉ polling (tốn quota, chậm).

## R2. Chống trùng

- **Decision**: compare-and-set trên `orders.status`, khóa chính ghế, `idempotency_key` cho hoàn tiền.
- **Rationale**: chạy được trên serverless nhiều tiến trình, không cần khóa phân tán.

## R3. Lịch chạy job Tầng 2/3 (G1)

- **Decision**: thêm bộ lập lịch ngoài gọi `/api/cron` mỗi 30 phút với `CRON_SECRET` (ví dụ Supabase
  `pg_cron` + `pg_net`, GitHub Actions schedule, hoặc nâng gói Vercel để dùng cron `*/30 * * * *`);
  giữ cron Vercel hằng ngày làm lưới an toàn.
- **Rationale**: gói Vercel hiện tại chỉ cho cron hằng ngày; `pg_cron` nằm sẵn trong Supabase đang dùng,
  không thêm dịch vụ mới.
- **Alternatives**: dựa vào khách mở trang (không đáng tin); hạ yêu cầu xuống hằng ngày (trái BR-05).
- **Cần người dùng chọn**: phương án lập lịch cụ thể.

## R4. Nhật ký thao tác bền (G2)

- **Decision**: ghi `audit_logs` trước khi trả phản hồi (await); nếu ghi thất bại thì ghi log lỗi máy chủ
  và trả cảnh báo trong phản hồi, không nuốt lỗi.
- **Rationale**: SC-005 yêu cầu 100% truy vết; chi phí thêm một lần ghi DB là chấp nhận được.
- **Alternatives**: transaction chung với thao tác (Supabase REST không hỗ trợ đa câu lệnh dễ dàng).
