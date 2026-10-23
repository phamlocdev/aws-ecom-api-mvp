# Rich Domain Model Refactor Plan

> Kế hoạch này là file TĨNH — đọc để hiểu approach và spec. Trạng thái tiến độ xem ở **PROGRESS.md** (mục "Giai đoạn 6").

## Bối cảnh

Sau khi hoàn thành Clean Architecture refactor (Giai đoạn 0–4) và chuyển entity sang class (RICH_DOMAIN_CLASS_PLAN.md, xong 2026-10-22), các entity vẫn là **Anemic Domain Model**: chỉ có `create()`, `fromRecord()`, `fromParts()`. Toàn bộ business logic nằm trong use-cases.

Kế hoạch này thực hiện bước tiếp theo: chuyển **single-entity logic** từ use-cases xuống entity, tạo **Rich Domain Model** thực sự.

---

## Nguyên tắc quyết định

**Di chuyển xuống entity khi:**
- Logic chỉ đọc/ghi fields của entity đó (state transition validation, computed values).
- Logic là pure function của entity state (không cần external service hay repository port).
- Logic bị lặp lại ở nhiều use-cases.

**Giữ nguyên trong use-case khi:**
- Logic orchestrate nhiều entities/services (cross-aggregate).
- Logic có side effects (gọi email, EventBridge, repository).
- Timestamp/clock: **luôn tạo trong use-case** (`new Date().toISOString()`), truyền vào entity method làm param — không tạo trong entity (giữ nguyên pattern hiện có).

**Pattern immutability (bắt buộc):**
- Entity methods **trả về instance mới**, KHÔNG mutate `this`.
- Giữ nguyên `readonly` field pattern.

**InventoryRecord — defense in depth:**
- Entity method: local validation + compute new state (fail fast, testable thuần túy).
- Repository: vẫn giữ DynamoDB `ConditionExpression` cho concurrent safety thật sự.
- Hai lớp bổ sung nhau — không thay thế nhau.

---

## Giai đoạn A — Computed Properties / Getters

Rủi ro thấp. **Không thay đổi use-cases hay tests hiện có.** Chỉ thêm methods/getters vào entity.

### A1. `Order`

```typescript
get isPaid(): boolean          // paymentStatus === PaymentStatus.PAID
get isCancelled(): boolean     // status === OrderStatus.CANCELLED
get isShipped(): boolean       // status === OrderStatus.SHIPPED
get isInTerminalState(): boolean // [CANCELLED, FAILED, EXPIRED].includes(status)
// isPaymentExpired() — giữ nguyên là method (dùng Date.now(), không phải pure getter)
```

### A2. `Cart`

```typescript
get isExpired(): boolean  // status === EXPIRED || expiresAt <= toEpochSeconds(Date.now())
get isUsable(): boolean   // !this.isExpired
```

### A3. `Product`

```typescript
get isActive(): boolean   // status === ProductStatus.ACTIVE
get isDeleted(): boolean  // status === ProductStatus.DELETED
```

### A4. `InventoryRecord`

```typescript
get isOutOfStock(): boolean  // availableQuantity <= 0
get totalQuantity(): number  // availableQuantity + reservedQuantity
```

### A5. `Category`

```typescript
get isActive(): boolean   // status === 'ACTIVE'
get isDeleted(): boolean  // status === 'DELETED'
```

### A6. `EmailTracking`

```typescript
get isRetryable(): boolean
// ['FAILED', 'BOUNCED'].includes(this.status) && this.bounceType !== 'Permanent'
```

Sau khi thêm getter này, `EmailTrackingView.isRetryable` field trở nên redundant vì nó được kế thừa từ
`EmailTracking`. Kiểm tra lại `fromParts()` và callers — nếu logic trùng khớp, xóa field riêng của
`EmailTrackingView` và bỏ parameter `isRetryable` khỏi `fromParts()`.

---

## Giai đoạn B — Domain Methods (State Transitions)

### B1. `Order` — phức tạp nhất

