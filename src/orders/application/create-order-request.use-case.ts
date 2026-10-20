import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { buildUserAuditMutationContext, toAuditMutationAttributes } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { GetCartItemsUseCase } from '../../carts/application/get-cart-items.use-case'
import { GetOwnedCartUseCase } from '../../carts/application/get-owned-cart.use-case'
import { MarkCartExpiredUseCase } from '../../carts/application/mark-cart-expired.use-case'
import { CartStatus } from '../../carts/domain/cart-status.enum'
import { InvalidInputError } from '../../common/domain-error'
import { InventoryService } from '../../inventory/inventory.service'
import { ReservedInventoryItem } from '../../inventory/inventory.types'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { UsersService } from '../../users/users.service'
import { Order, OrderItem } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { PaymentStatus } from '../domain/payment-status.enum'
import { normalizeAdditionalReceivingEmails } from '../domain/order.rules'
import { CreateOrderInput } from './create-order-input.type'
import { FailPendingOrderAndReleaseReservationUseCase } from './fail-pending-order-and-release-reservation.use-case'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { MarkFailedUseCase } from './mark-failed.use-case'
import { MarkReservedUseCase } from './mark-reserved.use-case'

const ORDERS_ENTITY_TYPE = 'ORDER'

@Injectable()
export class CreateOrderRequestUseCase {
  private readonly logger = new Logger(CreateOrderRequestUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
    @Inject(MarkCartExpiredUseCase)
    private readonly markCartExpiredUseCase: MarkCartExpiredUseCase,
    @Inject(InventoryService)
    private readonly inventoryService: InventoryService,
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(MarkReservedUseCase)
    private readonly markReservedUseCase: MarkReservedUseCase,
    @Inject(MarkFailedUseCase)
    private readonly markFailedUseCase: MarkFailedUseCase,
    @Inject(FailPendingOrderAndReleaseReservationUseCase)
    private readonly failPendingOrderAndReleaseReservationUseCase: FailPendingOrderAndReleaseReservationUseCase,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
  ) {}

  async execute(user: AuthenticatedUser, input: CreateOrderInput): Promise<Order> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, input.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new InvalidInputError(`Cart ${input.cartId} has expired.`)
    }

    const profile =
      user.name && user.email
        ? { username: user.username, name: user.name, email: user.email, sub: user.sub }
        : await this.usersService.findCustomerProfileByUsername(user.username)

    const timestamp = new Date().toISOString()
    const createActor = buildUserAuditMutationContext(user, 'Order created')
    const order: Order = {
      orderId: randomUUID(),
      customerId: user.sub,
      customerEmail: user.email ?? profile.email,
      customerName: user.name ?? profile.name,
      additionalReceivingEmails: normalizeAdditionalReceivingEmails(input.additionalReceivingEmails),
      cartId: input.cartId,
      status: OrderStatus.PENDING,
      entityType: ORDERS_ENTITY_TYPE,
      deduplicationKey: randomUUID(),
      paymentStatus: PaymentStatus.NOT_STARTED,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...toAuditMutationAttributes(createActor),
    }

    await this.orderRepository.create(order)

    this.logger.log(
      `>>>>>> [START]: Processing order ${order.orderId} for cart ${order.cartId} and customer ${order.customerId}.`,
    )

    const cartItems = await this.getCartItemsUseCase.execute(cart.cartId)
    if (cartItems.length === 0) {
      this.logger.warn(
        `>>>>>> [WARN]: Order ${order.orderId} failed because cart ${cart.cartId} has no items.`,
      )
      await this.markFailedUseCase.execute(order.orderId, OrderStatus.FAILED, 'Cart has no items.')
      return this.getOrderByIdUseCase.execute(order.orderId)
    }

    const reservedItems: ReservedInventoryItem[] = []
    let reservationSucceeded = false

    try {
      const productSnapshots: Array<{ item: (typeof cartItems)[number]; product: Product }> = []
      for (const item of cartItems) {
        const product = await this.findOneProductUseCase.execute(item.productId)

        await this.inventoryService.reserve(item.productId, item.quantity)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems: OrderItem[] = productSnapshots.map(({ item, product }, index) => ({
        orderId: order.orderId,
        lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
        productId: product.productId,
        productName: product.name,
        imageUrl: product.imageUrl,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity,
        createdAt,
      }))

      await this.orderRepository.createOrderItems(orderItems)

      const totalAmount = orderItems.reduce((total, item) => total + item.lineTotal, 0)
      await this.markReservedUseCase.execute(order.orderId, totalAmount)
      reservationSucceeded = true
      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${order.orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'

      if (reservedItems.length > 0) {
        await this.failPendingOrderAndReleaseReservationUseCase.execute(
          order.orderId,
          failureReason,
          reservedItems,
        )
      } else {
        await this.markFailedUseCase.execute(order.orderId, OrderStatus.FAILED, failureReason)
      }

      if (error instanceof ConflictException) {
        this.logger.warn(
          `>>>>>> [FAIL]: Order ${order.orderId} failed during reservation: ${failureReason}`,
        )
      } else {
        this.logger.error(`>>>>>> [ERROR]: Order ${order.orderId} failed during processing.`, error)
      }

      if (!(error instanceof ConflictException)) {
        throw error
      }
    }

    if (reservationSucceeded) {
      await this.markCartExpiredUseCase.execute(cart)
    }

    return this.getOrderByIdUseCase.execute(order.orderId)
  }
}
