# Tiến độ refactor Clean Architecture

> File này là trạng thái SỐNG — luôn đọc file này trước khi bắt đầu bất kỳ công việc refactor nào, và CẬP NHẬT lại trước khi kết thúc phiên. Kiến trúc đích và các giai đoạn xem ở [PLAN.md](./PLAN.md).

Cập nhật lần cuối: 2026-10-19

## Trạng thái tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0 — Safety net (Jest + baseline test + ESLint) | ✅ Xong | Xem chi tiết bên dưới |
| 1 — Dọn hạ tầng dùng chung | ✅ Xong | Xem chi tiết bên dưới |
| 2 — Module mẫu (pilot) | ✅ Xong | Module mẫu: `categories`. Pattern tham chiếu xem bên dưới |
| 3 — Nhân rộng các module | ☐ Chưa bắt đầu | |
| 4 — Dọn Lambda worker | ☐ Chưa bắt đầu | |
| 5 — CI | ☐ Chưa bắt đầu | |

## Trạng thái từng module (Giai đoạn 3)

Cột **Baseline test** = test được viết TRƯỚC khi sửa code của module (bước 0 trong PLAN.md Giai đoạn 3), dùng để xác nhận hành vi không đổi sau refactor. Bắt buộc phải ✅ cột này trước khi bắt đầu các cột Domain/Application/Infrastructure/Presentation.

| Module | Trạng thái | Baseline test | Domain | Application (use-cases) | Infrastructure (repo adapter) | Presentation | Test use-case | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| categories | ✅ Xong (module mẫu) | 🔶 unit test use-case (mock port), chưa có e2e/baseline trước-refactor vì đây là module mẫu đầu tiên | ✅ | ✅ | ✅ | ✅ | ✅ 11 test case | Module mẫu Giai đoạn 2. Behavior HTTP giữ nguyên (strangler) |
| inventory | ☐ Chưa bắt đầu | ✅ `inventory.service.spec.ts` (reserve/release) | | | | | | Ứng viên module mẫu. Baseline mới phủ reserve/release, chưa phủ findAll/pagination/updateAvailableQuantity — xem lại trước khi refactor các phần đó. Đã migrate sang `DomainError` (NotFoundError/ConflictError/InvalidInputError) và `DynamoTablesService` ở Giai đoạn 1 — service vẫn còn gọi DynamoDB Command trực tiếp (chưa tách Repository) |
| products | ☐ Chưa bắt đầu | ☐ | | | | | | |
| carts | ☐ Chưa bắt đầu | ☐ | | | | | | |
| users / auth | ☐ Chưa bắt đầu | 🔶 một phần (`roles.guard.spec.ts`) | | | | | | RolesGuard có test, nhưng JwtAuthGuard (verify JWT qua Cognito) và PermissionsGuard chưa có test |
| orders | ☐ Chưa bắt đầu | ☐ | | | | | | Phức tạp nhất — payments/VNPay, queue, events. Cần baseline cho checkout flow trước khi đụng vào |

Chú thích trạng thái: ☐ Chưa bắt đầu · 🔶 Một phần · 🔄 Đang làm · ✅ Xong · ⚠️ Blocked (xem ghi chú)

## Pattern tham chiếu (điền sau khi xong module mẫu ở Giai đoạn 2)

Module mẫu: **`categories`** (`src/categories/`). Copy đúng cấu trúc này cho `products`/`carts`/`users`/`orders` ở Giai đoạn 3, không tự sáng tạo lại.

```
categories/
├── domain/
│   ├── category.entity.ts           # interface thuần TS, giữ nguyên shape cũ (không đổi field)
│   └── category.repository.port.ts  # interface port + DI token (Symbol) + các type input/output của port
├── application/
│   ├── create-category.use-case.ts
│   ├── find-all-categories.use-case.ts
│   ├── find-one-category.use-case.ts
│   ├── update-category.use-case.ts
│   ├── delete-category.use-case.ts
│   └── categories.use-cases.spec.ts  # unit test, mock CategoryRepositoryPort bằng jest.fn(), không mock AWS SDK
├── infrastructure/
│   └── dynamodb-category.repository.ts  # implements port, chứa toàn bộ Command (Get/Put/Scan/UpdateCommand) + dịch lỗi AWS (ConditionalCheckFailedException) sang DomainError
└── presentation/
    ├── categories.controller.ts     # chỉ gọi use-case, không còn biết tới Service hay DynamoDB
    ├── dto/                          # request/response DTO (giữ nguyên tên/shape để không đổi HTTP contract)
    └── categories.module.ts         # wiring DI
```