#### Bug fix bắt buộc trước khi làm B1

`reconcile-verified-gateway-result.use-case.ts` import `isOrderPaymentExpired` từ `order.rules.ts`
nhưng function này **không tồn tại** trong file đó → lỗi TypeScript tiềm ẩn. Fix: xóa import,
thay 2 call sites bằng `order.isPaymentExpired()`.

#### Guard methods (trả về boolean)

```typescript
canBeShipped(): boolean {
  return this.status === OrderStatus.CONFIRMED && this.paymentStatus === PaymentStatus.PAID
}

canBeCancelled(): boolean {
  // Same as canBeShipped: only CONFIRMED+PAID orders go through refund-cancel flow
  return this.status === OrderStatus.CONFIRMED && this.paymentStatus === PaymentStatus.PAID
}

canTriggerPayment(): boolean {
  return (
    this.status === OrderStatus.RESERVED &&
    this.paymentStatus !== PaymentStatus.PAID &&
    this.totalAmount !== undefined &&
    this.paymentExpiresAt !== undefined &&
    !this.isPaymentExpired()
  )
}

canExpireReservation(): boolean {
  return this.status === OrderStatus.RESERVED && this.isPaymentExpired()
}

isReadyToProcessPayment(): boolean {
  return this.status === OrderStatus.RESERVED && this.paymentStatus === PaymentStatus.PROCESSING
}
```

#### State transition methods (trả về `Order` mới)

```typescript
// Timestamps luôn được truyền vào từ use-case (không tạo bên trong entity)

reserve(totalAmount: number, paymentExpiresAt: number, reservedAt: string): Order
// Validates: status === PENDING
// Returns: Order with status=RESERVED, totalAmount, paymentExpiresAt, reservedAt, updatedAt

fail(reason: string, updatedAt: string): Order
// Validates: status is not already terminal
// Returns: Order with status=FAILED, failureReason=reason, updatedAt

ship(shippedAt: string): Order
// Validates: canBeShipped()
// Returns: Order with status=SHIPPED, shippedAt, updatedAt

cancelWithRefund(cancelledAt: string): Order
// Validates: canBeCancelled()
// Returns: Order with status=CANCELLED, cancelledAt, updatedAt

static computeTotal(items: Pick<OrderItem, 'lineTotal'>[]): number
// Pure static: sum of item.lineTotal (used in ReserveOrderCheckoutItemsUseCase)
```

**State transitions NOT to add** (giữ trong use-case/infra vì VNPay-specific hoặc quá complex):
- `confirmPayment()` / `failPayment()` / `refundExpiredPayment()` — phức tạp, gắn với VNPay response
- `startPaymentAttempt()` — gắn với VNPay payment attempt lifecycle

---

### B2. `Cart`

```typescript
expire(updatedAt: string): Cart
// Validates: status === ACTIVE
// Returns: Cart with status=EXPIRED, updatedAt

ensureUsable(): void
// Throws InvalidInputError nếu this.isExpired (move từ cart.rules.ensureCartUsable)
```

Sau khi thêm vào entity, xóa hoặc deprecate `deriveCartStatus()` và `ensureCartUsable()` trong
`cart.rules.ts` nếu không còn nơi nào gọi trực tiếp (use-cases sẽ gọi entity method thay thế).

---

### B3. `InventoryRecord`

```typescript
reserve(quantity: number, updatedAt: string): InventoryRecord {
  if (quantity <= 0) throw new InvalidInputError('Quantity must be positive')
  if (this.availableQuantity < quantity) {
    throw new ConflictError(
      `Insufficient inventory: need ${quantity}, available ${this.availableQuantity}`
    )
  }
  return new InventoryRecord({
    ...this,
    availableQuantity: this.availableQuantity - quantity,
    reservedQuantity: this.reservedQuantity + quantity,
    updatedAt,
  })
}

release(quantity: number, updatedAt: string): InventoryRecord {
  if (quantity <= 0) throw new InvalidInputError('Quantity must be positive')
  return new InventoryRecord({
    ...this,
    availableQuantity: this.availableQuantity + quantity,
    reservedQuantity: Math.max(0, this.reservedQuantity - quantity),
    updatedAt,
  })
}
```

