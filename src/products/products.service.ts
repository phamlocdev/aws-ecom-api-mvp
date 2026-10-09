import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  buildUserAuditMutationContext,
  toAuditMutationAttributes,
  toAuditMutationExpressionValues,
} from '../audit/audit-actor'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { CreateProductDto } from './dto/create-product.dto'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { ProductStatus } from './product-status.enum'
import { Product, ProductImage } from './product.types'
import { CursorScope, PaginatedResponse } from '../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../pagination/pagination.util'
import { UploadService } from '../upload/upload.service'
import { ProductEventsPublisher } from './product-events.publisher'

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name)
  private readonly tableName: string
  private readonly inventoryTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(ProductEventsPublisher)
    private readonly productEventsPublisher: ProductEventsPublisher,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.tableName = configService.get<string>('PRODUCTS_TABLE') ?? 'products'
    this.inventoryTableName = configService.get<string>('INVENTORY_TABLE') ?? 'inventory'
  }

  async create(user: AuthenticatedUser, dto: CreateProductDto): Promise<Product> {
    const timestamp = new Date().toISOString()
    const images = await this.prepareProductImages(dto.images)
    const actor = buildUserAuditMutationContext(user, 'Product created')
    const product: Product = {
      productId: randomUUID(),
      name: dto.name,
      description: dto.description,
      categoryId: dto.categoryId,
      price: dto.price,
      currency: 'VND',
      imageUrl: dto.imageUrl,
      images,
      status: dto.status ?? ProductStatus.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...toAuditMutationAttributes(actor),
    }
    const inventory = {
      productId: product.productId,
      availableQuantity: dto.availableQuantity ?? 0,
      reservedQuantity: 0,
      updatedAt: timestamp,
      ...toAuditMutationAttributes({
        ...actor,
        reason: 'Initial inventory created',
      }),
    }

    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: product,
                ConditionExpression: 'attribute_not_exists(#productId)',
                ExpressionAttributeNames: { '#productId': 'productId' },
              },
            },
            {
              Put: {
                TableName: this.inventoryTableName,
                Item: inventory,
                ConditionExpression: 'attribute_not_exists(#inventoryProductId)',
                ExpressionAttributeNames: { '#inventoryProductId': 'productId' },
              },
            },
          ],
        }),
      )
      await this.publishProductMutationBestEffort('created', product.productId)
      return product
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictException('A product with this ID already exists.')
      }
      throw error
    }
  }
  /**
     * const filterExpression = {
      "FilterExpression": "#categoryId = :categoryId AND #status = :status AND #price BETWEEN :minPrice AND :maxPrice AND #updatedAt BETWEEN :updatedFrom AND :updatedTo AND (contains(#name, :q) OR contains(#description, :q))",
      "ExpressionAttributeNames": {
        "#categoryId": "categoryId",
        "#status": "status",
        "#price": "price",
        "#updatedAt": "updatedAt",
        "#name": "name",
        "#description": "description"
      },
      "ExpressionAttributeValues": {
        ":categoryId": "bath",
        ":status": "ACTIVE",
        ":minPrice": 100000,
        ":maxPrice": 500000,
        ":updatedFrom": "2026-08-01T00:00:00.000Z",
        ":updatedTo": "2026-08-31T23:59:59.999Z",
        ":q": "towel"
      }
    }
    */

  async findAll(query: ListProductsQueryDto): Promise<PaginatedResponse<Product>> {
    const filters = normalizeProductFilters(query)
    const cursorScope = toCursorScope(filters)
    const filterExpression = buildProductFilterExpression(filters)

    const pagination = resolvePaginationState('products', query, cursorScope)
    const items: Product[] = []
    let scannedCount = 0
    let lastEvaluatedKey = pagination.startKey ?? undefined

    do {
      // Lấy limit frontend truyền lên trừ đi số lượng item đã filter được
      const remainingNeeded = pagination.limit - items.length
      const response = await this.dynamoDbService.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          Limit: remainingNeeded,
          ExclusiveStartKey: lastEvaluatedKey,
          ...filterExpression,
        }),
      )

      items.push(...((response.Items ?? []) as Product[]))
      scannedCount += response.ScannedCount ?? 0
      lastEvaluatedKey = response.LastEvaluatedKey
      // Điều kiện lặp:
      // Khi vẫn tồn tại lastEvaludatedKey cho page tiếp theo
      // Và chưa lấy đủ số LIMIT frontend yêu cầu
    } while (items.length < pagination.limit && lastEvaluatedKey)

    const enrichedItems = await this.withPrimaryImageReadUrls(items)

    return {
      ...toPaginatedResponse('products', pagination, enrichedItems, lastEvaluatedKey),
      scannedCount,
    }
  }

  async findOne(productId: string): Promise<Product> {
    return this.findStoredOne(productId)
  }

  async findOneForResponse(productId: string): Promise<Product> {
    return this.withAllImageReadUrls(await this.findStoredOne(productId))
  }

  private async findStoredOne(productId: string): Promise<Product> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { productId },
      }),
    )
    const product = response.Item as Product | undefined
    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundException(`Product ${productId} was not found.`)
    }
    return product
  }

  async update(user: AuthenticatedUser, productId: string, dto: UpdateProductDto): Promise<Product> {
    const existingProduct = await this.findStoredOne(productId)
    const { images, ...productFieldUpdates } = dto
    const updates: Partial<Product> = { ...productFieldUpdates }
    if (images !== undefined) {
      updates.images = await this.prepareProductImages(images)
    }

    const mutableFields = Object.entries(updates).filter(([, value]) => value !== undefined)
    if (mutableFields.length === 0) {
      throw new BadRequestException('Provide at least one product field to update.')
    }

    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Product updated')
    const expressionAttributeNames: Record<string, string> = {
      '#productId': 'productId',
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':deleted': ProductStatus.DELETED,
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
          Key: { productId },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ConditionExpression: 'attribute_exists(#productId) AND #status <> :deleted',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      )
      const updatedProduct = response.Attributes as Product

      if (images !== undefined) {
        await this.deleteRemovedProductImages(existingProduct.images, updatedProduct.images)
      }

      await this.publishProductMutationBestEffort('updated', updatedProduct.productId)
      return updatedProduct
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundException(`Product ${productId} was not found.`)
      }
      throw error
    }
  }

  async remove(user: AuthenticatedUser, productId: string): Promise<void> {
    const existingProduct = await this.findStoredOne(productId)
    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Product deleted')

    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { productId },
          UpdateExpression: `SET #status = :deleted, #deletedAt = :deletedAt, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
          ConditionExpression: 'attribute_exists(#productId) AND #status <> :deleted',
          ExpressionAttributeNames: {
            '#productId': 'productId',
            '#status': 'status',
            '#deletedAt': 'deletedAt',
            '#updatedAt': 'updatedAt',
            ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':deleted': ProductStatus.DELETED,
            ':deletedAt': timestamp,
            ':updatedAt': timestamp,
            ...toAuditMutationExpressionValues(actor),
          },
        }),
      )
      await this.uploadService.deleteObjectsBestEffort(getProductImageKeys(existingProduct.images))
      await this.publishProductMutationBestEffort('deleted', productId)
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundException(`Product ${productId} was not found.`)
      }
      throw error
    }
  }

  private async publishProductMutationBestEffort(
    mutation: 'created' | 'updated' | 'deleted',
    productId: string,
  ): Promise<void> {
    try {
      if (mutation === 'created') {
        await this.productEventsPublisher.publishProductCreated({ productId })
        return
      }

      if (mutation === 'updated') {
        await this.productEventsPublisher.publishProductUpdated({ productId })
        return
      }

      await this.productEventsPublisher.publishProductDeleted({ productId })
    } catch (error) {
      this.logger.error(`Failed to publish product ${mutation} event for ${productId}.`, error)
    }
  }

  private async prepareProductImages(
    images: CreateProductDto['images'],
  ): Promise<ProductImage[] | undefined> {
    if (images === undefined) {
      return undefined
    }

    const maxImageCount = this.uploadService.getProductImageMaxCount()
    if (images.length > maxImageCount) {
      throw new BadRequestException(`Product images cannot exceed ${maxImageCount} files.`)
    }

    const duplicateKey = findDuplicate(images.map((image) => image.key))
    if (duplicateKey) {
      throw new BadRequestException(`Duplicate product image key: ${duplicateKey}`)
    }

    const normalizedImages = images.map((image) => ({
      key: image.key,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary ?? false,
      ...(image.altText ? { altText: image.altText } : {}),
    }))

    const primaryCount = normalizedImages.filter((image) => image.isPrimary).length
    if (primaryCount > 1) {
      throw new BadRequestException('Only one product image can be primary.')
    }
    if (normalizedImages.length > 0 && primaryCount === 0) {
      normalizedImages[0].isPrimary = true
    }

    await this.uploadService.verifyObjectsExist(getProductImageKeys(normalizedImages))
    return normalizedImages
  }

  private async withPrimaryImageReadUrls(products: Product[]): Promise<Product[]> {
    return Promise.all(products.map((product) => this.withPrimaryImageReadUrl(product)))
  }

  private async withPrimaryImageReadUrl(product: Product): Promise<Product> {
    const primaryImage = product.images?.find((image) => image.isPrimary) ?? product.images?.[0]
    if (!primaryImage) {
      return product
    }

    const [readUrl] = await this.uploadService.createReadUrls([primaryImage.key])
    return {
      ...product,
      images: [
        {
          ...primaryImage,
          readUrl: readUrl.readUrl,
          readUrlExpiresInSeconds: readUrl.expiresInSeconds,
        },
      ],
    }
  }

  private async withAllImageReadUrls(product: Product): Promise<Product> {
    if (!product.images || product.images.length === 0) {
      return product
    }

    const readUrls = await this.uploadService.createReadUrls(getProductImageKeys(product.images))
    const readUrlByKey = new Map(readUrls.map((item) => [item.key, item] as const))

    return {
      ...product,
      images: product.images.map((image) => {
        const readUrl = readUrlByKey.get(image.key)
        return readUrl
          ? {
              ...image,
              readUrl: readUrl.readUrl,
              readUrlExpiresInSeconds: readUrl.expiresInSeconds,
            }
          : image
      }),
    }
  }

  private async deleteRemovedProductImages(
    previousImages: ProductImage[] | undefined,
    nextImages: ProductImage[] | undefined,
  ): Promise<void> {
    const nextKeys = new Set(getProductImageKeys(nextImages))
    const removedKeys = getProductImageKeys(previousImages).filter((key) => !nextKeys.has(key))

    if (removedKeys.length === 0) {
      return
    }

    try {
      await this.uploadService.deleteObjectsBestEffort(removedKeys)
    } catch (error) {
      this.logger.error(
        `Failed to delete removed product images for ${removedKeys.join(', ')}`,
        error,
      )
    }
  }
}

function getProductImageKeys(images: ProductImage[] | undefined): string[] {
  return images?.map((image) => image.key) ?? []
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  return values.find((value) => {
    if (seen.has(value)) {
      return true
    }

    seen.add(value)
    return false
  })
}

interface ProductFilters {
  categoryId?: string
  status?: ProductStatus
  minPrice?: number
  maxPrice?: number
  updatedFrom?: string
  updatedTo?: string
  q?: string
}

interface ProductFilterExpression {
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

function normalizeProductFilters(query: ListProductsQueryDto): ProductFilters {
  return {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
    ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
    ...(query.updatedFrom ? { updatedFrom: new Date(query.updatedFrom).toISOString() } : {}),
    ...(query.updatedTo ? { updatedTo: new Date(query.updatedTo).toISOString() } : {}),
    ...(query.q ? { q: query.q } : {}),
  }
}

function toCursorScope(filters: ProductFilters): CursorScope {
  const scope: CursorScope = {}

  if (filters.categoryId) {
    scope.categoryId = filters.categoryId
  }
  if (filters.status) {
    scope.status = filters.status
  }
  if (filters.minPrice !== undefined) {
    scope.minPrice = String(filters.minPrice)
  }
  if (filters.maxPrice !== undefined) {
    scope.maxPrice = String(filters.maxPrice)
  }
  if (filters.updatedFrom) {
    scope.updatedFrom = filters.updatedFrom
  }
  if (filters.updatedTo) {
    scope.updatedTo = filters.updatedTo
  }
  if (filters.q) {
    scope.q = filters.q
  }

  return scope
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

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'ConditionalCheckFailedException' ||
      error.name === 'TransactionCanceledException')
  )
}
