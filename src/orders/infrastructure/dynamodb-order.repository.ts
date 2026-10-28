import { Inject, Injectable } from '@nestjs/common'
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { ConflictError, InvalidInputError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { ReservedInventoryItem } from '../../inventory/domain/inventory.entity'
import { Order, OrderItem, ORDERS_ENTITY_TYPE } from '../domain/order.entity'
import { OrderListFilter, OrderPage, OrderRepositoryPort } from '../domain/order.repository.port'
import { aggregateReservedQuantities } from '../domain/order.rules'
import { PAYMENT_WINDOW_EXPIRED_REASON } from '../domain/payment-reservation.config'

@Injectable()
export class DynamoDbOrderRepository implements OrderRepositoryPort {
  private readonly ordersTableName: string
  private readonly orderItemsTableName: string
  private readonly inventoryTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.ordersTableName = dynamoTables.orders
    this.orderItemsTableName = dynamoTables.orderItems
    this.inventoryTableName = dynamoTables.inventory
  }

  async create(order: Order): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new PutCommand({
          TableName: this.ordersTableName,
          Item: order.toRecord(),
          ConditionExpression: 'attribute_not_exists(#orderId)',
          ExpressionAttributeNames: { '#orderId': 'orderId' },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictError(`Order ${order.orderId} already exists.`)
      }
      throw error
    }
  }

  async save(order: Order): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.ordersTableName,
        Item: order.toRecord(),
      }),
    )
  }

  async createOrderItems(items: OrderItem[]): Promise<void> {
    for (const orderItem of items) {
      await this.dynamoDbService.documentClient.send(
        new PutCommand({
          TableName: this.orderItemsTableName,
          Item: orderItem,
        }),
      )
    }
  }

  async findOrderItems(orderId: string): Promise<OrderItem[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.orderItemsTableName,
        KeyConditionExpression: '#orderId = :orderId',
        ExpressionAttributeNames: { '#orderId': 'orderId' },
        ExpressionAttributeValues: { ':orderId': orderId },
      }),
    )

    return (response.Items ?? []).map(OrderItem.fromRecord)
  }

  async findById(orderId: string): Promise<Order | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
      }),
    )

    return response.Item ? Order.fromRecord(response.Item) : null
  }

  async findMany(
    filter: OrderListFilter,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage> {
    const queryInput = filter.isAdminOrManager
      ? buildStaffOrderQuery(filter, exclusiveStartKey)
      : buildCustomerOrderQuery(filter.requestingCustomerId, exclusiveStartKey)

    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.ordersTableName,
        Limit: limit,
        ScanIndexForward: false,
        ...queryInput,
      }),
    )

    return {
      items: (response.Items ?? []).map(Order.fromRecord),
      lastEvaluatedKey: response.LastEvaluatedKey,
    }
  }

  async findExpiredReserved(
    nowEpochSeconds: number,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.ordersTableName,
        IndexName: 'GSI_OrderStatusPaymentExpiresAt',
        KeyConditionExpression: '#status = :status AND #paymentExpiresAt <= :paymentExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paymentExpiresAt': 'paymentExpiresAt',
        },
        ExpressionAttributeValues: {
          ':status': 'RESERVED',
          ':paymentExpiresAt': nowEpochSeconds,
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    return {
      items: (response.Items ?? []).map(Order.fromRecord),
      lastEvaluatedKey: response.LastEvaluatedKey,
    }
  }

  async cancelWithInventoryRelease(
    order: Order,
    cancelledAt: string,
    inventoryItems: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void> {
    const aggregatedItems = aggregateReservedQuantities(inventoryItems)
    assertTransactionSize(aggregatedItems)

    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.ordersTableName,
                Item: order.toRecord(),
              },
            },
            ...this.buildReleaseInventoryTransactItems(aggregatedItems, cancelledAt, actor),
          ],
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error) || isTransactionCanceled(error)) {
        throw new ConflictError(`Order ${order.orderId} cannot be cancelled.`)
      }
      throw error
    }
  }

  async failWithInventoryRelease(
    orderId: string,
    failureReason: string,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void> {
    const aggregatedItems = aggregateReservedQuantities(items)
    assertTransactionSize(aggregatedItems)
    const timestamp = new Date().toISOString()

    await this.dynamoDbService.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.ordersTableName,
              Key: { orderId },
              UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
              ExpressionAttributeNames: {
                '#status': 'status',
                '#failureReason': 'failureReason',
                '#updatedAt': 'updatedAt',
                ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
              },
              ExpressionAttributeValues: {
                ':status': 'FAILED',
                ':failureReason': failureReason,
                ':updatedAt': timestamp,
                ...toAuditMutationExpressionValues(actor),
              },
            },
          },
          ...this.buildReleaseInventoryTransactItems(aggregatedItems, timestamp, actor),
        ],
      }),
    )
  }

  async expireWithInventoryRelease(
    order: Order,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<boolean> {
    if (!order.paymentExpiresAt) {
      return false
    }

    const aggregatedItems = aggregateReservedQuantities(items)
    if (aggregatedItems.length === 0) {
      return false
    }

    assertTransactionSize(aggregatedItems)
    const timestamp = new Date().toISOString()

    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.ordersTableName,
                Key: { orderId: order.orderId },
                UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
                ConditionExpression:
                  '#status = :reserved AND #paymentStatus <> :paid AND #paymentExpiresAt = :paymentExpiresAt',
                ExpressionAttributeNames: {
                  '#status': 'status',
                  '#paymentStatus': 'paymentStatus',
                  '#paymentExpiresAt': 'paymentExpiresAt',
                  '#failureReason': 'failureReason',
                  '#updatedAt': 'updatedAt',
                  ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
                },
                ExpressionAttributeValues: {
                  ':reserved': 'RESERVED',
                  ':paid': 'PAID',
                  ':paymentExpiresAt': order.paymentExpiresAt,
                  ':status': 'EXPIRED',
                  ':failureReason': PAYMENT_WINDOW_EXPIRED_REASON,
                  ':updatedAt': timestamp,
                  ...toAuditMutationExpressionValues(actor),
                },
              },
            },
            ...this.buildReleaseInventoryTransactItems(aggregatedItems, timestamp, actor),
          ],
        }),
      )
      return true
    } catch (error) {
      if (isConditionalCheckFailure(error) || isTransactionCanceled(error)) {
        return false
      }
      throw error
    }
  }

  private buildReleaseInventoryTransactItems(
    items: Array<{ productId: string; quantity: number }>,
    timestamp: string,
    actor: AuditMutationContext,
  ) {
    return items.map((item) => ({
      Update: {
        TableName: this.inventoryTableName,
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
          ':updatedAt': timestamp,
          ...toAuditMutationExpressionValues(actor),
        },
      },
    }))
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

function isTransactionCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'TransactionCanceledException'
  )
}

function assertTransactionSize(items: Array<{ productId: string; quantity: number }>): void {
  if (items.length > 99) {
    throw new InvalidInputError(
      'Cannot release reservations for orders with more than 99 unique products.',
    )
  }
}

function buildStaffOrderQuery(
  filter: OrderListFilter,
  exclusiveStartKey?: Record<string, unknown>,
): Omit<QueryCommand['input'], 'TableName'> {
  if (filter.customerEmail) {
    return {
      IndexName: 'GSI_CustomerEmailOrders',
      KeyConditionExpression: '#customerEmail = :customerEmail',
      ExpressionAttributeNames: { '#customerEmail': 'customerEmail' },
      ExpressionAttributeValues: { ':customerEmail': filter.customerEmail },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (filter.customerId) {
    return {
      IndexName: 'GSI_CustomerOrders',
      KeyConditionExpression: '#customerId = :customerId',
      ExpressionAttributeNames: { '#customerId': 'customerId' },
      ExpressionAttributeValues: { ':customerId': filter.customerId },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (filter.status) {
    return {
      IndexName: 'GSI_OrderStatusCreatedAt',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': filter.status },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  return {
    IndexName: 'GSI_OrderCreatedAt',
    KeyConditionExpression: '#entityType = :entityType',
    ExpressionAttributeNames: { '#entityType': 'entityType' },
    ExpressionAttributeValues: { ':entityType': ORDERS_ENTITY_TYPE },
    ExclusiveStartKey: exclusiveStartKey,
  }
}

function buildCustomerOrderQuery(
  customerId: string,
  exclusiveStartKey?: Record<string, unknown>,
): Omit<QueryCommand['input'], 'TableName'> {
  return {
    IndexName: 'GSI_CustomerOrders',
    KeyConditionExpression: '#customerId = :customerId',
    ExpressionAttributeNames: { '#customerId': 'customerId' },
    ExpressionAttributeValues: { ':customerId': customerId },
    ExclusiveStartKey: exclusiveStartKey,
  }
}