Repository `dynamodb-inventory.repository.ts` **giữ nguyên** `ConditionExpression` trên `UpdateCommand`
— không refactor infra trong giai đoạn này.

---

### B4. `Product`

```typescript
deactivate(updatedAt: string): Product
// Validates: isActive()
// Returns: Product with status=INACTIVE, updatedAt

activate(updatedAt: string): Product
// Validates: status === INACTIVE
// Returns: Product with status=ACTIVE, updatedAt

delete(deletedAt: string): Product
// Validates: !isDeleted()
// Returns: Product with status=DELETED, deletedAt, updatedAt=deletedAt
```

---

### B5. `Category`

```typescript
delete(deletedAt: string): Category
// Validates: isActive()
// Returns: Category with status='DELETED', deletedAt, updatedAt=deletedAt
```

---

## Giai đoạn C — Thin Use-Cases

Sau khi thêm entity methods ở Phase B, cập nhật từng use-case để delegate.

### Pattern chung

```typescript
// BEFORE: validation logic nằm trong use-case
async execute(orderId: string, actor: AuditMutationContext) {
  const order = await this.repo.findById(orderId)
  if (!order) throw new NotFoundError(...)
  if (order.status === OrderStatus.SHIPPED) return order           // idempotency
  if (order.status !== OrderStatus.CONFIRMED
    || order.paymentStatus !== PaymentStatus.PAID) {
    throw new ConflictError('Order cannot be shipped')
  }
  const shippedAt = new Date().toISOString()
  return this.repo.markShipped(orderId, shippedAt, actor)
}

// AFTER: entity encapsulates validation logic
async execute(orderId: string, actor: AuditMutationContext) {
  const order = await this.repo.findById(orderId)
  if (!order) throw new NotFoundError(...)
  if (order.isShipped) return order                                // getter
  if (!order.canBeShipped()) throw new ConflictError('Order cannot be shipped')
  const shippedAt = new Date().toISOString()
  return this.repo.markShipped(orderId, shippedAt, actor)
}
```

### Use-cases cần cập nhật per entity

**Order:**
- `MarkOrderShippedUseCase` → dùng `order.isShipped`, `order.canBeShipped()`
- `CancelConfirmedPaidOrderUseCase` → dùng `order.isCancelled`, `order.canBeCancelled()`
- `TriggerPaymentUseCase` → dùng `order.canTriggerPayment()`
- `ReleaseExpiredOrderReservationUseCase` → dùng `order.canExpireReservation()`
- `ReconcileVerifiedGatewayResultUseCase` → fix bug + dùng `order.isReadyToProcessPayment()`, `order.isPaid`
- `ReserveOrderCheckoutItemsUseCase` → dùng `Order.computeTotal(items)`

**Cart:**
- `AddCartItemUseCase`, `UpdateCartItemUseCase`, `RemoveCartItemUseCase` → dùng `cart.ensureUsable()`
- `GetOwnedCartUseCase` → dùng `cart.isExpired` thay vì gọi `deriveCartStatus()`
- `MarkCartExpiredUseCase` → dùng `cart.expire(updatedAt)`

**InventoryRecord:**
- `ReserveInventoryUseCase` → gọi `inventory.reserve(quantity, updatedAt)` trước khi gọi repo (fast fail)
- `ReleaseInventoryUseCase` → gọi `inventory.release(quantity, updatedAt)` trước khi gọi repo

**Product:**
- `UpdateProductUseCase` → dùng `product.deactivate()` / `product.activate()` nếu status thay đổi
- `DeleteProductUseCase` → dùng `product.delete(deletedAt)`

**Category:**
- `DeleteCategoryUseCase` → dùng `category.delete(deletedAt)`

---

## Giai đoạn D — Update Tests

### D1. Entity unit test files (NEW)

