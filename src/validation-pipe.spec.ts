import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { CreateCategoryDto } from './categories/presentation/dto/create-category.dto'

// Baseline test for Giai đoạn 1: the global ValidationPipe (app.bootstrap.ts)
// must keep enforcing whitelist/forbidNonWhitelisted/transform the same way
// the now-removed, redundant `DtoValidationPipe` used to. See
// docs/refactor/PLAN.md (Giai đoạn 1).
describe('Global ValidationPipe contract (replaces removed DtoValidationPipe)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  const metadata = { type: 'body', metatype: CreateCategoryDto } as const

  it('rejects a payload missing required fields', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a payload with unknown properties (forbidNonWhitelisted)', async () => {
    await expect(
      pipe.transform(
        { categoryId: 'electronics', name: 'Electronics', extraField: 'nope' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('transforms and trims a valid payload into a DTO instance', async () => {
    const result = await pipe.transform(
      { categoryId: 'electronics', name: '  Electronics  ' },
      metadata,
    )

    expect(result).toBeInstanceOf(CreateCategoryDto)
    expect(result.name).toBe('Electronics')
  })
})
