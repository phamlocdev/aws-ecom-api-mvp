import { Inject, Injectable } from '@nestjs/common'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { NotFoundError } from '../../common/domain-error'
import { isConditionalCheckFailure } from '../../common/dynamodb-errors'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Cart, CartItem } from '../domain/cart.entity'
import { CartStatus } from '../domain/cart-status.enum'
import { CartRepositoryPort } from '../domain/cart.repository.port'

@Injectable()
export class DynamoDbCartRepository
  extends BaseDynamoDbRepository<Cart>
  implements CartRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'cartId'
  private readonly cartItemsTableName: string

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.carts
    this.cartItemsTableName = dynamoTables.cartItems
  }

  protected fromRecord(item: Record<string, unknown>): Cart {
    return Cart.fromRecord(item)
  }

  protected toRecord(entity: Cart): Record<string, unknown> {
    return { ...entity }
  }

  async create(cart: Cart): Promise<void> {
    await this.putRecord(
      this.tableName,
      { ...cart },
      'attribute_not_exists(#customerId) AND attribute_not_exists(#cartId)',
      { '#customerId': 'customerId', '#cartId': 'cartId' },
    )
  }

  async findAllByCustomer(customerId: string): Promise<Cart[]> {
    const response = await this.queryItems({
      TableName: this.tableName,
      KeyConditionExpression: '#customerId = :customerId',
      ExpressionAttributeNames: { '#customerId': 'customerId' },
      ExpressionAttributeValues: { ':customerId': customerId },
      ScanIndexForward: false,
    })
    return (response.Items ?? []).map(Cart.fromRecord)
  }

  async findOne(customerId: string, cartId: string): Promise<Cart | null> {
    const item = await this.getItem(this.tableName, { customerId, cartId })
    return item ? Cart.fromRecord(item) : null
  }

  async findItems(cartId: string): Promise<CartItem[]> {
    const response = await this.queryItems({
      TableName: this.cartItemsTableName,
      KeyConditionExpression: '#cartId = :cartId',
      ExpressionAttributeNames: { '#cartId': 'cartId' },
      ExpressionAttributeValues: { ':cartId': cartId },
    })
    return (response.Items ?? []).map(CartItem.fromRecord)
  }

  async putItem(item: CartItem): Promise<void> {
    await this.putRecord(this.cartItemsTableName, { ...item })
  }

  async updateItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
    updatedAt: string,
  ): Promise<void> {
    try {
      await this.updateItem(
        this.cartItemsTableName,
        { cartId, productId },
        'SET #quantity = :quantity, #updatedAt = :updatedAt',
        { '#productId': 'productId', '#quantity': 'quantity', '#updatedAt': 'updatedAt' },
        { ':quantity': quantity, ':updatedAt': updatedAt },
        'attribute_exists(#productId)',
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Product ${productId} is not in cart ${cartId}.`)
      }
      throw error
    }
  }

  async removeItem(cartId: string, productId: string): Promise<void> {
    try {
      await this.deleteItem(
        this.cartItemsTableName,
        { cartId, productId },
        'attribute_exists(#productId)',
        { '#productId': 'productId' },
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new NotFoundError(`Product ${productId} is not in cart ${cartId}.`)
      }
      throw error
    }
  }

  async updateStatus(
    customerId: string,
    cartId: string,
    status: CartStatus,
    updatedAt: string,
  ): Promise<void> {
    await this.updateItem(
      this.tableName,
      { customerId, cartId },
      'SET #status = :status, #updatedAt = :updatedAt',
      { '#status': 'status', '#updatedAt': 'updatedAt' },
      { ':status': status, ':updatedAt': updatedAt },
    )
  }
}

