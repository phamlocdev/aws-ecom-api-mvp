# Tiến độ refactor Clean Architecture

> File này là trạng thái SỐNG — luôn đọc file này trước khi bắt đầu bất kỳ công việc refactor nào, và CẬP NHẬT lại trước khi kết thúc phiên. Kiến trúc đích và các giai đoạn xem ở [PLAN.md](./PLAN.md).

Cập nhật lần cuối: 2026-10-19

## Trạng thái tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0 — Safety net (Jest + baseline test + ESLint) | ☐ Chưa bắt đầu | |
| 1 — Dọn hạ tầng dùng chung | ☐ Chưa bắt đầu | |
| 2 — Module mẫu (pilot) | ☐ Chưa bắt đầu | Chưa chọn module mẫu |
| 3 — Nhân rộng các module | ☐ Chưa bắt đầu | |
| 4 — Dọn Lambda worker | ☐ Chưa bắt đầu | |
| 5 — CI | ☐ Chưa bắt đầu | |

## Trạng thái từng module (Giai đoạn 3)

| Module | Trạng thái | Domain | Application (use-cases) | Infrastructure (repo adapter) | Presentation | Test | Ghi chú |
|---|---|---|---|---|---|---|---|
| categories | ☐ Chưa bắt đầu | | | | | | Ứng viên module mẫu |
| inventory | ☐ Chưa bắt đầu | | | | | | Ứng viên module mẫu |
| products | ☐ Chưa bắt đầu | | | | | | |
| carts | ☐ Chưa bắt đầu | | | | | | |
| users / auth | ☐ Chưa bắt đầu | | | | | | |
| orders | ☐ Chưa bắt đầu | | | | | | Phức tạp nhất — payments/VNPay, queue, events |

Chú thích trạng thái: ☐ Chưa bắt đầu · 🔄 Đang làm · ✅ Xong · ⚠️ Blocked (xem ghi chú)

## Pattern tham chiếu (điền sau khi xong module mẫu ở Giai đoạn 2)

_Chưa có — sẽ điền chi tiết cấu trúc file, cách đặt tên, cách bind DI token... sau khi hoàn thành module mẫu, để các module sau copy theo đúng pattern thay vì tự sáng tạo lại._

## Việc đang dang dở (nếu phiên kết thúc giữa chừng)

_Không có việc dang dở._

> Khi 1 phiên kết thúc giữa chừng một task, ghi rõ ở đây: module đang làm, bước đã xong, bước tiếp theo, và bất kỳ quyết định/giả định nào đã đưa ra để phiên sau không phải đoán lại.

## Nhật ký thay đổi lớn

- 2026-10-19: Tạo PLAN.md và PROGRESS.md, khởi tạo kế hoạch refactor Clean Architecture.
