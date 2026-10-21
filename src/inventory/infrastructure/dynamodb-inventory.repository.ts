import { Inject, Injectable } from '@nestjs/common'
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  systemAuditMutationContext,
  toAuditMutationAttributes,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Product } from '../../products/domain/product.entity'
import {
  InventoryRecord,
  InventorySummary,
  ReservedInventoryItem,
} from '../domain/inventory.entity'
import {
  InventoryFilters,
  InventoryRepositoryPort,
  InventorySummaryPage,
} from '../domain/inventory.repository.port'

interface InventoryFilterExpression {
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

@Injectable()
export class DynamoDbInventoryRepository implements InventoryRepositoryPort {
  private readonly tableName: string
  private readonly productsTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.tableName = dynamoTables.inventory
    this.productsTableName = dynamoTables.products
  }

  async ensureRecord(productId: string): Promise<InventoryRecord> {
    const existing = await this.findOne(productId)
    if (existing) {
      return existing
    }

    const record: InventoryRecord = {
      productId,
      availableQuantity: 0,
      reservedQuantity: 0,
      updatedAt: new Date().toISOString(),
      ...toAuditMutationAttributes(
        systemAuditMutationContext('inventory-service', 'Inventory record initialized'),
      ),
    }

    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        ConditionExpression: 'attribute_not_exists(productId)',
        ExpressionAttributeValues: {
          ':productId': productId,
        },
      }),
    )

    return record
  }

  async findOne(productId: string): Promise<InventoryRecord | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { productId },
      }),
    )

    return (response.Item as InventoryRecord | undefined) ?? null
  }

  async findOneSummary(productId: string): Promise<InventorySummary> {
    const product = await this.findProductOrThrow(productId)
    const inventory = await this.ensureRecord(productId)
    return toInventorySummary(product, inventory)
  }

  async findSummariesByProductIds(productIds: string[]): Promise<InventorySummary[]> {
    const dedupedProductIds = [...new Set(productIds)]
    const products = await this.findProductsByIds(dedupedProductIds)
    const inventoryRecords = await this.findOrCreateInventoryRecordsByProductIds(
      products.map((product) => product.productId),
    )

    const inventoryMap = new Map(
      inventoryRecords.map((inventory) => [inventory.productId, inventory] as const),
    )

    return products
      .map((product) => {
        const inventory = inventoryMap.get(product.productId)
        return inventory ? toInventorySummary(product, inventory) : null
      })
      .filter((item): item is InventorySummary => item !== null)
  }

  async findAllSummaries(
    filters: InventoryFilters,
    limit: number,
    startKey?: Record<string, unknown> | null,
  ): Promise<InventorySummaryPage> {
    const filterExpression = buildInventoryProductFilterExpression(filters)
    const items: InventorySummary[] = []
    let scannedCount = 0
    let lastEvaluatedKey = startKey ?? undefined

    do {
      const remainingNeeded = limit - items.length
      const response = await this.dynamoDbService.documentClient.send(
        new ScanCommand({
          TableName: this.productsTableName,
          Limit: remainingNeeded,
          ExclusiveStartKey: lastEvaluatedKey,
          ...filterExpression,
        }),
      )

      const products = (response.Items ?? []) as Product[]
      const inventoryRecords = await Promise.all(
        products.map((product) => this.ensureRecord(product.productId)),
      )

      items.push(
        ...products.map((product, index) => toInventorySummary(product, inventoryRecords[index])),
      )
      scannedCount += response.ScannedCount ?? 0
      lastEvaluatedKey = response.LastEvaluatedKey
    } while (items.length < limit && lastEvaluatedKey)

    return { items, lastEvaluatedKey, scannedCount }
  }

  async updateAvailableQuantity(
    productId: string,
    availableQuantity: number,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<InventorySummary> {
    const product = await this.findProductOrThrow(productId)
    await this.ensureRecord(productId)

    const response = await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { productId },
        UpdateExpression: `SET #availableQuantity = :availableQuantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
        ConditionExpression: 'attribute_exists(#productId)',
        ExpressionAttributeNames: {
          '#productId': 'productId',
          '#availableQuantity': 'availableQuantity',
          '#updatedAt': 'updatedAt',
          ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':availableQuantity': availableQuantity,
          ':updatedAt': updatedAt,
          ...toAuditMutationExpressionValues(audit),
        },
        ReturnValues: 'ALL_NEW',
      }),
    )

    return toInventorySummary(product, response.Attributes as InventoryRecord)
  }

  async reserve(productId: string, quantity: number, audit: AuditMutationContext): Promise<void> {
    await this.ensureRecord(productId)

    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { productId },
          UpdateExpression: `SET #availableQuantity = #availableQuantity - :quantity, #reservedQuantity = #reservedQuantity + :quantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
          ConditionExpression: '#availableQuantity >= :quantity',
          ExpressionAttributeNames: {
            '#availableQuantity': 'availableQuantity',
            '#reservedQuantity': 'reservedQuantity',
            '#updatedAt': 'updatedAt',
            ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':quantity': quantity,
            ':updatedAt': new Date().toISOString(),
            ...toAuditMutationExpressionValues(audit),
          },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictError(`Insufficient inventory for product ${productId}.`)
      }
      throw error
    }
  }

  async release(items: ReservedInventoryItem[], audit: AuditMutationContext): Promise<void> {
    for (const item of items) {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { productId: item.productId },
          UpdateExpression: `SET #availableQuantity = #availableQuantity + :quantity, #reservedQuantity = #reservedQuantity - :quantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
          ConditionExpression: '#reservedQuantity >= :quantity',
          ExpressionAttributeNames: {
            '#availableQuantity': 'availableQuantity',
            '#reservedQuantity': 'reservedQuantity',
            '#updatedAt': 'updatedAt',
            ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':quantity': item.quantity,
            ':updatedAt': new Date().toISOString(),
            ...toAuditMutationExpressionValues(audit),
          },
        }),
      )
    }
  }

  private async findProductOrThrow(productId: string): Promise<Product> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.productsTableName,
        Key: { productId },
      }),
    )

    if (!response.Item) {
      throw new NotFoundError(`Product ${productId} was not found.`)
    }

    return response.Item as Product
  }

  private async findProductsByIds(productIds: string[]): Promise<Product[]> {
    if (productIds.length === 0) {
      return []
    }

    const productChunks = chunk(productIds, 100)
    const products: Product[] = []

    for (const currentChunk of productChunks) {
      const response = await this.dynamoDbService.documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [this.productsTableName]: {
              Keys: currentChunk.map((productId) => ({ productId })),
            },
          },
        }),
      )

      products.push(...((response.Responses?.[this.productsTableName] ?? []) as Product[]))
    }

    const productMap = new Map(products.map((product) => [product.productId, product] as const))
    return productIds
      .map((productId) => productMap.get(productId))
      .filter((product): product is Product => Boolean(product))
  }

  private async findOrCreateInventoryRecordsByProductIds(
    productIds: string[],
  ): Promise<InventoryRecord[]> {
    if (productIds.length === 0) {
      return []
    }

    const inventoryChunks = chunk(productIds, 100)
    const inventoryRecords: InventoryRecord[] = []

    for (const currentChunk of inventoryChunks) {
      const response = await this.dynamoDbService.documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: currentChunk.map((productId) => ({ productId })),
            },
          },
        }),
      )

      inventoryRecords.push(...((response.Responses?.[this.tableName] ?? []) as InventoryRecord[]))
    }

    const inventoryMap = new Map(
      inventoryRecords.map((inventory) => [inventory.productId, inventory] as const),
    )

    const missingProductIds = productIds.filter((productId) => !inventoryMap.has(productId))

    if (missingProductIds.length === 0) {
      return productIds
        .map((productId) => inventoryMap.get(productId))
        .filter((inventory): inventory is InventoryRecord => Boolean(inventory))
    }

    const createdRecords = await Promise.all(
      missingProductIds.map((productId) => this.ensureRecord(productId)),
    )

    for (const record of createdRecords) {
      inventoryMap.set(record.productId, record)
    }

    return productIds
      .map((productId) => inventoryMap.get(productId))
      .filter((inventory): inventory is InventoryRecord => Boolean(inventory))
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

function buildInventoryProductFilterExpression(
  filters: InventoryFilters,
): InventoryFilterExpression {
  const expressions: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  if (filters.status) {
    names['#status'] = 'status'
    values[':status'] = filters.status
    expressions.push('#status = :status')
  }

  if (filters.q) {
    names['#productId'] = 'productId'
    names['#name'] = 'name'
    names['#description'] = 'description'
    values[':q'] = filters.q
    expressions.push(
      '(contains(#productId, :q) OR contains(#name, :q) OR contains(#description, :q))',
    )
  }

  if (expressions.length === 0) {
    return {}
  }

  return {
    FilterExpression: expressions.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }
}

function toInventorySummary(product: Product, inventory: InventoryRecord): InventorySummary {
  return {
    productId: product.productId,
    productName: product.name,
    categoryId: product.categoryId,
    imageUrl: product.imageUrl,
    productStatus: product.status,
    availableQuantity: inventory.availableQuantity,
    reservedQuantity: inventory.reservedQuantity,
    updatedAt: inventory.updatedAt,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}
