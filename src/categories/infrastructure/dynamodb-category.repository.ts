import { Inject, Injectable } from '@nestjs/common'
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { ConflictError, NotFoundError } from '../../common/domain-error'
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
export class DynamoDbCategoryRepository implements CategoryRepositoryPort {
  private readonly tableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.tableName = dynamoTables.categories
  }

  async create(category: Category): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: category,
          ConditionExpression: 'attribute_not_exists(#categoryId)',
          ExpressionAttributeNames: { '#categoryId': 'categoryId' },
        }),
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
      items: (response.Items ?? []) as Category[],
      lastEvaluatedKey: response.LastEvaluatedKey,
    }
  }

  async findOne(categoryId: string): Promise<Category | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({ TableName: this.tableName, Key: { categoryId } }),
    )
    return (response.Item as Category | undefined) ?? null
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
        throw new NotFoundError(`Category ${categoryId} was not found.`)
      }
      throw error
    }
  }

  async remove(categoryId: string, deletedAt: string, audit: AuditMutationContext): Promise<void> {
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
            ':deletedAt': deletedAt,
            ':updatedAt': deletedAt,
            ...toAuditMutationExpressionValues(audit),
          },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Category ${categoryId} was not found.`)
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
