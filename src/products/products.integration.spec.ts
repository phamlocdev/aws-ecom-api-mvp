import { mockClient } from 'aws-sdk-client-mock'
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { BadRequestException } from '@nestjs/common'
import { ConflictError, InvalidInputError, NotFoundError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { UploadService } from '../upload/upload.service'
import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbProductRepository } from './infrastructure/dynamodb-product.repository'
import { ProductEventsPublisher } from './infrastructure/product-events.publisher'
import { ProductRepositoryPort } from './domain/product.repository.port'
import { ProductStatus } from './domain/product-status.enum'
import { Product } from './domain/product.entity'
import { CreateProductUseCase } from './application/create-product.use-case'
import { FindOneProductUseCase } from './application/find-one-product.use-case'
import { FindProductForResponseUseCase } from './application/find-product-for-response.use-case'
import { UpdateProductUseCase } from './application/update-product.use-case'
import { DeleteProductUseCase } from './application/delete-product.use-case'
import { FindAllProductsUseCase } from './application/find-all-products.use-case'

// Giai đoạn 3 step 0/7 baseline for `products` (see docs/refactor/PLAN.md):
// originally written against the pre-refactor monolithic ProductsService,
// now driving the post-refactor use-cases + DynamoDbProductRepository to
// confirm the DynamoDB contract and business behavior did not change.
describe('products use-cases (post-refactor baseline)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let repository: ProductRepositoryPort
  let uploadService: jest.Mocked<Pick<
    UploadService,
    | 'getProductImageMaxCount'
    | 'verifyObjectsExist'
    | 'createReadUrls'
    | 'deleteObjectsBestEffort'
  >>
  let productEventsPublisher: jest.Mocked<ProductEventsPublisher>
  let createProductUseCase: CreateProductUseCase
  let findOneProductUseCase: FindOneProductUseCase
  let findProductForResponseUseCase: FindProductForResponseUseCase
  let updateProductUseCase: UpdateProductUseCase
  let deleteProductUseCase: DeleteProductUseCase
  let findAllProductsUseCase: FindAllProductsUseCase

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
      products: 'products-test',
      inventory: 'inventory-test',
    } as unknown as DynamoTablesService

    uploadService = {
      getProductImageMaxCount: jest.fn().mockReturnValue(5),
      verifyObjectsExist: jest.fn().mockResolvedValue(undefined),
      createReadUrls: jest.fn().mockResolvedValue([]),
      deleteObjectsBestEffort: jest.fn().mockResolvedValue(undefined),
    }

    productEventsPublisher = {
      publishProductCreated: jest.fn().mockResolvedValue(undefined),
      publishProductUpdated: jest.fn().mockResolvedValue(undefined),
      publishProductDeleted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProductEventsPublisher>

    repository = new DynamoDbProductRepository(dynamoDbService, dynamoTables)
    const uploadServiceInjected = uploadService as unknown as UploadService

    createProductUseCase = new CreateProductUseCase(
      repository,
      uploadServiceInjected,
      productEventsPublisher,
    )
    findOneProductUseCase = new FindOneProductUseCase(repository)
    findProductForResponseUseCase = new FindProductForResponseUseCase(
      findOneProductUseCase,
      uploadServiceInjected,
    )
    updateProductUseCase = new UpdateProductUseCase(
      repository,
      findOneProductUseCase,
      uploadServiceInjected,
      productEventsPublisher,
    )
    deleteProductUseCase = new DeleteProductUseCase(
      repository,
      findOneProductUseCase,
      uploadServiceInjected,
      productEventsPublisher,
    )
    findAllProductsUseCase = new FindAllProductsUseCase(repository, uploadServiceInjected)
  })

  describe('CreateProductUseCase', () => {
    it('writes the product and its initial inventory row in one transaction and publishes a created event', async () => {
      ddbMock.on(TransactWriteCommand).resolves({})

      const product = await createProductUseCase.execute(adminUser, {
        name: 'Headphones',
        description: 'Wireless headphones',
        categoryId: 'electronics',
        price: 100000,
        availableQuantity: 10,
      })

      expect(product.status).toBe(ProductStatus.ACTIVE)
      expect(product.currency).toBe('VND')

      const calls = ddbMock.commandCalls(TransactWriteCommand)
      expect(calls).toHaveLength(1)
      const transactItems = calls[0].args[0].input.TransactItems ?? []
      expect(transactItems).toHaveLength(2)
      expect(transactItems[0].Put?.TableName).toBe('products-test')
      expect(transactItems[1].Put?.TableName).toBe('inventory-test')
      expect(transactItems[1].Put?.Item).toMatchObject({
        productId: product.productId,
        availableQuantity: 10,
        reservedQuantity: 0,
      })
      expect(productEventsPublisher.publishProductCreated).toHaveBeenCalledWith({
        productId: product.productId,
      })
    })

    it('throws ConflictError when the transaction is cancelled (duplicate id)', async () => {
      ddbMock.on(TransactWriteCommand).rejects(
        Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }),
      )

      await expect(
        createProductUseCase.execute(adminUser, {
          name: 'Headphones',
          description: 'Wireless headphones',
          categoryId: 'electronics',
          price: 100000,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('rejects more product images than the configured max count', async () => {
      uploadService.getProductImageMaxCount.mockReturnValue(1)

      await expect(
        createProductUseCase.execute(adminUser, {
          name: 'Headphones',
          description: 'Wireless headphones',
          categoryId: 'electronics',
          price: 100000,
          images: [
            { key: 'products/a/1.webp', sortOrder: 0 },
            { key: 'products/a/2.webp', sortOrder: 1 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('FindProductForResponseUseCase', () => {
    it('throws NotFoundError when the product does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(findProductForResponseUseCase.execute('missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('throws NotFoundError when the product is soft-deleted', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { productId: 'p1', status: ProductStatus.DELETED } as Partial<Product>,
      })

      await expect(findProductForResponseUseCase.execute('p1')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('returns the product enriched with image read URLs', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          productId: 'p1',
          status: ProductStatus.ACTIVE,
          images: [{ key: 'products/a/1.webp', sortOrder: 0, isPrimary: true }],
        } as Partial<Product>,
      })
      uploadService.createReadUrls.mockResolvedValue([
        { key: 'products/a/1.webp', readUrl: 'https://example.com/1', expiresInSeconds: 900 },
      ])

      const product = await findProductForResponseUseCase.execute('p1')

      expect(product.images?.[0]).toMatchObject({
        key: 'products/a/1.webp',
        readUrl: 'https://example.com/1',
        readUrlExpiresInSeconds: 900,
      })
    })
  })

  describe('UpdateProductUseCase', () => {
    it('throws InvalidInputError when no mutable field is provided', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { productId: 'p1', status: ProductStatus.ACTIVE } as Partial<Product>,
      })

      await expect(updateProductUseCase.execute(adminUser, 'p1', {})).rejects.toBeInstanceOf(
        InvalidInputError,
      )
    })

    it('throws NotFoundError when the product does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(
        updateProductUseCase.execute(adminUser, 'missing', { price: 123 }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('updates mutable fields and publishes an updated event', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { productId: 'p1', status: ProductStatus.ACTIVE } as Partial<Product>,
      })
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { productId: 'p1', status: ProductStatus.ACTIVE, price: 999 },
      })

      const updated = await updateProductUseCase.execute(adminUser, 'p1', { price: 999 })

      expect(updated.price).toBe(999)
      expect(productEventsPublisher.publishProductUpdated).toHaveBeenCalledWith({
        productId: 'p1',
      })
    })
  })

  describe('DeleteProductUseCase', () => {
    it('throws NotFoundError when the product does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(deleteProductUseCase.execute(adminUser, 'missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('soft-deletes the product, removes its images and publishes a deleted event', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          productId: 'p1',
          status: ProductStatus.ACTIVE,
          images: [{ key: 'products/a/1.webp', sortOrder: 0, isPrimary: true }],
        } as Partial<Product>,
      })
      ddbMock.on(UpdateCommand).resolves({})

      await deleteProductUseCase.execute(adminUser, 'p1')

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':deleted': ProductStatus.DELETED,
      })
      expect(uploadService.deleteObjectsBestEffort).toHaveBeenCalledWith(['products/a/1.webp'])
      expect(productEventsPublisher.publishProductDeleted).toHaveBeenCalledWith({
        productId: 'p1',
      })
    })
  })

  describe('FindAllProductsUseCase', () => {
    it('scans with a filter expression that excludes soft-deleted products', async () => {
      ddbMock.on(ScanCommand).resolves({ Items: [], ScannedCount: 0 })

      await findAllProductsUseCase.execute({})

      const scanCalls = ddbMock.commandCalls(ScanCommand)
      expect(scanCalls).toHaveLength(1)
      expect(scanCalls[0].args[0].input.FilterExpression).toBe('#status <> :deletedStatus')
    })
  })
})
