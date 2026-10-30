import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { buildUserAuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../../carts/domain/cart.repository.port'
import { CartStatus } from '../../carts/domain/cart-status.enum'
import { ConflictError, InvalidInputError, NotFoundError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import {
  INVENTORY_REPOSITORY,
  InventoryRepositoryPort,
} from '../../inventory/domain/inventory.repository.port'
import { buildInventoryReleaseTransactItems } from '../../inventory/infrastructure/inventory-transact-items'
import {
  PRODUCT_REPOSITORY,
  ProductRepositoryPort,
} from '../../products/domain/product.repository.port'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../../users/domain/cognito-user.port'
import { Order, OrderItem } from '../domain/order.entity'
import {
  ORDER_ITEM_REPOSITORY,
  OrderItemRepositoryPort,
} from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { aggregateReservedQuantities, toEpochSeconds } from '../domain/order.rules'
import { buildOrderFailTransactItem } from '../infrastructure/order-transact-items'
import { CreateOrderInput } from './create-order-input.type'

@Injectable()
export class CreateOrderRequestUseCase {
  private readonly logger = new Logger(CreateOrderRequestUseCase.name)
  private readonly paymentConfirmationTimeoutSeconds: number

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: OrderItemRepositoryPort,
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserRepository: CognitoUserPort,
    @Inject(DynamoTablesService)
    private readonly dynamoTables: DynamoTablesService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.paymentConfirmationTimeoutSeconds = Number(
      configService.getOrThrow<number>('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT'),
    )
  }

  async execute(user: AuthenticatedUser, input: CreateOrderInput): Promise<Order> {
    const cart = await this.cartRepository.findOne(user.sub, input.cartId)

    if (!cart) throw new NotFoundError(`Cart ${input.cartId} was not found.`)

    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new InvalidInputError(`Cart ${input.cartId} has expired.`)
    }

    let customerEmail = user.email
    let customerName = user.name

    if (!customerEmail || !customerName) {
      const record = await this.cognitoUserRepository.getUserByUsername(user.username)
      customerEmail = customerEmail ?? record.attributes.email
      customerName = customerName ?? record.attributes.name
    }

    const createActor = buildUserAuditMutationContext(user, 'Order created')
    const order = Order.create({
      customerId: user.sub,
      customerEmail,
      customerName,
      additionalReceivingEmails: input.additionalReceivingEmails,
      cartId: input.cartId,
      lastModifiedByType: createActor.actorType,
      lastModifiedById: createActor.actorId,
      lastModifiedByEmail: createActor.actorEmail,
      lastModifiedReason: createActor.reason,
    })

    await this.orderRepository.create(order)

    this.logger.log(
      `>>>>>> [START]: Processing order ${order.orderId} for cart ${order.cartId} and customer ${order.customerId}.`,
    )

    const cartItems = await this.cartRepository.findItems(cart.cartId)
    if (cartItems.length === 0) {
      this.logger.warn(
        `>>>>>> [WARN]: Order ${order.orderId} failed because cart ${cart.cartId} has no items.`,
      )
      const failed = order
        .fail('Cart has no items.', new Date().toISOString())
        .withAudit(createActor)
      await this.orderRepository.save(failed)
      return order
    }

    const reservationSucceeded = await this.reserveItems(
      order.orderId,
      cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )

    if (reservationSucceeded) {
      await this.cartRepository.updateStatus(
        cart.customerId,
        cart.cartId,
        CartStatus.EXPIRED,
        new Date().toISOString(),
      )
    }

    const finalOrder = await this.orderRepository.findById(order.orderId)
    return finalOrder ?? order
  }

  private async reserveItems(
    orderId: string,
    cartItems: Array<{ productId: string; quantity: number }>,
  ): Promise<boolean> {
    const reservedItems: Array<{ productId: string; quantity: number }> = []
    const actor = systemAuditMutationContext('orders-service', 'Order reserved')

    try {
      const productSnapshots: Array<{
        item: { productId: string; quantity: number }
        product: Awaited<ReturnType<ProductRepositoryPort['findOne']>> & {}
      }> = []

      for (const item of cartItems) {
        const product = await this.productRepository.findOne(item.productId)
        if (!product) throw new NotFoundError(`Product ${item.productId} was not found.`)

        await this.inventoryRepository.reserve(item.productId, item.quantity, actor)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems = productSnapshots.map(({ item, product }, index) =>
        OrderItem.create({
          orderId,
          lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
          productId: product.productId,
          productName: product.name,
          imageUrl: product.imageUrl,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal: product.price * item.quantity,
          createdAt,
        }),
      )

      await this.orderItemRepository.createMany(orderItems)

      const totalAmount = Order.computeTotal(orderItems)
      const paymentExpiresAt = toEpochSeconds(Date.now()) + this.paymentConfirmationTimeoutSeconds

      const order = await this.orderRepository.findById(orderId)
      if (!order) throw new NotFoundError(`Order ${orderId} was not found.`)

      const reserved = order
        .reserve(totalAmount, paymentExpiresAt, createdAt)
        .withAudit(systemAuditMutationContext('orders-service', 'Order reserved'))
      await this.orderRepository.save(reserved)

      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )

      return true
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'
      const failActor = systemAuditMutationContext('orders-service', failureReason)

      if (reservedItems.length > 0) {
        const aggregatedItems = aggregateReservedQuantities(reservedItems)
        const failTimestamp = new Date().toISOString()
        const inventoryTransactItems = buildInventoryReleaseTransactItems(
          this.dynamoTables.inventory,
          aggregatedItems,
          failTimestamp,
          failActor,
        )
        const orderTransactItem = buildOrderFailTransactItem(
          this.dynamoTables.orders,
          orderId,
          failureReason,
          failActor,
        )
        await this.orderRepository.executeTransaction([
          orderTransactItem,
          ...inventoryTransactItems,
        ])
      } else {
        const order = await this.orderRepository.findById(orderId)
        if (order) {
          const failed = order.fail(failureReason, new Date().toISOString()).withAudit(failActor)
          await this.orderRepository.save(failed)
        }
      }

      if (error instanceof ConflictError) {
        this.logger.warn(
          `>>>>>> [FAIL]: Order ${orderId} failed during reservation: ${failureReason}`,
        )
        return false
      }

      this.logger.error(`>>>>>> [ERROR]: Order ${orderId} failed during processing.`, error)
      throw error
    }
  }
}
