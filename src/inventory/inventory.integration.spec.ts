import { mockClient } from 'aws-sdk-client-mock'
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConflictError, InvalidInputError, NotFoundError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import { ProductStatus } from '../products/domain/product-status.enum'
import { DynamoDbInventoryRepository } from './infrastructure/dynamodb-inventory.repository'
import { InventoryRepositoryPort } from './domain/inventory.repository.port'
import { FindAllInventoriesUseCase } from './application/find-all-inventories.use-case'
import { FindOneInventoryUseCase } from './application/find-one-inventory.use-case'
import { UpdateInventoryQuantityUseCase } from './application/update-inventory-quantity.use-case'
import { ReserveInventoryUseCase } from './application/reserve-inventory.use-case'
import { ReleaseInventoryUseCase } from './application/release-inventory.use-case'

// Giai đoạn 3 step 0/7 baseline for `inventory` (see docs/refactor/PLAN.md):
// originally written against the pre-refactor monolithic InventoryService
// (src/inventory/inventory.service.spec.ts), now driving the post-refactor
// use-cases + DynamoDbInventoryRepository to confirm the DynamoDB contract
// and business behavior did not change (strangler pattern).
describe('inventory use-cases (post-refactor baseline)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let repository: InventoryRepositoryPort
  let findAllInventoriesUseCase: FindAllInventoriesUseCase
  let findOneInventoryUseCase: FindOneInventoryUseCase
  let updateInventoryQuantityUseCase: UpdateInventoryQuantityUseCase
  let reserveInventoryUseCase: ReserveInventoryUseCase
  let releaseInventoryUseCase: ReleaseInventoryUseCase

  const adminUser: AuthenticatedUser = {
    sub: 'admin-1',
    username: 'admin',
    email: 'admin@example.com',
    groups: [Role.ADMIN],
    permissions: [],
    tokenUse: 'access',
    clientId: 'test-client',
  }

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      inventory: 'inventory-test',
      products: 'products-test',
    } as unknown as DynamoTablesService

    repository = new DynamoDbInventoryRepository(dynamoDbService, dynamoTables)
    findAllInventoriesUseCase = new FindAllInventoriesUseCase(repository)
    findOneInventoryUseCase = new FindOneInventoryUseCase(repository)
    updateInventoryQuantityUseCase = new UpdateInventoryQuantityUseCase(repository)
    reserveInventoryUseCase = new ReserveInventoryUseCase(repository)
    releaseInventoryUseCase = new ReleaseInventoryUseCase(repository)
  })

  describe('reserve / release', () => {
    it('reserves stock with a conditional UpdateCommand requiring enough availableQuantity', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { productId: 'p1', availableQuantity: 5, reservedQuantity: 0 } })
      ddbMock.on(UpdateCommand).resolves({})

      await reserveInventoryUseCase.execute('p1', 3)

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      const input = updateCalls[0].args[0].input
      expect(input.ConditionExpression).toBe('#availableQuantity >= :quantity')
      expect(input.ExpressionAttributeValues).toMatchObject({ ':quantity': 3 })
    })

    it('throws ConflictError when DynamoDB rejects the reservation (insufficient stock)', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { productId: 'p1', availableQuantity: 1, reservedQuantity: 0 } })
      ddbMock.on(UpdateCommand).rejects(
        Object.assign(new Error('conditional check failed'), {
          name: 'ConditionalCheckFailedException',
        }),
      )

      await expect(reserveInventoryUseCase.execute('p1', 5)).rejects.toThrow(ConflictError)
    })

    it('releases reserved stock with a conditional UpdateCommand requiring enough reservedQuantity', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await releaseInventoryUseCase.execute([{ productId: 'p1', quantity: 2 }])

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      const input = updateCalls[0].args[0].input
      expect(input.ConditionExpression).toBe('#reservedQuantity >= :quantity')
      expect(input.ExpressionAttributeValues).toMatchObject({ ':quantity': 2 })
    })
  })

  describe('findOneSummary', () => {
    it('joins the product with its inventory record', async () => {
      ddbMock.on(GetCommand, { TableName: 'products-test' }).resolves({
        Item: {
          productId: 'p1',
          name: 'Headphones',
          categoryId: 'cat-1',
          imageUrl: 'https://example.com/p1.png',
          status: ProductStatus.ACTIVE,
        },
      })
      ddbMock.on(GetCommand, { TableName: 'inventory-test' }).resolves({
        Item: {
          productId: 'p1',
          availableQuantity: 4,
          reservedQuantity: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })

      const summary = await findOneInventoryUseCase.execute('p1')

      expect(summary).toEqual({
        productId: 'p1',
        productName: 'Headphones',
        categoryId: 'cat-1',
        imageUrl: 'https://example.com/p1.png',
        productStatus: ProductStatus.ACTIVE,
        availableQuantity: 4,
        reservedQuantity: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    })

    it('creates a zeroed inventory record on the fly when none exists yet', async () => {
      ddbMock.on(GetCommand, { TableName: 'products-test' }).resolves({
        Item: {
          productId: 'p2',
          name: 'Keyboard',
          categoryId: 'cat-1',
          status: ProductStatus.ACTIVE,
        },
      })
      ddbMock.on(GetCommand, { TableName: 'inventory-test' }).resolves({ Item: undefined })
      ddbMock.on(UpdateCommand).resolves({})

      const summary = await findOneInventoryUseCase.execute('p2')

      expect(summary.availableQuantity).toBe(0)
      expect(summary.reservedQuantity).toBe(0)
    })

    it('throws NotFoundError when the product does not exist', async () => {
      ddbMock.on(GetCommand, { TableName: 'products-test' }).resolves({ Item: undefined })

      await expect(findOneInventoryUseCase.execute('missing')).rejects.toThrow(NotFoundError)
    })
  })

  describe('updateAvailableQuantity', () => {
    it('throws InvalidInputError for a negative availableQuantity', async () => {
      await expect(updateInventoryQuantityUseCase.execute(adminUser, 'p1', -1)).rejects.toThrow(
        InvalidInputError,
      )
    })

    it('throws NotFoundError when the product does not exist', async () => {
      ddbMock.on(GetCommand, { TableName: 'products-test' }).resolves({ Item: undefined })

      await expect(updateInventoryQuantityUseCase.execute(adminUser, 'missing', 5)).rejects.toThrow(
        NotFoundError,
      )
    })

    it('persists the new quantity via a conditional UpdateCommand and returns the joined summary', async () => {
      ddbMock.on(GetCommand, { TableName: 'products-test' }).resolves({
        Item: {
          productId: 'p1',
          name: 'Headphones',
          categoryId: 'cat-1',
          status: ProductStatus.ACTIVE,
        },
      })
      ddbMock.on(GetCommand, { TableName: 'inventory-test' }).resolves({
        Item: { productId: 'p1', availableQuantity: 4, reservedQuantity: 1 },
      })
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          productId: 'p1',
          availableQuantity: 10,
          reservedQuantity: 1,
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      })

      const summary = await updateInventoryQuantityUseCase.execute(adminUser, 'p1', 10)

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      const input = updateCalls[0].args[0].input
      expect(input.TableName).toBe('inventory-test')
      expect(input.ConditionExpression).toBe('attribute_exists(#productId)')
      expect(input.ExpressionAttributeValues).toMatchObject({ ':availableQuantity': 10 })
      expect(summary).toMatchObject({ productId: 'p1', availableQuantity: 10 })
    })
  })

  describe('findAll', () => {
    it('scans products joined with inventory and applies the requested limit', async () => {
      ddbMock.on(ScanCommand, { TableName: 'products-test' }).resolves({
        Items: [
          {
            productId: 'p1',
            name: 'Headphones',
            categoryId: 'cat-1',
            status: ProductStatus.ACTIVE,
          },
        ],
        ScannedCount: 1,
        LastEvaluatedKey: undefined,
      })
      ddbMock.on(GetCommand, { TableName: 'inventory-test' }).resolves({
        Item: { productId: 'p1', availableQuantity: 2, reservedQuantity: 0 },
      })

      const result = await findAllInventoriesUseCase.execute({ limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ productId: 'p1', availableQuantity: 2 })
      expect(result.limit).toBe(10)
      expect(result.previousCursor).toBeNull()
      expect(result.nextCursor).toBeNull()
    })

    it('batches lookups by productIds without scanning when productIds is provided', async () => {
      ddbMock
        .on(BatchGetCommand, { RequestItems: { 'products-test': { Keys: [{ productId: 'p1' }] } } })
        .resolves({
          Responses: {
            'products-test': [
              {
                productId: 'p1',
                name: 'Headphones',
                categoryId: 'cat-1',
                status: ProductStatus.ACTIVE,
              },
            ],
          },
        })
      ddbMock
        .on(BatchGetCommand, {
          RequestItems: { 'inventory-test': { Keys: [{ productId: 'p1' }] } },
        })
        .resolves({
          Responses: {
            'inventory-test': [{ productId: 'p1', availableQuantity: 3, reservedQuantity: 0 }],
          },
        })

      const result = await findAllInventoriesUseCase.execute({ productIds: ['p1'] })

      expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ productId: 'p1', availableQuantity: 3 })
      expect(result.nextCursor).toBeNull()
      expect(result.previousCursor).toBeNull()
    })
  })
})
