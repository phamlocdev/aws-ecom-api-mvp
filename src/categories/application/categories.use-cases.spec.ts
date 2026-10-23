import { ConflictError, InvalidInputError, NotFoundError } from '../../common/domain-error'
import { Role } from '../../auth/roles.enum'
import { Permission } from '../../auth/permissions'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CategoryRepositoryPort } from '../domain/category.repository.port'
import { Category } from '../domain/category.entity'
import { CreateCategoryUseCase } from './create-category.use-case'
import { FindAllCategoriesUseCase } from './find-all-categories.use-case'
import { FindOneCategoryUseCase } from './find-one-category.use-case'
import { UpdateCategoryUseCase } from './update-category.use-case'
import { DeleteCategoryUseCase } from './delete-category.use-case'

// Unit tests for the categories pilot module (Giai đoạn 2): use-cases are
// exercised against a mocked CategoryRepositoryPort, no AWS SDK involved.
// See docs/refactor/PLAN.md Giai đoạn 2/3.

const adminUser: AuthenticatedUser = {
  sub: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  groups: [Role.ADMIN],
  permissions: [
    Permission.CATEGORIES_CREATE,
    Permission.CATEGORIES_UPDATE,
    Permission.CATEGORIES_DELETE,
  ],
  tokenUse: 'access',
  clientId: 'test-client',
}

function createRepositoryMock(): jest.Mocked<CategoryRepositoryPort> {
  return {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }
}

describe('CreateCategoryUseCase', () => {
  it('builds the entity and delegates creation to the repository', async () => {
    const repository = createRepositoryMock()
    repository.create.mockResolvedValue(undefined)
    const useCase = new CreateCategoryUseCase(repository)

    const result = await useCase.execute(adminUser, {
      categoryId: 'electronics',
      name: 'Electronics',
    })

    expect(result).toMatchObject({
      categoryId: 'electronics',
      name: 'Electronics',
      status: 'ACTIVE',
    })
    expect(repository.create).toHaveBeenCalledWith(result)
  })

  it('propagates ConflictError raised by the repository', async () => {
    const repository = createRepositoryMock()
    repository.create.mockRejectedValue(new ConflictError('Category electronics already exists.'))
    const useCase = new CreateCategoryUseCase(repository)

    await expect(
      useCase.execute(adminUser, { categoryId: 'electronics', name: 'Electronics' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('FindAllCategoriesUseCase', () => {
  it('maps a repository page to a paginated response', async () => {
    const repository = createRepositoryMock()
    const items: Category[] = [
      Category.fromRecord({
        categoryId: 'electronics',
        name: 'Electronics',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]
    repository.findAll.mockResolvedValue({ items })
    const useCase = new FindAllCategoriesUseCase(repository)

    const result = await useCase.execute({})

    expect(repository.findAll).toHaveBeenCalledWith(10, null)
    expect(result.items).toEqual(items)
    expect(result.nextCursor).toBeNull()
  })
})

describe('FindOneCategoryUseCase', () => {
  it('returns the category when it exists and is active', async () => {
    const repository = createRepositoryMock()
    const category = Category.fromRecord({
      categoryId: 'electronics',
      name: 'Electronics',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    repository.findOne.mockResolvedValue(category)
    const useCase = new FindOneCategoryUseCase(repository)

    await expect(useCase.execute('electronics')).resolves.toEqual(category)
  })

  it('throws NotFoundError when the repository returns null', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(null)
    const useCase = new FindOneCategoryUseCase(repository)

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the category is soft-deleted', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(
      Category.fromRecord({
        categoryId: 'electronics',
        name: 'Electronics',
        status: 'DELETED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    )
    const useCase = new FindOneCategoryUseCase(repository)

    await expect(useCase.execute('electronics')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('UpdateCategoryUseCase', () => {
  it('throws InvalidInputError when no mutable field is provided', async () => {
    const repository = createRepositoryMock()
    const useCase = new UpdateCategoryUseCase(repository)

    await expect(useCase.execute(adminUser, 'electronics', {})).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('delegates to the repository when a mutable field is provided', async () => {
    const repository = createRepositoryMock()
    const updated = Category.fromRecord({
      categoryId: 'electronics',
      name: 'Updated name',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    repository.update.mockResolvedValue(updated)
    const useCase = new UpdateCategoryUseCase(repository)

    const result = await useCase.execute(adminUser, 'electronics', { name: 'Updated name' })

    expect(result).toEqual(updated)
    expect(repository.update).toHaveBeenCalledWith(
      'electronics',
      { name: 'Updated name' },
      expect.any(String),
      expect.objectContaining({ actorType: 'admin', reason: 'Category updated' }),
    )
  })

  it('propagates NotFoundError raised by the repository', async () => {
    const repository = createRepositoryMock()
    repository.update.mockRejectedValue(new NotFoundError('Category electronics was not found.'))
    const useCase = new UpdateCategoryUseCase(repository)

    await expect(
      useCase.execute(adminUser, 'electronics', { name: 'Updated name' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('DeleteCategoryUseCase', () => {
  it('delegates removal to the repository', async () => {
    const repository = createRepositoryMock()
    repository.remove.mockResolvedValue(undefined)
    const useCase = new DeleteCategoryUseCase(repository)

    await useCase.execute(adminUser, 'electronics')

    expect(repository.remove).toHaveBeenCalledWith(
      'electronics',
      expect.any(String),
      expect.objectContaining({ actorType: 'admin', reason: 'Category deleted' }),
    )
  })

  it('propagates NotFoundError raised by the repository', async () => {
    const repository = createRepositoryMock()
    repository.remove.mockRejectedValue(new NotFoundError('Category electronics was not found.'))
    const useCase = new DeleteCategoryUseCase(repository)

    await expect(useCase.execute(adminUser, 'electronics')).rejects.toBeInstanceOf(NotFoundError)
  })
})
