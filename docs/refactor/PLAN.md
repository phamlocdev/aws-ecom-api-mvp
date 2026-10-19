# Kế hoạch refactor sang Clean Architecture

> File này là bản kế hoạch TĨNH (kiến trúc đích + các giai đoạn). Không ghi trạng thái "đã làm đến đâu" ở đây — trạng thái sống nằm ở [PROGRESS.md](./PROGRESS.md).

## Bối cảnh

Stack: NestJS 11 + DynamoDB thuần (AWS SDK v3, không ORM). Code đã tổ chức theo feature module (products, orders, users, carts, inventory, ...) nhưng trong từng module KHÔNG tách lớp: Service vừa chứa business logic vừa tự build DynamoDB Command (`TransactWriteCommand`, `ScanCommand`...) gọi thẳng `dynamoDbService.documentClient.send()`. Không có Repository/Port, không có Entity domain thuần. Không có test tự động (chưa có Jest).

## Kiến trúc đích cho mỗi module

```
<module>/
├── domain/              # Entity + Value Object thuần TS, KHÔNG phụ thuộc Nest/AWS SDK
│   ├── <module>.entity.ts
│   └── <module>.repository.port.ts   # interface (port)
├── application/         # Use-cases (business logic thuần túy, nhận port qua constructor)
│   ├── create-<module>.use-case.ts
│   ├── update-<module>.use-case.ts
│   └── dto/                          # input/output của use-case, KHÁC DTO HTTP
├── infrastructure/      # Adapter cụ thể
│   └── dynamodb-<module>.repository.ts   # implements port, chứa DynamoDB Command
└── presentation/         # NestJS layer
    ├── <module>.controller.ts
    ├── dto/                           # request/response DTO + class-validator
    └── <module>.module.ts            # wiring DI (bind interface token -> implementation)
```

Quy tắc phụ thuộc (bắt buộc tuân thủ khi refactor bất kỳ module nào):
- `presentation → application → domain`
- `infrastructure → domain` (implements port)
- `domain` KHÔNG được import bất cứ gì từ `@nestjs/*` hoặc `@aws-sdk/*`.
- Binding interface ↔ implementation dùng DI token (`Symbol`/abstract class), không inject thẳng class cụ thể.

## Các giai đoạn

### Giai đoạn 0 — Safety net (bắt buộc làm trước khi refactor module nào)
- Thêm Jest + `@nestjs/testing` + supertest.
- Viết test tích hợp/e2e baseline cho các luồng quan trọng nhất: auth, orders checkout, inventory — để có cơ sở so sánh hành vi trước/sau refactor.
- Thêm ESLint (hiện chưa có).

### Giai đoạn 1 — Dọn hạ tầng dùng chung
- Gộp `DtoValidationPipe` vào `ValidationPipe` global, bỏ trùng lặp.
- Tạo domain exception layer (`DomainError`, `NotFoundError`, ...) + 1 exception filter map sang HTTP response. Business logic không được throw thẳng NestJS exception nữa.
- Tập trung tên bảng DynamoDB (`PRODUCTS_TABLE`, `INVENTORY_TABLE`, ...) vào 1 config module thay vì rải `ConfigService.get(...)` khắp nơi.

### Giai đoạn 2 — Refactor module mẫu (pilot)
- Chọn `categories` hoặc `inventory` làm module mẫu (nhỏ, ít rủi ro) để rút ra pattern chuẩn: port, use-case, repository adapter, DI token.
- Pattern rút ra từ module mẫu phải được ghi lại (xem "Pattern tham chiếu" trong PROGRESS.md) để các module sau áp dụng nhất quán, không tự sáng tạo lại.

### Giai đoạn 3 — Nhân rộng theo thứ tự rủi ro tăng dần
Thứ tự: `products` → `carts` → `users`/`auth` → `orders` (phức tạp nhất: payments/VNPay, queue, events — để cuối cùng).

Mỗi module khi refactor:
1. Tách Entity domain khỏi DynamoDB item shape.
2. Định nghĩa Repository port (interface).
3. Chuyển toàn bộ DynamoDB Command ra Infrastructure adapter implement port đó.
4. Viết use-case cho từng nghiệp vụ (1 method = 1 use-case hoặc nhóm nhỏ liên quan).
5. Viết unit test cho use-case bằng cách mock repository port (không cần mock AWS SDK nữa).
6. Controller chỉ gọi use-case, không gọi thẳng service cũ.

`orders` module (55KB, có payment/VNPay, queue, events publisher) phải tách thành nhiều use-case nhỏ: `CreateOrderUseCase`, `CancelOrderUseCase`, `ConfirmPaymentUseCase`, ... thay vì 1 service khổng lồ.

### Giai đoạn 4 — Dọn các Lambda worker rời rạc
Các worker ở root `src/` (`order-expiry-poller.ts`, `product-seo-generator.ts`, `ses-event-processor.ts`, ...) refactor để gọi lại cùng use-case với controller, tránh trùng business logic giữa HTTP path và worker path.

### Giai đoạn 5 — CI
Thêm script `test`, `lint` thật vào CI. Script `test:*` hiện tại chỉ là ts-node simulate, không assert — không được tính là test suite thật.

## Nguyên tắc khi thực hiện (áp dụng cho mọi giai đoạn)

- **Strangler pattern**: giữ nguyên hành vi API/response shape trong lúc refactor từng module. Không đổi contract HTTP giữa chừng trừ khi có lý do rõ ràng và được xác nhận.
- Không đổi DynamoDB hay thêm ORM — đây là refactor tách lớp code, không phải đổi hạ tầng.
- Không refactor nhiều module cùng lúc trong 1 phiên nếu chưa xong Giai đoạn 0 (test baseline) cho module đó.
- Sau khi hoàn thành (một phần hoặc toàn bộ) 1 module/task, PHẢI cập nhật [PROGRESS.md](./PROGRESS.md) trước khi kết thúc phiên làm việc.
