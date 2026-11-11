import { Inject, Injectable } from '@nestjs/common'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Order, OrderItem } from '../domain/order.entity'
import { OrderListFilter, OrderPage, OrderRepositoryPort } from '../domain/order.repository.port'
import { buildCustomerOrderQuery, buildStaffOrderQuery } from './order-query-builders'

type ExpiredOrderFilter = { nowEpochSeconds: number }
type OrderFilter = OrderListFilter | ExpiredOrderFilter

@Injectable()
export class DynamoDbOrderRepository
  extends BaseDynamoDbRepository<Order, OrderFilter>
  implements OrderRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'id'
  private readonly orderItemsTableName: string

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.orders
    this.orderItemsTableName = dynamoTables.orderItems
  }

  protected fromRecord(item: Record<string, unknown>): Order {
    return Order.fromRecord(item)
  }

  protected toRecord(entity: Order): Record<string, unknown> {
    return entity.toRecord()
  }

  protected buildQuery(filter: OrderFilter, exclusiveStartKey?: Record<string, unknown>): Record<string, unknown> {
    if ('nowEpochSeconds' in filter) {
      return {
        IndexName: 'GSI_OrderStatusPaymentExpiresAt',
        KeyConditionExpression: '#status = :status AND #paymentExpiresAt <= :paymentExpiresAt',
        ExpressionAttributeNames: { '#status': 'status', '#paymentExpiresAt': 'paymentExpiresAt' },
        ExpressionAttributeValues: { ':status': 'RESERVED', ':paymentExpiresAt': filter.nowEpochSeconds },
        ExclusiveStartKey: exclusiveStartKey,
      }
    }
    const queryInput = filter.isAdminOrManager
      ? buildStaffOrderQuery(filter, exclusiveStartKey)
      : buildCustomerOrderQuery(filter.requestingCustomerId, exclusiveStartKey)
    return { ScanIndexForward: false, ...queryInput }
  }

  async findExpiredReserved(
    nowEpochSeconds: number,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage> {
    return this.findMany({ nowEpochSeconds }, limit, exclusiveStartKey)
  }

  async findByIdWithItems(orderId: string): Promise<Order | null> {
    const order = await this.findById(orderId)
    if (!order) return null

    const response = await this.queryItems({
      TableName: this.orderItemsTableName,
      KeyConditionExpression: '#orderId = :orderId',
      ExpressionAttributeNames: { '#orderId': 'orderId' },
      ExpressionAttributeValues: { ':orderId': orderId },
    })

    const items = (response.Items ?? []).map(OrderItem.fromRecord)
    return order.withItems(items)
  }

  async saveWithItems(order: Order): Promise<void> {
    await this.save(order)
    if (order.items) {
      for (const item of order.items) {
        await this.putRecord(this.orderItemsTableName, item.toRecord())
      }
    }
  }
}