Tạo file spec cạnh mỗi entity file. **Zero mocks, zero AWS SDK.**

```
src/orders/domain/order.entity.spec.ts
src/carts/domain/cart.entity.spec.ts
src/inventory/domain/inventory.entity.spec.ts
src/products/domain/product.entity.spec.ts
src/categories/domain/category.entity.spec.ts
src/mail/domain/email-tracking.entity.spec.ts
```

Pattern:

```typescript
describe('Order.canBeShipped()', () => {
  it('returns true when CONFIRMED + PAID', () => {
    const order = Order.fromRecord({
      orderId: 'o1', customerId: 'c1', cartId: 'cart1',
      status: 'CONFIRMED', paymentStatus: 'PAID',
      entityType: 'ORDER', deduplicationKey: 'dk1',
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    })
    expect(order.canBeShipped()).toBe(true)
  })

  it('returns false when RESERVED', () => {
    const order = Order.fromRecord({ ...minimalOrderRecord, status: 'RESERVED' })
    expect(order.canBeShipped()).toBe(false)
  })
})

describe('InventoryRecord.reserve()', () => {
  it('returns new record with updated quantities', () => {
    const inv = InventoryRecord.fromRecord({
      productId: 'p1', availableQuantity: 10, reservedQuantity: 2,
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
    const result = inv.reserve(3, '2024-01-02T00:00:00.000Z')
    expect(result.availableQuantity).toBe(7)
    expect(result.reservedQuantity).toBe(5)
  })

  it('throws ConflictError when insufficient', () => {
    const inv = InventoryRecord.fromRecord({ ...minimalInvRecord, availableQuantity: 2 })
    expect(() => inv.reserve(5, '2024-01-02T00:00:00.000Z')).toThrow(ConflictError)
  })
})
```

### D2. Update use-case unit tests

Khi use-case delegate sang entity method, test use-case trở nên **mỏng hơn**:
- **Xóa**: assertions kiểm tra business rule (nay được phủ bởi entity spec).
- **Giữ**: assertions xác nhận use-case gọi đúng repo method với đúng args.
- **Giữ**: assertions cho orchestration (thứ tự gọi, error handling).

### D3. Integration tests

Thay đổi tối thiểu. Nếu external behavior (HTTP status, response shape) không đổi, integration tests
hầu như không cần sửa — chỉ cần cập nhật fixture setup nếu factory method signature thay đổi.

---

## Thứ tự thực hiện (gợi ý per session)

| Session | Nội dung | Giai đoạn |
|---|---|---|
| 1 | Computed getters cho tất cả entity | A (toàn bộ) |
| 2 | Order: fix bug + guard methods + state transitions + update use-cases | B1 + C (Order) |
| 3 | Cart + InventoryRecord: domain methods + update use-cases | B2+B3 + C (Cart, Inventory) |
| 4 | Product + Category: domain methods + update use-cases | B4+B5 + C (Product, Category) |
| 5 | Entity unit tests cho tất cả entity + update use-case tests | D (toàn bộ) |

Mỗi session kết thúc: chạy `tsc --noEmit` + `npx jest` để xác nhận không có regression, rồi cập nhật
bảng tracking trong **PROGRESS.md** trước khi kết thúc.

---

## Checklist per entity (trước khi đánh dấu xong)

- [ ] Computed getters thêm đúng và pure (không side effects)
- [ ] Domain methods thêm đúng (validate → return new instance hoặc throw)
- [ ] Bug fix `isOrderPaymentExpired` đã áp dụng (chỉ cho Order)
- [ ] Use-cases tương ứng đã cập nhật để dùng entity methods
- [ ] Entity unit test file tạo với đủ test cases (happy path + error path cho mỗi method)
- [ ] Use-case unit tests đã cập nhật (xóa redundant assertions, giữ orchestration assertions)
- [ ] `tsc --noEmit` pass với zero lỗi mới
- [ ] `npx jest` pass không có regression
- [ ] PROGRESS.md cập nhật trước khi kết thúc session
