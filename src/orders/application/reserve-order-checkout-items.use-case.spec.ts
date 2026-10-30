import { ConflictError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { InventoryRepositoryPort } from '../../inventory/domain/inventory.repository.port'
import { Product } from '../../products/domain/product.entity'
import { ProductRepositoryPort } from '../../products/domain/product.repository.port'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { Order } from '../domain/order.entity'
import { OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { OrderStatus } from '../domain/order-status.enum'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderRepositoryPort } from '../domain/order.repository.port'
import { ReserveOrderCheckoutItemsUseCase } from './reserve-order-checkout-items.use-case'

const product = Product.fromRecord({
  productId: 'p1',
  name: 'Headphones',
  description: 'Wireless headphones',
  categoryId: 'electronics',
  price: 100000,
  currency: 'VND',
  status: ProductStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function makePendingOrder(): Order {
  return Order.fromRecord({
    orderId: 'order-1',
    customerId: 'customer-1',
    customerEmail: 'customer@example.com',
    customerName: 'Customer One',
    cartId: 'cart-1',
    status: OrderStatus.PENDING,
    entityType: 'ORDER',
    deduplicationKey: 'dedup-1',
    paymentStatus: PaymentStatus.NOT_STARTED,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function createDeps() {
  const repository: jest.Mocked<OrderRepositoryPort> = {
    create: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockImplementation(() => Promise.resolve(makePendingOrder())),
    findMany: jest.fn(),
    findExpiredReserved: jest.fn(),
    executeTransaction: jest.fn().mockResolvedValue(undefined),
  }

  const orderItemRepository: jest.Mocked<OrderItemRepositoryPort> = {
    createMany: jest.fn().mockResolvedValue(undefined),
    findByOrderId: jest.fn(),
  }

  const inventoryRepository: jest.Mocked<InventoryRepositoryPort> = {
    ensureRecord: jest.fn(),
    findOne: jest.fn(),
    findOneSummary: jest.fn(),
    findSummariesByProductIds: jest.fn(),
    findAllSummaries: jest.fn(),
    updateAvailableQuantity: jest.fn(),
    reserve: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  }

  const productRepository: jest.Mocked<ProductRepositoryPort> = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn().mockResolvedValue(product),
    update: jest.fn(),
    remove: jest.fn(),
  }

  const dynamoTables = { orders: 'orders-test', inventory: 'inventory-test' } as unknown as DynamoTablesService
  const configService = { getOrThrow: jest.fn().mockReturnValue(60) }

  const useCase = new ReserveOrderCheckoutItemsUseCase(
    repository,
    orderItemRepository,
    inventoryRepository,
    productRepository,
    dynamoTables,
    configService as never,
  )

  return { repository, orderItemRepository, inventoryRepository, productRepository, dynamoTables, configService, useCase }
}

describe('ReserveOrderCheckoutItemsUseCase', () => {
  it('reserves inventory, persists order items and saves the order as RESERVED', async () => {
    const { inventoryRepository, orderItemRepository, repository, useCase } = createDeps()

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 2 }],
    })

    expect(inventoryRepository.reserve).toHaveBeenCalledWith(
      'p1',
      2,
      expect.objectContaining({ actorType: 'system' }),
    )
    expect(orderItemRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        orderId: 'order-1',
        productId: 'p1',
        quantity: 2,
        lineTotal: 200000,
      }),
    ])
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.RESERVED }),
    )
    expect(result).toEqual({ reservationSucceeded: true })
  })

  it('swallows a ConflictError (insufficient inventory) and releases already-reserved items without rethrowing', async () => {
    const { inventoryRepository, repository, useCase } = createDeps()
    inventoryRepository.reserve
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConflictError('Insufficient inventory for product p2.'))

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [
        { productId: 'p1', quantity: 1 },
        { productId: 'p2', quantity: 1 },
      ],
    })

    expect(repository.executeTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ Update: expect.objectContaining({ TableName: 'orders-test' }) }),
      ]),
    )
    expect(repository.save).not.toHaveBeenCalled()
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('swallows a ConflictError on the very first item (nothing reserved yet) and saves the order as FAILED', async () => {
    const { inventoryRepository, repository, useCase } = createDeps()
    inventoryRepository.reserve.mockRejectedValue(
      new ConflictError('Insufficient inventory for product p1.'),
    )

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
    })

    expect(repository.executeTransaction).not.toHaveBeenCalled()
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.FAILED }),
    )
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('uses the provided actorId as the system actor identity', async () => {
    const { repository, useCase } = createDeps()

    await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
      actorId: 'place-order-worker',
    })

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.RESERVED }),
    )
  })

  it('rethrows an unexpected (non-ConflictError) error after saving the order as FAILED', async () => {
    const { inventoryRepository, repository, useCase } = createDeps()
    inventoryRepository.reserve.mockRejectedValue(new Error('DynamoDB is unavailable.'))

    await expect(
      useCase.execute({ orderId: 'order-1', cartItems: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow('DynamoDB is unavailable.')
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.FAILED }),
    )
  })
})
