# Rich Domain Class Refactor — Plan for Remaining Modules

## Context

The `orders` module has been fully refactored as the **reference implementation**. Every other module listed below must follow the exact same pattern. Read the orders module source before touching any other module.

**Reference files (read these first):**
- `src/orders/domain/order.entity.ts` — canonical class pattern
- `src/orders/infrastructure/dynamodb-order.repository.ts` — canonical repository pattern
- `src/orders/application/create-order-request.use-case.ts` — canonical use-case creation pattern

---

## Core Pattern

### Domain entity class

```ts
// 1. Private internal props type (replaces the old interface, not exported)
type XxxProps = {
  fieldA: string
  fieldB?: number
  // ... all fields
}

// 2. Input type for new entity creation (exported, only user-supplied fields)
export type CreateXxxData = {
  fieldA: string
  // generated fields (id, status, timestamps) are NOT here
}

// 3. The class
export class Xxx {
  readonly fieldA!: string
  readonly fieldB?: number
  // ... all fields with ! on required, ? on optional

  // private (or protected when subclasses exist — see "Read-model classes" below)
  private constructor(props: XxxProps) {
    Object.assign(this, props)
  }

  // Factory for new entity — generates id, sets defaults/timestamps
  // Only add this method if the entity is ever created as a new record in a use-case.
  // If the entity is only ever read from DynamoDB, omit create() and only keep fromRecord().
  static create(data: CreateXxxData): Xxx {
    const timestamp = new Date().toISOString()
    return new Xxx({
      xxxId: randomUUID(),
      status: XxxStatus.ACTIVE,        // default
      createdAt: timestamp,
      updatedAt: timestamp,
      ...data,
    })
  }

  // Factory for DynamoDB reconstruction — never generates new values
  static fromRecord(item: Record<string, unknown>): Xxx {
    return new Xxx(item as XxxProps)
  }

  // Business methods (if any)
  isActive(): boolean {
    return this.status === XxxStatus.ACTIVE
  }
}
```

### DynamoDB write

When passing a class instance to DynamoDB, always spread to a plain object to be explicit:

```ts
// In repository
await client.send(new PutCommand({ Item: { ...entity } }))
// or for UpdateCommand keys/values: use entity.fieldA directly — no spread needed
```

### DynamoDB read

Replace all `as XxxInterface` casts in repositories with factory calls:

```ts
// Before
return response.Item as Xxx

// After
return response.Item ? Xxx.fromRecord(response.Item) : null

// Before
return (response.Items ?? []) as Xxx[]

// After
return (response.Items ?? []).map(Xxx.fromRecord)
```

---

## Read-model classes

Some entities have projection types that add extra fields (e.g., `CartDetails extends Cart`). The user has decided these should also be classes.

**Constraint:** A class with a `private constructor` cannot be extended. When a parent entity has a read-model subclass, change the parent's constructor to `protected`.

```ts
export class Cart {
  // ... fields

  protected constructor(props: CartProps) {  // ← protected, not private
    Object.assign(this, props)
  }

  static create(data: CreateCartData): Cart { ... }
  static fromRecord(item: Record<string, unknown>): Cart { ... }
}

export class CartDetails extends Cart {
  readonly items!: CartItem[]

  private constructor(props: CartProps & { items: CartItem[] }) {
    super(props)
    this.items = props.items
  }

  // Named factory — takes an already-constructed parent instance and the extra data
  static fromParts(cart: Cart, items: CartItem[]): CartDetails {
    return new CartDetails({ ...(cart as unknown as CartProps), items })
  }
}
```

Usage in use-case:
```ts
// Before
return { ...cart, items }

// After
return CartDetails.fromParts(cart, items)
```

---

## Nested value object classes (ProductImage, UserAddress)

When a field inside an entity is itself a class (e.g., `Product.images: ProductImage[]`), `Object.assign` in `fromRecord()` will set that field to the raw DynamoDB value (a plain object array). The field must be explicitly mapped:

