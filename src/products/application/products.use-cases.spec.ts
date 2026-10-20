import { ConflictError, InvalidInputError, NotFoundError } from '../../common/domain-error'
import { Role } from '../../auth/roles.enum'
import { AuthenticatedUser } from '../../auth/auth.types'
import { UploadService } from '../../upload/upload.service'
import { ProductRepositoryPort } from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'
import { CreateProductUseCase } from './create-product.use-case'
import { FindAllProductsUseCase } from './find-all-products.use-case'
import { FindOneProductUseCase } from './find-one-product.use-case'
import { FindProductForResponseUseCase } from './find-product-for-response.use-case'
import { UpdateProductUseCase } from './update-product.use-case'
import { DeleteProductUseCase } from './delete-product.use-case'

// Unit tests for the products use-cases (Giai đoạn 3): exercised against a
// mocked ProductRepositoryPort/UploadService/ProductEventsPublisher, no AWS
// SDK involved. See docs/refactor/PLAN.md Giai đoạn 3.

const adminUser: AuthenticatedUser = {
  sub: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  groups: [Role.ADMIN],
  permissions: [],
  tokenUse: 'access',
  clientId: 'test-client',
}

const baseProduct: Product = {
  productId: 'p1',
  name: 'Headphones',
  description: 'Wireless headphones',
  categoryId: 'electronics',
  price: 100000,
  currency: 'VND',
  status: ProductStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function createRepositoryMock(): jest.Mocked<ProductRepositoryPort> {
  return {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }
}

function createUploadServiceMock(): jest.Mocked<
  Pick<UploadService, 'getProductImageMaxCount' | 'verifyObjectsExist' | 'createReadUrls' | 'deleteObjectsBestEffort'>
> {
  return {
    getProductImageMaxCount: jest.fn().mockReturnValue(5),
    verifyObjectsExist: jest.fn().mockResolvedValue(undefined),
    createReadUrls: jest.fn().mockResolvedValue([]),
    deleteObjectsBestEffort: jest.fn().mockResolvedValue(undefined),
  }
}

function createPublisherMock(): jest.Mocked<ProductEventsPublisher> {
  return {
    publishProductCreated: jest.fn().mockResolvedValue(undefined),
    publishProductUpdated: jest.fn().mockResolvedValue(undefined),
    publishProductDeleted: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ProductEventsPublisher>
}

describe('CreateProductUseCase', () => {
  it('builds the entity, writes it with its initial inventory, and publishes a created event', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.create.mockResolvedValue(undefined)
    const useCase = new CreateProductUseCase(
      repository,
      uploadService as unknown as UploadService,
      publisher,
    )

    const result = await useCase.execute(adminUser, {
      name: 'Headphones',
      description: 'Wireless headphones',
      categoryId: 'electronics',
      price: 100000,
      availableQuantity: 10,
    })

    expect(result).toMatchObject({
      name: 'Headphones',
      categoryId: 'electronics',
      price: 100000,
      status: ProductStatus.ACTIVE,
    })
    expect(repository.create).toHaveBeenCalledWith(
      result,
      expect.objectContaining({ productId: result.productId, availableQuantity: 10, reservedQuantity: 0 }),
    )
    expect(publisher.publishProductCreated).toHaveBeenCalledWith({ productId: result.productId })
  })

  it('propagates ConflictError raised by the repository', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.create.mockRejectedValue(new ConflictError('A product with this ID already exists.'))
    const useCase = new CreateProductUseCase(
      repository,
      uploadService as unknown as UploadService,
      publisher,
    )

    await expect(
      useCase.execute(adminUser, {
        name: 'Headphones',
        description: 'Wireless headphones',
        categoryId: 'electronics',
        price: 100000,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(publisher.publishProductCreated).not.toHaveBeenCalled()
  })
})

describe('FindAllProductsUseCase', () => {
  it('maps a repository page to a paginated response and enriches items with primary image read URLs', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    repository.findAll.mockResolvedValue({ items: [baseProduct], scannedCount: 1 })
    const useCase = new FindAllProductsUseCase(repository, uploadService as unknown as UploadService)

    const result = await useCase.execute({})

    expect(repository.findAll).toHaveBeenCalledWith({}, 10, null)
    expect(result.items).toEqual([baseProduct])
    expect(result.scannedCount).toBe(1)
    expect(result.nextCursor).toBeNull()
  })
})

describe('FindOneProductUseCase', () => {
  it('returns the product when it exists and is not soft-deleted', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(baseProduct)
    const useCase = new FindOneProductUseCase(repository)

    await expect(useCase.execute('p1')).resolves.toEqual(baseProduct)
  })

  it('throws NotFoundError when the repository returns null', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(null)
    const useCase = new FindOneProductUseCase(repository)

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the product is soft-deleted', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue({ ...baseProduct, status: ProductStatus.DELETED })
    const useCase = new FindOneProductUseCase(repository)

    await expect(useCase.execute('p1')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('FindProductForResponseUseCase', () => {
  it('enriches every image with a read URL', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const productWithImages: Product = {
      ...baseProduct,
      images: [{ key: 'products/a/1.webp', sortOrder: 0, isPrimary: true }],
    }
    repository.findOne.mockResolvedValue(productWithImages)
    uploadService.createReadUrls.mockResolvedValue([
      { key: 'products/a/1.webp', readUrl: 'https://example.com/1', expiresInSeconds: 900 },
    ])
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new FindProductForResponseUseCase(
      findOneProductUseCase,
      uploadService as unknown as UploadService,
    )

    const result = await useCase.execute('p1')

    expect(result.images?.[0]).toMatchObject({
      readUrl: 'https://example.com/1',
      readUrlExpiresInSeconds: 900,
    })
  })
})

describe('UpdateProductUseCase', () => {
  it('throws InvalidInputError when no mutable field is provided', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.findOne.mockResolvedValue(baseProduct)
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new UpdateProductUseCase(
      repository,
      findOneProductUseCase,
      uploadService as unknown as UploadService,
      publisher,
    )

    await expect(useCase.execute(adminUser, 'p1', {})).rejects.toBeInstanceOf(InvalidInputError)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('propagates NotFoundError when the product does not exist', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.findOne.mockResolvedValue(null)
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new UpdateProductUseCase(
      repository,
      findOneProductUseCase,
      uploadService as unknown as UploadService,
      publisher,
    )

    await expect(
      useCase.execute(adminUser, 'missing', { price: 123 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('updates mutable fields and publishes an updated event', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.findOne.mockResolvedValue(baseProduct)
    const updated = { ...baseProduct, price: 999 }
    repository.update.mockResolvedValue(updated)
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new UpdateProductUseCase(
      repository,
      findOneProductUseCase,
      uploadService as unknown as UploadService,
      publisher,
    )

    const result = await useCase.execute(adminUser, 'p1', { price: 999 })

    expect(result).toEqual(updated)
    expect(repository.update).toHaveBeenCalledWith(
      'p1',
      { price: 999 },
      expect.any(String),
      expect.objectContaining({ actorType: 'admin', reason: 'Product updated' }),
    )
    expect(publisher.publishProductUpdated).toHaveBeenCalledWith({ productId: 'p1' })
  })
})

describe('DeleteProductUseCase', () => {
  it('propagates NotFoundError when the product does not exist', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    repository.findOne.mockResolvedValue(null)
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new DeleteProductUseCase(
      repository,
      findOneProductUseCase,
      uploadService as unknown as UploadService,
      publisher,
    )

    await expect(useCase.execute(adminUser, 'missing')).rejects.toBeInstanceOf(NotFoundError)
    expect(repository.remove).not.toHaveBeenCalled()
  })

  it('removes the product, deletes its images and publishes a deleted event', async () => {
    const repository = createRepositoryMock()
    const uploadService = createUploadServiceMock()
    const publisher = createPublisherMock()
    const productWithImages: Product = {
      ...baseProduct,
      images: [{ key: 'products/a/1.webp', sortOrder: 0, isPrimary: true }],
    }
    repository.findOne.mockResolvedValue(productWithImages)
    repository.remove.mockResolvedValue(undefined)
    const findOneProductUseCase = new FindOneProductUseCase(repository)
    const useCase = new DeleteProductUseCase(
      repository,
      findOneProductUseCase,
      uploadService as unknown as UploadService,
      publisher,
    )

    await useCase.execute(adminUser, 'p1')

    expect(repository.remove).toHaveBeenCalledWith(
      'p1',
      expect.any(String),
      expect.objectContaining({ actorType: 'admin', reason: 'Product deleted' }),
    )
    expect(uploadService.deleteObjectsBestEffort).toHaveBeenCalledWith(['products/a/1.webp'])
    expect(publisher.publishProductDeleted).toHaveBeenCalledWith({ productId: 'p1' })
  })
})
