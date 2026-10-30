import { Inject, Injectable } from '@nestjs/common'
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import { isConditionalCheckFailure } from '../../common/dynamodb-errors'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'
import {
  InitialProductInventory,
  ProductFilters,
  ProductPage,
  ProductRepositoryPort,
} from '../domain/product.repository.port'

interface ProductFilterExpression {
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

@Injectable()
export class DynamoDbProductRepository
  extends BaseDynamoDbRepository<Product>
  implements ProductRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'productId'
  private readonly inventoryTableName: string

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.products
    this.inventoryTableName = dynamoTables.inventory
  }

  protected fromRecord(item: Record<string, unknown>): Product {
    return Product.fromRecord(item)
  }

  protected toRecord(entity: Product): Record<string, unknown> {
    return { ...entity }
  }

  async create(product: Product, initialInventory: InitialProductInventory): Promise<void> {
    try {
      await this.executeTransaction([
        {
          Put: {
            TableName: this.tableName,
            Item: { ...product },
            ConditionExpression: 'attribute_not_exists(#productId)',
            ExpressionAttributeNames: { '#productId': 'productId' },
          },
        },
        {
          Put: {
            TableName: this.inventoryTableName,
            Item: initialInventory as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(#inventoryProductId)',
            ExpressionAttributeNames: { '#inventoryProductId': 'productId' },
          },
        },
      ])
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictError('A product with this ID already exists.')
      }
      throw error
    }
  }

  async findAll(
    filters: ProductFilters,
    limit: number,
    startKey?: Record<string, unknown> | null,
  ): Promise<ProductPage> {
    const filterExpression = buildProductFilterExpression(filters)
    const items: Product[] = []
    let scannedCount = 0
    let lastEvaluatedKey = startKey ?? undefined

    do {
      // Lấy limit frontend truyền lên trừ đi số lượng item đã filter được
      const remainingNeeded = limit - items.length
      const response = await this.dynamoDbService.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          Limit: remainingNeeded,
          ExclusiveStartKey: lastEvaluatedKey,
          ...filterExpression,
        }),
      )

      items.push(...(response.Items ?? []).map(Product.fromRecord))
      scannedCount += response.ScannedCount ?? 0
      lastEvaluatedKey = response.LastEvaluatedKey
      // Điều kiện lặp:
      // Khi vẫn tồn tại lastEvaludatedKey cho page tiếp theo
      // Và chưa lấy đủ số LIMIT frontend yêu cầu
    } while (items.length < limit && lastEvaluatedKey)

    return { items, lastEvaluatedKey, scannedCount }
  }

  async findOne(productId: string): Promise<Product | null> {
    const item = await this.getItem(this.tableName, { productId })
    return item ? Product.fromRecord(item) : null
  }

  async update(
    productId: string,
    changes: Partial<Product>,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<Product> {
    const expressionAttributeNames: Record<string, string> = {
      '#productId': 'productId',
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':deleted': ProductStatus.DELETED,
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
        { productId },
        `SET ${updateParts.join(', ')}`,
        expressionAttributeNames,
        expressionAttributeValues,
        'attribute_exists(#productId) AND #status <> :deleted',
        'ALL_NEW',
      )
      return Product.fromRecord(attributes!)
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Product ${productId} was not found.`)
      }
      throw error
    }
  }

  async remove(productId: string, deletedAt: string, audit: AuditMutationContext): Promise<void> {
    try {
      await this.updateItem(
        this.tableName,
        { productId },
        `SET #status = :deleted, #deletedAt = :deletedAt, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
        {
          '#productId': 'productId',
          '#status': 'status',
          '#deletedAt': 'deletedAt',
          '#updatedAt': 'updatedAt',
          ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        {
          ':deleted': ProductStatus.DELETED,
          ':deletedAt': deletedAt,
          ':updatedAt': deletedAt,
          ...toAuditMutationExpressionValues(audit),
        },
        'attribute_exists(#productId) AND #status <> :deleted',
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Product ${productId} was not found.`)
      }
      throw error
    }
  }
}

function buildProductFilterExpression(filters: ProductFilters): ProductFilterExpression {
  const expressions: string[] = ['#status <> :deletedStatus']
  const names: Record<string, string> = { '#status': 'status' }
  const values: Record<string, unknown> = { ':deletedStatus': ProductStatus.DELETED }

  if (filters.categoryId) {
    names['#categoryId'] = 'categoryId'
    values[':categoryId'] = filters.categoryId
    expressions.push('#categoryId = :categoryId')
  }
  if (filters.status) {
    values[':status'] = filters.status
    expressions.push('#status = :status')
  }
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    names['#price'] = 'price'
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
      values[':minPrice'] = filters.minPrice
      values[':maxPrice'] = filters.maxPrice
      expressions.push('#price BETWEEN :minPrice AND :maxPrice')
    } else if (filters.minPrice !== undefined) {
      values[':minPrice'] = filters.minPrice
      expressions.push('#price >= :minPrice')
    } else {
      values[':maxPrice'] = filters.maxPrice
      expressions.push('#price <= :maxPrice')
    }
  }
  if (filters.updatedFrom || filters.updatedTo) {
    names['#updatedAt'] = 'updatedAt'
    if (filters.updatedFrom && filters.updatedTo) {
      values[':updatedFrom'] = filters.updatedFrom
      values[':updatedTo'] = filters.updatedTo
      expressions.push('#updatedAt BETWEEN :updatedFrom AND :updatedTo')
    } else if (filters.updatedFrom) {
      values[':updatedFrom'] = filters.updatedFrom
      expressions.push('#updatedAt >= :updatedFrom')
    } else {
      values[':updatedTo'] = filters.updatedTo
      expressions.push('#updatedAt <= :updatedTo')
    }
  }
  if (filters.q) {
    names['#name'] = 'name'
    names['#description'] = 'description'
    values[':q'] = filters.q
    expressions.push('(contains(#name, :q) OR contains(#description, :q))')
  }

  return {
    FilterExpression: expressions.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }
}

