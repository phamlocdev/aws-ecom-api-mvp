import { randomUUID } from 'crypto'
import { z } from 'zod'
import { CartStatus } from './cart-status.enum'
import { InvalidInputError } from '../../common/domain-error'
import { BaseEntity } from '../../common/base.entity'

const CartPropsSchema = z.object({
  customerId: z.string(),
  cartId: z.string(),
  status: z.enum(['ACTIVE', 'EXPIRED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.number(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
})

type CartProps = {
  customerId: string
  cartId: string
  status: CartStatus
  createdAt: string
  updatedAt: string
  expiresAt: number
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

export type CreateCartData = {
  customerId: string
  expiresAt: number
}

const CartItemPropsSchema = z.object({
  cartId: z.string(),
  customerId: z.string(),
  productId: z.string(),
  quantity: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type CartItemProps = z.infer<typeof CartItemPropsSchema>

export type CreateCartItemData = {
  cartId: string
  customerId: string
  productId: string
  quantity: number
}

export class Cart extends BaseEntity<CartProps> {
  readonly customerId!: string
  readonly cartId!: string
  readonly status!: CartStatus
  readonly expiresAt!: number

  protected constructor(props: CartProps) {
    super()
    Object.assign(this, props)
  }

  static create(data: CreateCartData): Cart {
    const timestamp = new Date().toISOString()
    return new Cart({
      cartId: randomUUID(),
      status: CartStatus.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...data,
    })
  }

  static fromRecord(item: Record<string, unknown>): Cart {
    const parsed = CartPropsSchema.parse(item)
    return new Cart({ ...parsed, status: parsed.status as CartStatus })
  }

  get isExpired(): boolean {
    return this.status === CartStatus.EXPIRED || this.expiresAt <= Math.floor(Date.now() / 1000)
  }

  get isUsable(): boolean {
    return !this.isExpired
  }

  expire(updatedAt: string): this {
    if (this.status !== CartStatus.ACTIVE) {
      throw new InvalidInputError(`Cart ${this.cartId} is not active.`)
    }
    return this.with({ status: CartStatus.EXPIRED, updatedAt })
  }

  ensureUsable(): this {
    if (this.isExpired) {
      throw new InvalidInputError(`Cart ${this.cartId} has expired.`)
    }
    return this
  }
}

export class CartItem {
  readonly cartId!: string
  readonly customerId!: string
  readonly productId!: string
  readonly quantity!: number
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: CartItemProps) {
    Object.assign(this, props)
  }

  static create(data: CreateCartItemData): CartItem {
    const timestamp = new Date().toISOString()
    return new CartItem({
      createdAt: timestamp,
      updatedAt: timestamp,
      ...data,
    })
  }

  static fromRecord(item: Record<string, unknown>): CartItem {
    return new CartItem(CartItemPropsSchema.parse(item))
  }
}

export class CartDetails extends Cart {
  readonly items!: CartItem[]

  private constructor(props: CartProps & { items: CartItem[] }) {
    super(props)
    this.items = props.items
  }

  static fromParts(cart: Cart, items: CartItem[]): CartDetails {
    return new CartDetails({ ...(cart as unknown as CartProps), items })
  }
}
