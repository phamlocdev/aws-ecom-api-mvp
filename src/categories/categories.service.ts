import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  buildUserAuditMutationContext,
  toAuditMutationAttributes,
  toAuditMutationExpressionValues,
} from '../audit/audit-actor'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { Category } from './category.types'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { PaginationQueryDto } from '../pagination/pagination-query.dto'
import { PaginatedResponse } from '../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../pagination/pagination.util'

@Injectable()
export class CategoriesService {
  private readonly tableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.tableName = configService.get<string>('CATEGORIES_TABLE') ?? 'categories'
  }

  async create(user: AuthenticatedUser, dto: CreateCategoryDto): Promise<Category> {
    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category created')
    const category: Category = {
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description,
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...toAuditMutationAttributes(actor),
    }

    try {
      await this.dynamoDbService.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: category,
          ConditionExpression: 'attribute_not_exists(#categoryId)',
          ExpressionAttributeNames: { '#categoryId': 'categoryId' },
        }),
      )
      return category
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictException(`Category ${dto.categoryId} already exists.`)
      }
      throw error
    }
  }

  async findAll(query: PaginationQueryDto): Promise<PaginatedResponse<Category>> {
    const pagination = resolvePaginationState('categories', query)
    const response = await this.dynamoDbService.documentClient.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: pagination.limit,
        ExclusiveStartKey: pagination.startKey ?? undefined,
        FilterExpression: 'attribute_not_exists(#status) OR #status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':deleted': 'DELETED' },
      }),
    )
    return toPaginatedResponse(
      'categories',
      pagination,
      (response.Items ?? []) as Category[],
      response.LastEvaluatedKey,
    )
  }

  async findOne(categoryId: string): Promise<Category> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({ TableName: this.tableName, Key: { categoryId } }),
    )
    const category = response.Item as Category | undefined
    if (!category || category.status === 'DELETED') {
      throw new NotFoundException(`Category ${categoryId} was not found.`)
    }
    return category
  }

  async update(
    user: AuthenticatedUser,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    const mutableFields = Object.entries(dto).filter(([, value]) => value !== undefined)
    if (mutableFields.length === 0) {
      throw new BadRequestException('Provide at least one category field to update.')
    }

    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category updated')
    const expressionAttributeNames: Record<string, string> = {
      '#categoryId': 'categoryId',
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':deleted': 'DELETED',
      ':updatedAt': timestamp,
      ...toAuditMutationExpressionValues(actor),
    }
    const updateParts = mutableFields.map(([field, value]) => {
      const nameKey = `#${field}`
      const valueKey = `:${field}`
      expressionAttributeNames[nameKey] = field
      expressionAttributeValues[valueKey] = value
      return `${nameKey} = ${valueKey}`
    })
    updateParts.push('#updatedAt = :updatedAt')
    updateParts.push(AUDIT_ACTOR_FIELDS)

    try {
      const response = await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { categoryId },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ConditionExpression: 'attribute_exists(#categoryId) AND #status <> :deleted',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      )
      return response.Attributes as Category
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundException(`Category ${categoryId} was not found.`)
      }
      throw error
    }
  }

  async remove(user: AuthenticatedUser, categoryId: string): Promise<void> {
    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category deleted')

    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { categoryId },
          UpdateExpression: `SET #status = :deleted, #deletedAt = :deletedAt, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
          ConditionExpression: 'attribute_exists(#categoryId) AND #status <> :deleted',
          ExpressionAttributeNames: {
            '#categoryId': 'categoryId',
            '#status': 'status',
            '#deletedAt': 'deletedAt',
            '#updatedAt': 'updatedAt',
            ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':deleted': 'DELETED',
            ':deletedAt': timestamp,
            ':updatedAt': timestamp,
            ...toAuditMutationExpressionValues(actor),
          },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundException(`Category ${categoryId} was not found.`)
      }
      throw error
    }
  }
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}