```ts
export class Product {
  static fromRecord(item: Record<string, unknown>): Product {
    const raw = item as ProductProps
    return new Product({
      ...raw,
      images: Array.isArray(raw.images)
        ? (raw.images as Record<string, unknown>[]).map(ProductImage.fromRecord)
        : undefined,
    })
  }
}
```

Similarly for `UserAccount`/`UserProfile` which contain `UserAddress`:
```ts
return new UserAccount({
  ...raw,
  address: raw.address ? UserAddress.fromRecord(raw.address as Record<string, unknown>) : undefined,
})
```

---

## What NOT to convert

Leave the following as interfaces/types — they are DTOs, result wrappers, or external-system shapes, not persisted domain entities:

| Type | Location | Reason |
|---|---|---|
| `ReservedInventoryItem` | `inventory/domain/inventory.entity.ts` | Tiny input DTO (productId + quantity), no persistence |
| `ManagedUser` | `users/domain/user.entity.ts` | Read-model from Cognito, not a DynamoDB entity |
| `CustomerProfile` | `users/domain/user.entity.ts` | Thin DTO for email/name lookup |
| `ResendUserEmailResult` | `users/domain/user.entity.ts` | Operation result DTO |
| `DynamoDbStreamRecord` | `audit/audit-log.service.ts` | Infrastructure event DTO |
| `AuditLogDocumentClient` | `audit/audit-log.service.ts` | Repository port interface — must stay interface |
| All `SendXxxEmailInput` interfaces | `mail/mail.types.ts` | Service input DTOs |
| `EmailSendResult` | `mail/mail.types.ts` | Operation result DTO |
| `EmailDeliveryStatistics` | `mail/mail.types.ts` | Aggregated stats type, not persisted |
| `AuditMutationContext` | `audit/audit-actor.ts` | Value object used as input, not persisted |
| All string union types | various | Already fine as type aliases |

---

## Module-by-module spec

### 1. `categories` — simplest, start here

**Entity file:** `src/categories/domain/category.entity.ts`

Convert:
- `Category` interface → `Category` class
  - `private constructor`
  - `static create(data: CreateCategoryData): Category` — generates `categoryId` (UUID), sets `status: 'ACTIVE'`, timestamps
  - `static fromRecord(item): Category`
  - No business methods needed

No read-model subclasses → `private constructor` is fine.

Files to update after entity change:
- `src/categories/infrastructure/dynamodb-category.repository.ts` — replace `as Category` / `as Category[]`
- Any use-case that creates a `Category` as a plain object literal → use `Category.create()`
- Any spec file that creates a `Category` fixture as plain object → use `Category.fromRecord()`

---

### 2. `carts`

**Entity file:** `src/carts/domain/cart.entity.ts`

Convert:
- `Cart` interface → `Cart` class
  - `protected constructor` (because `CartDetails` extends it)
  - `static create(data: CreateCartData): Cart`
  - `static fromRecord(item): Cart`
- `CartItem` interface → `CartItem` class
  - `private constructor`
  - `static create(data: CreateCartItemData): CartItem`
  - `static fromRecord(item): CartItem`
- `CartDetails` interface → `CartDetails` class **extends** `Cart`
  - `private constructor(props: CartProps & { items: CartItem[] })`
  - `static fromParts(cart: Cart, items: CartItem[]): CartDetails`
  - No `fromRecord()` — CartDetails is never stored as a single DynamoDB item

Files to update:
- `src/carts/infrastructure/dynamodb-cart.repository.ts` — replace all casts
- `src/carts/application/*.use-case.ts` — use factories, update any `{ ...cart, items }` to `CartDetails.fromParts(cart, items)`
- Spec files — update fixtures

---

### 3. `products`

**Entity file:** `src/products/domain/product.entity.ts`

Convert:
- `ProductImage` interface → `ProductImage` class
  - `private constructor`
  - `static create(data: CreateProductImageData): ProductImage`
  - `static fromRecord(item): ProductImage`
  - No business methods
