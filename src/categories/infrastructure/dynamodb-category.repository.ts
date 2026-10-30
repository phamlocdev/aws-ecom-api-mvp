import { Inject, Injectable } from '@nestjs/common'
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import { isConditionalCheckFailure } from '../../common/dynamodb-errors'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Category } from '../domain/category.entity'
import {
  CategoryPage,
  CategoryRepositoryPort,
  UpdateCategoryChanges,
} from '../domain/category.repository.port'

@Injectable()
export class DynamoDbCategoryRepository
  extends BaseDynamoDbRepository<Category>
  implements CategoryRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'categoryId'

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.categories
  }

  protected fromRecord(item: Record<string, unknown>): Category {
    return Category.fromRecord(item)
  }

  protected toRecord(entity: Category): Record<string, unknown> {
    return { ...entity }
  }

  async create(category: Category): Promise<void> {
    try {
      await this.putRecord(
        this.tableName,
        { ...category },
        'attribute_not_exists(#categoryId)',
        { '#categoryId': 'categoryId' },
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictError(`Category ${category.categoryId} already exists.`)
      }
      throw error
    }
  }

  async findAll(limit: number, startKey?: Record<string, unknown> | null): Promise<CategoryPage> {
    const response = await this.dynamoDbService.documentClient.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: limit,
        ExclusiveStartKey: startKey ?? undefined,
        FilterExpression: 'attribute_not_exists(#status) OR #status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':deleted': 'DELETED' },
      }),
    )
    return {
      items: (response.Items ?? []).map(Category.fromRecord),
      lastEvaluatedKey: response.LastEvaluatedKey,
    }
  }

  async findOne(categoryId: string): Promise<Category | null> {
    const item = await this.getItem(this.tableName, { categoryId })
    return item ? Category.fromRecord(item) : null
  }

  async update(
    categoryId: string,
    changes: UpdateCategoryChanges,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<Category> {
    const expressionAttributeNames: Record<string, string> = {
      '#categoryId': 'categoryId',
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':deleted': 'DELETED',
      ':updatedAt': updatedAt,
      ...toAuditMutationExpressionValues(audit),
    }
    const mutableFields = Object.entries(changes).filter(([, value]) => value !== undefined)
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
      const attributes = await this.updateItem(
        this.tableName,
        { categoryId },
        `SET ${updateParts.join(', ')}`,
        expressionAttributeNames,
        expressionAttributeValues,
        'attribute_exists(#categoryId) AND #status <> :deleted',
        'ALL_NEW',
      )
      return Category.fromRecord(attributes!)
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Category ${categoryId} was not found.`)
      }
      throw error
    }
  }

  async remove(categoryId: string, deletedAt: string, audit: AuditMutationContext): Promise<void> {
    try {
      await this.updateItem(
        this.tableName,
        { categoryId },
        `SET #status = :deleted, #deletedAt = :deletedAt, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
        {
          '#categoryId': 'categoryId',
          '#status': 'status',
          '#deletedAt': 'deletedAt',
          '#updatedAt': 'updatedAt',
          ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        {
          ':deleted': 'DELETED',
          ':deletedAt': deletedAt,
          ':updatedAt': deletedAt,
          ...toAuditMutationExpressionValues(audit),
        },
        'attribute_exists(#categoryId) AND #status <> :deleted',
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Category ${categoryId} was not found.`)
      }
      throw error
    }
  }
}