Quyết định thiết kế quan trọng (áp dụng tiếp cho module sau):
- **1 method cũ = 1 use-case riêng** (không gộp use-case thành 1 class to). Mỗi use-case là 1 `@Injectable()` nhận port qua constructor (`@Inject(TOKEN)`).
- **DI token cho port**: `export const XXX_REPOSITORY = Symbol('XXX_REPOSITORY')` khai báo ngay trong file port, bind trong module bằng `{ provide: XXX_REPOSITORY, useClass: DynamoDbXxxRepository }`.
- **Timestamp sinh ở use-case, không sinh ở infrastructure**: use-case tạo `new Date().toISOString()` rồi truyền xuống port (để sau này test use-case dễ kiểm soát "thời điểm", infra chỉ ghi dữ liệu được đưa vào).
- **Business rule "ẩn bản ghi soft-delete" nằm ở use-case** cho `findOne` (infra trả `null`/raw record, use-case tự quyết định coi `status === 'DELETED'` là NotFoundError). Với `findAll`, filter `status <> DELETED` vẫn để trong Infrastructure (ScanCommand FilterExpression) vì đó là filter ở tầng truy vấn để tránh quét dư dữ liệu — ghi rõ bằng comment trên port method.
- **Pagination**: port's `findAll` trả `{ items, lastEvaluatedKey? }` thuần (không lộ kiểu AWS SDK). Use-case tự gọi `resolvePaginationState`/`toPaginatedResponse` (dùng chung `src/pagination/*`, giữ nguyên, KHÔNG viết lại cơ chế cursor).
- **Dịch lỗi AWS → DomainError nằm 100% trong Infrastructure** (`isConditionalCheckFailure` + throw `ConflictError`/`NotFoundError` từ `src/common/domain-error.ts`). Use-case/Controller không biết gì về `ConditionalCheckFailedException`.
- **Validate input tối thiểu** (vd "phải có ít nhất 1 field để update") ném `InvalidInputError`, không ném `BadRequestException` của Nest nữa.
- **Controller map DTO HTTP → input use-case bằng object literal tường minh** (không truyền thẳng DTO instance xuống use-case) để giữ DTO HTTP tách biệt khỏi input của use-case như PLAN.md yêu cầu.
- **Lint**: nếu viết test mock port bằng `jest.fn()` trên object literal, rule `@typescript-eslint/unbound-method` sẽ báo lỗi sai (false positive) khi `expect(repo.method).toHaveBeenCalledWith(...)` — đã tắt rule này cho `**/*.spec.ts` và `test/**/*.ts` trong `eslint.config.mjs`, không cần `eslint-disable` thủ công ở từng chỗ.
- Giữ nguyên toàn bộ HTTP contract (route, DTO field, response shape, permission/role decorator) — strangler pattern, không đổi API khi refactor.

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
- 2026-10-19: Hoàn thành Giai đoạn 2 (module mẫu pilot) với `categories`:
  - Tách `categories.service.ts` (197 dòng, gộp business logic + DynamoDB Command) thành 4 lớp: `domain/` (entity + repository port), `application/` (5 use-case: create/find-all/find-one/update/delete), `infrastructure/` (`DynamoDbCategoryRepository` implement port, chứa toàn bộ `GetCommand/PutCommand/ScanCommand/UpdateCommand` + dịch `ConditionalCheckFailedException` sang `ConflictError`/`NotFoundError`), `presentation/` (controller + dto + module, controller chỉ gọi use-case).
  - Validate input (`BadRequestException` cũ) đổi sang `InvalidInputError` (domain exception có sẵn từ Giai đoạn 1).
  - Xóa các file cũ: `categories.service.ts`, `categories.controller.ts`, `categories.module.ts`, `category.types.ts`, `categories/dto/*` (đã move vào `presentation/dto/`). Cập nhật import ở `app.module.ts` và `validation-pipe.spec.ts` trỏ sang `categories/presentation/...`.
  - Viết 11 unit test cho 5 use-case (`application/categories.use-cases.spec.ts`), mock `CategoryRepositoryPort` bằng `jest.fn()` (không cần mock AWS SDK — đúng mục tiêu tách lớp).
  - Thêm override ESLint: tắt `@typescript-eslint/unbound-method` cho `**/*.spec.ts`/`test/**/*.ts` (false positive với pattern `expect(mockedPort.method).toHaveBeenCalledWith(...)`), sẽ cần cho mọi module sau khi viết unit test use-case kiểu này.
  - Giữ nguyên 100% HTTP contract (route, DTO, response shape, Roles/Permissions decorator) — strangler pattern.
  - Kiểm tra: `tsc --noEmit` sạch, `npx eslint .` không phát sinh lỗi/warning mới trong `src/categories/**` (cảnh báo CRLF còn lại trên toàn repo là code cũ, đã biết từ Giai đoạn 0), `npx jest` 30/30 pass (19 cũ + 11 mới).
  - Pattern chi tiết đã ghi lại ở mục "Pattern tham chiếu" bên trên — Giai đoạn 3 copy nguyên cấu trúc này, không tự sáng tạo lại.
  - Lưu ý cho module sau: `categories` KHÔNG có baseline e2e/test viết trước-khi-sửa-code (vì là module mẫu đầu tiên, risk thấp, chấp nhận). Từ Giai đoạn 3 trở đi PHẢI có baseline test trước khi đụng code của module, theo đúng bước 0 trong PLAN.md.