- `Product` interface → `Product` class
  - `private constructor` (no subclasses)
  - `static create(data: CreateProductData): Product`
  - `static fromRecord(item): Product`
    - **Special:** must map `images` array: `images: raw.images ? (raw.images as Record<string, unknown>[]).map(ProductImage.fromRecord) : undefined`
  - No read-model subclass

Files to update:
- `src/products/infrastructure/dynamodb-product.repository.ts` — replace casts
- `src/products/application/*.use-case.ts` — use factories
- Spec files — update fixtures

---

### 4. `inventory`

**Entity file:** `src/inventory/domain/inventory.entity.ts`

Convert:
- `InventoryRecord` interface → `InventoryRecord` class
  - `protected constructor` (because `InventorySummary` extends it)
  - `static create(data: CreateInventoryRecordData): InventoryRecord` — if use-cases create new records
  - `static fromRecord(item): InventoryRecord`
- `InventorySummary` interface → `InventorySummary` class **extends** `InventoryRecord`
  - `private constructor`
  - `static fromParts(record: InventoryRecord, summary: { productName, categoryId, imageUrl?, productStatus }): InventorySummary`
  - No `fromRecord()` — InventorySummary is assembled from multiple sources, not stored as a single DynamoDB item
- `ReservedInventoryItem` — **keep as interface**, do not convert

Files to update:
- `src/inventory/infrastructure/dynamodb-inventory.repository.ts` — replace casts
- `src/inventory/application/*.use-case.ts` — use factories
- Spec files — update fixtures

---

### 5. `users`

**Entity file:** `src/users/domain/user.entity.ts`

Convert (persisted DynamoDB entities):
- `UserAddress` type → `UserAddress` class
  - `private constructor`
  - `static create(data: UserAddressData): UserAddress`
  - `static fromRecord(item): UserAddress`
  - Nested value object — used inside `UserAccount` and `UserProfile`
- `UserProfile` interface → `UserProfile` class
  - `private constructor`
  - `static create(data): UserProfile`
  - `static fromRecord(item): UserProfile`
    - **Special:** map `address` field: `address: raw.address ? UserAddress.fromRecord(raw.address as Record<string, unknown>) : undefined`
- `UserAccount` type → `UserAccount` class
  - `private constructor`
  - `static create(data): UserAccount` — if use-cases create UserAccount as new records; otherwise only `fromRecord()`
  - `static fromRecord(item): UserAccount`
    - **Special:** map `address` field like UserProfile
- `UserPermissionsRecord` type → `UserPermissionsRecord` class
  - `private constructor`
  - `static create(data): UserPermissionsRecord`
  - `static fromRecord(item): UserPermissionsRecord`
- `UserLoginAudit` type → `UserLoginAudit` class
  - `private constructor`
  - `static create(data): UserLoginAudit`
  - `static fromRecord(item): UserLoginAudit`
- `UserLoginAuditQueryResult` type → `UserLoginAuditQueryResult` class
  - `private constructor`
  - `static fromParts(items: UserLoginAudit[], nextCursor: string | null): UserLoginAuditQueryResult`

Keep as-is (do NOT convert):
- `ManagedUser` — Cognito DTO, not a DynamoDB entity
- `UserAccountStatus`, `UserPasswordStatus` — string union types
- `CustomerProfile` — thin DTO
- `ResendUserEmailResult` — operation result

Files to update:
- `src/users/infrastructure/dynamodb-user.repository.ts` — replace casts
- `src/users/application/*.use-case.ts` — use factories
- Spec files — update fixtures

---

### 6. `audit` — requires file extraction

**Current problem:** `AuditLogItem` and related types are defined inside `src/audit/audit-log.service.ts` (mixed with service implementation code). They must be extracted first.

**Step 1 — Extract to entity file:**

Create `src/audit/domain/audit-log.entity.ts` with the entity class. Move `AuditLogItem`, `AuditLogQueryResult`, and `AuditEntityType`/`AUDIT_ENTITY_TYPES` out of the service file into this new file.

Convert:
- `AuditLogItem` interface → `AuditLogItem` class
  - `private constructor`
  - `static create(data): AuditLogItem` — for writing new audit entries
  - `static fromRecord(item): AuditLogItem` — for DynamoDB reads
