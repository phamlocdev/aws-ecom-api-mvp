import { Inject, Injectable } from '@nestjs/common'
import {
  BatchGetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import { isConditionalCheckFailure } from '../../common/dynamodb-errors'
import {
  AuditMutationContext,
  systemAuditMutationContext,
  toAuditMutationAttributes,
  toAuditMutationExpressionValues,
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
} from '../../audit/audit-actor'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
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
export class DynamoDbInventoryRepository
  extends BaseDynamoDbRepository<InventoryRecord>
  implements InventoryRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'productId'
  private readonly productsTableName: string

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.inventory
    this.productsTableName = dynamoTables.products
  }

  protected fromRecord(item: Record<string, unknown>): InventoryRecord {
    return InventoryRecord.fromRecord(item)
  }

  protected toRecord(entity: InventoryRecord): Record<string, unknown> {
    return { ...entity }
  }

  async ensureRecord(productId: string): Promise<InventoryRecord> {
    const existing = await this.findOne(productId)
    if (existing) {
      return existing
    }

    const record = InventoryRecord.create({
      productId,
      availableQuantity: 0,
      reservedQuantity: 0,
      ...toAuditMutationAttributes(
        systemAuditMutationContext('inventory-service', 'Inventory record initialized'),
      ),
    })

    await this.putRecord(
      this.tableName,
      { ...record },
      'attribute_not_exists(productId)',
    )

    return record
  }

  async findOne(productId: string): Promise<InventoryRecord | null> {
    const item = await this.getItem(this.tableName, { productId })
    return item ? InventoryRecord.fromRecord(item) : null
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

      const products = (response.Items ?? []).map(Product.fromRecord)
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

    const attributes = await this.updateItem(
      this.tableName,
      { productId },
      `SET #availableQuantity = :availableQuantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
      {
        '#productId': 'productId',
        '#availableQuantity': 'availableQuantity',
        '#updatedAt': 'updatedAt',
        ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
      },
      {
        ':availableQuantity': availableQuantity,
        ':updatedAt': updatedAt,
        ...toAuditMutationExpressionValues(audit),
      },
      'attribute_exists(#productId)',
      'ALL_NEW',
    )

    return toInventorySummary(product, InventoryRecord.fromRecord(attributes!))
  }

  async reserve(productId: string, quantity: number, audit: AuditMutationContext): Promise<void> {
    await this.ensureRecord(productId)

    try {
      await this.updateItem(
        this.tableName,
        { productId },
        `SET #availableQuantity = #availableQuantity - :quantity, #reservedQuantity = #reservedQuantity + :quantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
        {
          '#availableQuantity': 'availableQuantity',
          '#reservedQuantity': 'reservedQuantity',
          '#updatedAt': 'updatedAt',
          ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        {
          ':quantity': quantity,
          ':updatedAt': new Date().toISOString(),
          ...toAuditMutationExpressionValues(audit),
        },
        '#availableQuantity >= :quantity',
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
      await this.updateItem(
        this.tableName,
        { productId: item.productId },
        `SET #availableQuantity = #availableQuantity + :quantity, #reservedQuantity = #reservedQuantity - :quantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
        {
          '#availableQuantity': 'availableQuantity',
          '#reservedQuantity': 'reservedQuantity',
          '#updatedAt': 'updatedAt',
          ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        {
          ':quantity': item.quantity,
          ':updatedAt': new Date().toISOString(),
          ...toAuditMutationExpressionValues(audit),
        },
        '#reservedQuantity >= :quantity',
      )
    }
  }

  private async findProductOrThrow(productId: string): Promise<Product> {
    const item = await this.getItem(this.productsTableName, { productId })
    if (!item) {
      throw new NotFoundError(`Product ${productId} was not found.`)
    }
    return Product.fromRecord(item)
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

      products.push(...(response.Responses?.[this.productsTableName] ?? []).map(Product.fromRecord))
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

      inventoryRecords.push(...(response.Responses?.[this.tableName] ?? []).map(InventoryRecord.fromRecord))
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
  return InventorySummary.fromParts(inventory, product)
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}
