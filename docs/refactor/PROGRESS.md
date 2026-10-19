# Tiến độ refactor Clean Architecture

> File này là trạng thái SỐNG — luôn đọc file này trước khi bắt đầu bất kỳ công việc refactor nào, và CẬP NHẬT lại trước khi kết thúc phiên. Kiến trúc đích và các giai đoạn xem ở [PLAN.md](./PLAN.md).

Cập nhật lần cuối: 2026-10-19

## Trạng thái tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0 — Safety net (Jest + baseline test + ESLint) | ✅ Xong | Xem chi tiết bên dưới |
| 1 — Dọn hạ tầng dùng chung | ✅ Xong | Xem chi tiết bên dưới |
| 2 — Module mẫu (pilot) | ☐ Chưa bắt đầu | Chưa chọn module mẫu |
| 3 — Nhân rộng các module | ☐ Chưa bắt đầu | |
| 4 — Dọn Lambda worker | ☐ Chưa bắt đầu | |
| 5 — CI | ☐ Chưa bắt đầu | |

## Trạng thái từng module (Giai đoạn 3)

Cột **Baseline test** = test được viết TRƯỚC khi sửa code của module (bước 0 trong PLAN.md Giai đoạn 3), dùng để xác nhận hành vi không đổi sau refactor. Bắt buộc phải ✅ cột này trước khi bắt đầu các cột Domain/Application/Infrastructure/Presentation.

| Module | Trạng thái | Baseline test | Domain | Application (use-cases) | Infrastructure (repo adapter) | Presentation | Test use-case | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| categories | ☐ Chưa bắt đầu | ☐ | | | | | | Ứng viên module mẫu |
| inventory | ☐ Chưa bắt đầu | ✅ `inventory.service.spec.ts` (reserve/release) | | | | | | Ứng viên module mẫu. Baseline mới phủ reserve/release, chưa phủ findAll/pagination/updateAvailableQuantity — xem lại trước khi refactor các phần đó. Đã migrate sang `DomainError` (NotFoundError/ConflictError/InvalidInputError) và `DynamoTablesService` ở Giai đoạn 1 — service vẫn còn gọi DynamoDB Command trực tiếp (chưa tách Repository) |
| products | ☐ Chưa bắt đầu | ☐ | | | | | | |
| carts | ☐ Chưa bắt đầu | ☐ | | | | | | |
| users / auth | ☐ Chưa bắt đầu | 🔶 một phần (`roles.guard.spec.ts`) | | | | | | RolesGuard có test, nhưng JwtAuthGuard (verify JWT qua Cognito) và PermissionsGuard chưa có test |
| orders | ☐ Chưa bắt đầu | ☐ | | | | | | Phức tạp nhất — payments/VNPay, queue, events. Cần baseline cho checkout flow trước khi đụng vào |

Chú thích trạng thái: ☐ Chưa bắt đầu · 🔶 Một phần · 🔄 Đang làm · ✅ Xong · ⚠️ Blocked (xem ghi chú)

## Pattern tham chiếu (điền sau khi xong module mẫu ở Giai đoạn 2)

_Chưa có — sẽ điền chi tiết cấu trúc file, cách đặt tên, cách bind DI token... sau khi hoàn thành module mẫu, để các module sau copy theo đúng pattern thay vì tự sáng tạo lại._

## Việc đang dang dở (nếu phiên kết thúc giữa chừng)

_Không có việc dang dở._

> Khi 1 phiên kết thúc giữa chừng một task, ghi rõ ở đây: module đang làm, bước đã xong, bước tiếp theo, và bất kỳ quyết định/giả định nào đã đưa ra để phiên sau không phải đoán lại.

## Nhật ký thay đổi lớn