- `AuditLogQueryResult` interface → `AuditLogQueryResult` class
  - `private constructor`
  - `static fromParts(items: AuditLogItem[], nextCursor: string | null): AuditLogQueryResult`

Keep in `audit-log.service.ts` (infrastructure-specific, do NOT move):
- `DynamoDbStreamRecord` interface
- `AuditLogDocumentClient` interface
- Internal types (`AuditEventName`, `AuditActorType`, `AuditFieldChange`, `AuditDiff`, `AuditEntityConfig`)

**Step 2 — Update imports:**

Update `audit-log.service.ts` to import from the new entity file. Update any other files that import `AuditLogItem` or `AuditLogQueryResult` from the service file.

---

### 7. `mail` — requires file reorganization

**Current problem:** `EmailTracking` and `EmailTrackingView` are persisted entity types living inside `src/mail/mail.types.ts` alongside many unrelated DTOs.

**Step 1 — Extract to entity file:**

Create `src/mail/domain/email-tracking.entity.ts`. Move `EmailTracking` and `EmailTrackingView` (and `EmailDeliverySummary` since it's a projection) into this file.

Convert:
- `EmailTracking` interface → `EmailTracking` class
  - `protected constructor` (because `EmailTrackingView` extends it)
  - `static create(data: CreateEmailTrackingData): EmailTracking`
  - `static fromRecord(item): EmailTracking`
- `EmailTrackingView` interface → `EmailTrackingView` class **extends** `EmailTracking`
  - `private constructor`
  - `static fromParts(tracking: EmailTracking, isRetryable: boolean): EmailTrackingView`
- `EmailDeliverySummary` interface → `EmailDeliverySummary` class
  - `private constructor`
  - `static create(data: EmailDeliverySummaryData): EmailDeliverySummary`
  - `static fromRecord(item): EmailDeliverySummary` (if read from DynamoDB)

Keep in `mail/mail.types.ts` (do NOT move — they are DTOs):
- All `SendXxxEmailInput` interfaces
- `EmailSendResult`
- `EmailSendStatus`, `EmailIdempotencyMode`
- `EmailDeliveryStatus`, `EmailType`, `CognitoAuthEmailType`, `EmailContextType`
- `EMAIL_DELIVERY_STATUSES`
- `EmailDeliveryStatistics`

**Step 2 — Update imports:**

`mail.types.ts` currently imports `Order` and `OrderItem` from the orders module for the `SendXxxEmailInput` interfaces — those imports stay. Update any files that import `EmailTracking` / `EmailTrackingView` / `EmailDeliverySummary` to import from the new entity file.

---

## Execution order (recommended)

Tackle modules from simplest to most complex. Each module is independent and can be done in isolation:

1. `categories` — 1 entity, no nested types, no subclasses
2. `carts` — 2 entities + 1 read-model subclass
3. `products` — 1 entity + 1 nested value object
4. `inventory` — 1 entity + 1 read-model subclass
5. `users` — most complex: 5 entities, nested value object, file reorganization not needed
6. `audit` — requires file extraction before class conversion
7. `mail` — requires file reorganization before class conversion

---

## Checklist for each module

Before marking a module done, verify:

- [ ] All target entity interfaces/types converted to classes with `private`/`protected` constructor
- [ ] `static create()` added for entities that are created as new records in use-cases
- [ ] `static fromRecord()` added for all entities read from DynamoDB
- [ ] `static fromParts()` added for read-model subclasses
- [ ] All `as XxxInterface` casts in repositories replaced with `Xxx.fromRecord(item)`
- [ ] All `Item: entity` in PutCommand replaced with `Item: { ...entity }`
- [ ] All plain object literals `{ id: ..., status: ..., createdAt: ... }` in use-cases replaced with `Xxx.create()`
- [ ] All test fixtures that assigned plain objects to the entity type updated to use `Xxx.fromRecord()`
- [ ] `tsc --noEmit` passes with zero new errors for this module
