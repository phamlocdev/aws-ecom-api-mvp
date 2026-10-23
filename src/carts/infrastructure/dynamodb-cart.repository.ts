import { Inject, Injectable } from '@nestjs/common'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { NotFoundError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Cart, CartItem } from '../domain/cart.entity'
import { CartStatus } from '../domain/cart-status.enum'
import { CartRepositoryPort } from '../domain/cart.repository.port'

@Injectable()
export class DynamoDbCartRepository implements CartRepositoryPort {
  private readonly cartsTableName: string
  private readonly cartItemsTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.cartsTableName = dynamoTables.carts
    this.cartItemsTableName = dynamoTables.cartItems
  }

  async create(cart: Cart): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.cartsTableName,
        Item: { ...cart },
        ConditionExpression: 'attribute_not_exists(#customerId) AND attribute_not_exists(#cartId)',
        ExpressionAttributeNames: {
          '#customerId': 'customerId',
          '#cartId': 'cartId',
        },
      }),
    )
  }

  async findAllByCustomer(customerId: string): Promise<Cart[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.cartsTableName,
        KeyConditionExpression: '#customerId = :customerId',
        ExpressionAttributeNames: { '#customerId': 'customerId' },
        ExpressionAttributeValues: { ':customerId': customerId },
        ScanIndexForward: false,
      }),
    )

    return (response.Items ?? []).map(Cart.fromRecord)
  }

  async findOne(customerId: string, cartId: string): Promise<Cart | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.cartsTableName,
        Key: { customerId, cartId },
      }),
    )
    return response.Item ? Cart.fromRecord(response.Item) : null
  }

  async findItems(cartId: string): Promise<CartItem[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.cartItemsTableName,
        KeyConditionExpression: '#cartId = :cartId',
        ExpressionAttributeNames: { '#cartId': 'cartId' },
        ExpressionAttributeValues: { ':cartId': cartId },
      }),
    )

    return (response.Items ?? []).map(CartItem.fromRecord)
  }

  async putItem(item: CartItem): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.cartItemsTableName,
        Item: { ...item },
      }),
    )
  }

  async updateItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
    updatedAt: string,
  ): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.cartItemsTableName,
          Key: { cartId, productId },
          UpdateExpression: 'SET #quantity = :quantity, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(#productId)',
          ExpressionAttributeNames: {
            '#productId': 'productId',
            '#quantity': 'quantity',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':quantity': quantity,
            ':updatedAt': updatedAt,
          },
        }),
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
      await this.dynamoDbService.documentClient.send(
        new DeleteCommand({
          TableName: this.cartItemsTableName,
          Key: { cartId, productId },
          ConditionExpression: 'attribute_exists(#productId)',
          ExpressionAttributeNames: { '#productId': 'productId' },
        }),
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
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.cartsTableName,
        Key: { customerId, cartId },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': updatedAt,
        },
      }),
    )
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