- 2026-10-19: Tạo PLAN.md và PROGRESS.md, khởi tạo kế hoạch refactor Clean Architecture.
- 2026-10-19: Hoàn thành Giai đoạn 0 (safety net):
  - Thêm Jest 30 + ts-jest, `@nestjs/testing`, supertest, `aws-sdk-client-mock` (mock AWS SDK v3 cho unit test).
  - Thêm ESLint 10 (flat config `eslint.config.mjs`) + typescript-eslint + eslint-config-prettier (trước đó repo chưa có lint nào).
  - Scripts mới trong `package.json`: `test`, `test:watch`, `test:cov`, `lint`, `lint:fix`.
  - Viết 3 test baseline (10 test case, đều pass):
    - `src/auth/roles.guard.spec.ts` — unit test thuần cho `RolesGuard` (public route, thiếu role, đủ role, chưa đăng nhập).
    - `src/inventory/inventory.service.spec.ts` — unit test cho `InventoryService.reserve()`/`release()` bằng `aws-sdk-client-mock`, khóa lại contract chống oversell quan trọng nhất (ConditionExpression trên DynamoDB UpdateCommand) trước khi tách Repository layer.
    - `test/health.e2e-spec.ts` — e2e smoke test `GET /health` (200 khi DynamoDB OK, 503 khi lỗi) dùng `@nestjs/testing` + supertest, override `DynamoDbService`.
  - Lưu ý: `npx eslint` chạy trên `src/health/**` phát hiện nhiều cảnh báo CRLF line-ending (prettier) trên file cũ — không sửa hàng loạt vì ngoài phạm vi Giai đoạn 0; để ý khi chạm vào các module đó ở giai đoạn sau.
  - Baseline hiện tại CHƯA bao phủ hết các luồng trọng yếu (chưa có test cho orders checkout, auth JWT verify thật, carts) — nên bổ sung thêm baseline test khi bắt đầu refactor module tương ứng ở Giai đoạn 3, trước khi đụng vào code của module đó.
- 2026-10-19: Hoàn thành Giai đoạn 1 (dọn hạ tầng dùng chung):
  - **Gộp validation**: xóa `DtoValidationPipe` (file + `src/validation/` folder) và toàn bộ 23 chỗ dùng nó trong 7 controller (`categories`, `carts`, `inventory`, `upload`, `orders`, `users`, `products`) — đã xác nhận global `ValidationPipe` (app.bootstrap.ts) có `transform/whitelist/forbidNonWhitelisted` giống hệt, nên hành vi không đổi. Thêm test `src/validation-pipe.spec.ts` khóa lại contract này.
  - **Domain exception layer**: thêm `src/common/domain-error.ts` (`DomainError`, `NotFoundError`, `ConflictError`, `InvalidInputError`, `ForbiddenDomainError`, `UnauthorizedDomainError`) + `src/common/domain-exception.filter.ts` (map sang HTTP status), wire global qua `app.useGlobalFilters()` trong `app.bootstrap.ts`. Test: `src/common/domain-exception.filter.spec.ts`.
    - Mới áp dụng cho `InventoryService` (module có baseline test) — các service khác (`products`, `orders`, `carts`, `categories`, `users`, `audit`, `workers`) VẪN còn throw NestJS exception trực tiếp, sẽ migrate dần theo từng module ở Giai đoạn 3 (không đổi nhiều module cùng lúc khi chưa có baseline).
  - **Tập trung tên bảng DynamoDB**: thêm `DynamoTablesService` (`src/config/dynamo-tables.service.ts`), đăng ký trong `DynamoDbModule` (đã @Global). Thay thế TOÀN BỘ 14 chỗ đọc `configService.get('X_TABLE')` rải rác trong: `dynamodb.service`, `inventory`, `audit-log`, `carts`, `categories`, `products`, `orders`, `users`, `workers/orders-worker`, `cognito/post-authentication`, `cognito/pre-authentication`, `cognito/pre-token-generation`, `cognito/post-confirmation`, `mail/email-tracking`, `mail/ses-event-processor`, `notifications/order-notification-worker`. Các service dùng ConfigService cho việc khác (vùng AWS region, Cognito pool id, timeout...) vẫn giữ ConfigService song song.
    - Chưa đụng tới `src/product-seo-generator.ts` (script Lambda độc lập đọc `process.env` trực tiếp, không qua DI) — để dành cho Giai đoạn 4 (dọn Lambda worker).
  - Kiểm tra sau mỗi bước: `tsc --noEmit` sạch, `npx jest` 19/19 pass, `npx eslint` không phát sinh lỗi mới trên các file đã sửa (2 lỗi ESLint còn lại trong `audit-log.service.ts`/`pre-token-generation.service.ts` là code cũ, lộ ra do lần đầu bật strict lint, chưa sửa — để dành khi refactor module đó).
