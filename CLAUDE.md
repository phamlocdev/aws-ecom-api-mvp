# server — Clean Architecture refactor in progress

Repo này (NestJS 11 + DynamoDB, không ORM) đang được refactor từng phần sang Clean Architecture. Việc này trải dài qua nhiều phiên làm việc (chat session) khác nhau.

**Trước khi làm bất kỳ việc gì liên quan đến refactor, luôn đọc theo thứ tự:**
1. `docs/refactor/PROGRESS.md` — trạng thái hiện tại: giai đoạn nào đang làm, module nào xong/dở/chưa, có việc gì dang dở từ phiên trước không.
2. `docs/refactor/PLAN.md` — kiến trúc đích, quy tắc phụ thuộc giữa các lớp (domain/application/infrastructure/presentation), và chi tiết từng giai đoạn.

**Sau khi hoàn thành (một phần hoặc toàn bộ) một module hoặc một task refactor, luôn cập nhật `docs/refactor/PROGRESS.md`** (bảng trạng thái, mục "Việc đang dang dở" nếu dừng giữa chừng, nhật ký thay đổi) trước khi kết thúc phiên.

Quy tắc cốt lõi khi refactor (chi tiết xem PLAN.md):
- Không refactor nhiều module cùng lúc nếu chưa có test baseline (Giai đoạn 0).
- Giữ nguyên contract API/response shape khi refactor một module đang chạy (strangler pattern), trừ khi được yêu cầu đổi.
- `domain/` không được import `@nestjs/*` hay `@aws-sdk/*`.
- Nếu Giai đoạn 2 (module mẫu) đã có pattern tham chiếu trong PROGRESS.md, áp dụng đúng pattern đó cho các module sau, không tự sáng tạo cấu trúc mới.
