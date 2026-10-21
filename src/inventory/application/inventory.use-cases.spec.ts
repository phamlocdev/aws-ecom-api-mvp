import { ConflictError, InvalidInputError } from '../../common/domain-error'
import { Role } from '../../auth/roles.enum'
import { AuthenticatedUser } from '../../auth/auth.types'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { InventoryRepositoryPort } from '../domain/inventory.repository.port'
import { InventorySummary } from '../domain/inventory.entity'
import { FindAllInventoriesUseCase } from './find-all-inventories.use-case'
import { FindOneInventoryUseCase } from './find-one-inventory.use-case'
import { UpdateInventoryQuantityUseCase } from './update-inventory-quantity.use-case'
import { ReserveInventoryUseCase } from './reserve-inventory.use-case'
import { ReleaseInventoryUseCase } from './release-inventory.use-case'

// Unit tests for `inventory` (Giai đoạn 3): use-cases are exercised against a
// mocked InventoryRepositoryPort, no AWS SDK involved. See docs/refactor/PLAN.md.

const adminUser: AuthenticatedUser = {
  sub: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  groups: [Role.ADMIN],
  permissions: [],
  tokenUse: 'access',
  clientId: 'test-client',
}

const summary: InventorySummary = {
  productId: 'p1',
  productName: 'Headphones',
  categoryId: 'cat-1',
  productStatus: ProductStatus.ACTIVE,
  availableQuantity: 4,
  reservedQuantity: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function createRepositoryMock(): jest.Mocked<InventoryRepositoryPort> {
  return {
    ensureRecord: jest.fn(),
    findOne: jest.fn(),
    findOneSummary: jest.fn(),
    findSummariesByProductIds: jest.fn(),
    findAllSummaries: jest.fn(),
    updateAvailableQuantity: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  }
}

describe('FindAllInventoriesUseCase', () => {
  it('batches by productIds without touching the paginated scan when productIds is provided', async () => {
    const repository = createRepositoryMock()
    repository.findSummariesByProductIds.mockResolvedValue([summary])
    const useCase = new FindAllInventoriesUseCase(repository)

    const result = await useCase.execute({ productIds: ['p1'] })

    expect(repository.findSummariesByProductIds).toHaveBeenCalledWith(['p1'])
    expect(repository.findAllSummaries).not.toHaveBeenCalled()
    expect(result).toEqual({
      items: [summary],
      previousCursor: null,
      nextCursor: null,
      limit: 10,
      currentPage: 1,
    })
  })

  it('maps a repository page to a paginated response', async () => {
    const repository = createRepositoryMock()
    repository.findAllSummaries.mockResolvedValue({ items: [summary], scannedCount: 1 })
    const useCase = new FindAllInventoriesUseCase(repository)

    const result = await useCase.execute({})

    expect(repository.findAllSummaries).toHaveBeenCalledWith({}, 10, null)
    expect(result.items).toEqual([summary])
    expect(result.scannedCount).toBe(1)
    expect(result.nextCursor).toBeNull()
  })
})

describe('FindOneInventoryUseCase', () => {
  it('delegates to the repository', async () => {
    const repository = createRepositoryMock()
    repository.findOneSummary.mockResolvedValue(summary)
    const useCase = new FindOneInventoryUseCase(repository)

    await expect(useCase.execute('p1')).resolves.toEqual(summary)
  })
})

describe('UpdateInventoryQuantityUseCase', () => {
  it('throws InvalidInputError for a negative availableQuantity without calling the repository', async () => {
    const repository = createRepositoryMock()
    const useCase = new UpdateInventoryQuantityUseCase(repository)

    await expect(useCase.execute(adminUser, 'p1', -1)).rejects.toBeInstanceOf(InvalidInputError)
    expect(repository.updateAvailableQuantity).not.toHaveBeenCalled()
  })

  it('delegates to the repository with a built audit context', async () => {
    const repository = createRepositoryMock()
    repository.updateAvailableQuantity.mockResolvedValue(summary)
    const useCase = new UpdateInventoryQuantityUseCase(repository)

    const result = await useCase.execute(adminUser, 'p1', 10)

    expect(result).toEqual(summary)
    expect(repository.updateAvailableQuantity).toHaveBeenCalledWith(
      'p1',
      10,
      expect.any(String),
      expect.objectContaining({ actorType: 'admin', reason: 'Inventory quantity adjusted' }),
    )
  })
})

describe('ReserveInventoryUseCase', () => {
  it('delegates to the repository with a system audit context', async () => {
    const repository = createRepositoryMock()
    repository.reserve.mockResolvedValue(undefined)
    const useCase = new ReserveInventoryUseCase(repository)

    await useCase.execute('p1', 3)

    expect(repository.reserve).toHaveBeenCalledWith(
      'p1',
      3,
      expect.objectContaining({ actorType: 'system', reason: 'Inventory reserved for order' }),
    )
  })

  it('propagates ConflictError raised by the repository', async () => {
    const repository = createRepositoryMock()
    repository.reserve.mockRejectedValue(
      new ConflictError('Insufficient inventory for product p1.'),
    )
    const useCase = new ReserveInventoryUseCase(repository)

    await expect(useCase.execute('p1', 3)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('ReleaseInventoryUseCase', () => {
  it('delegates to the repository with a system audit context', async () => {
    const repository = createRepositoryMock()
    repository.release.mockResolvedValue(undefined)
    const useCase = new ReleaseInventoryUseCase(repository)

    await useCase.execute([{ productId: 'p1', quantity: 2 }])

    expect(repository.release).toHaveBeenCalledWith(
      [{ productId: 'p1', quantity: 2 }],
      expect.objectContaining({ actorType: 'system', reason: 'Inventory reservation released' }),
    )
  })
})
