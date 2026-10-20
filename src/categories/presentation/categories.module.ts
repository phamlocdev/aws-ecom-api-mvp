import { Module } from '@nestjs/common'
import { CategoriesController } from './categories.controller'
import { CreateCategoryUseCase } from '../application/create-category.use-case'
import { FindAllCategoriesUseCase } from '../application/find-all-categories.use-case'
import { FindOneCategoryUseCase } from '../application/find-one-category.use-case'
import { UpdateCategoryUseCase } from '../application/update-category.use-case'
import { DeleteCategoryUseCase } from '../application/delete-category.use-case'
import { CATEGORY_REPOSITORY } from '../domain/category.repository.port'
import { DynamoDbCategoryRepository } from '../infrastructure/dynamodb-category.repository'

@Module({
  controllers: [CategoriesController],
  providers: [
    CreateCategoryUseCase,
    FindAllCategoriesUseCase,
    FindOneCategoryUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,
    { provide: CATEGORY_REPOSITORY, useClass: DynamoDbCategoryRepository },
  ],
})
export class CategoriesModule {}
