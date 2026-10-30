import { Inject, Injectable } from '@nestjs/common'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { ConflictError } from '../../common/domain-error'
import { isConditionalCheckFailure } from '../../common/dynamodb-errors'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { Order } from '../domain/order.entity'
import { OrderListFilter, OrderPage, OrderRepositoryPort } from '../domain/order.repository.port'
import { buildCustomerOrderQuery, buildStaffOrderQuery } from './order-query-builders'

@Injectable()
export class DynamoDbOrderRepository
  extends BaseDynamoDbRepository<Order>
  implements OrderRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'orderId'

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.orders
  }

  protected fromRecord(item: Record<string, unknown>): Order {
    return Order.fromRecord(item)
  }

  protected toRecord(entity: Order): Record<string, unknown> {
    return entity.toRecord()
  }

  async create(order: Order): Promise<void> {
    try {
      await this.putRecord(
        this.tableName,
        order.toRecord(),
        'attribute_not_exists(#orderId)',
        { '#orderId': 'orderId' },
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictError(`Order ${order.orderId} already exists.`)
      }
      throw error
    }
  }

  async findMany(
    filter: OrderListFilter,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage> {
    const queryInput = filter.isAdminOrManager
      ? buildStaffOrderQuery(filter, exclusiveStartKey)
      : buildCustomerOrderQuery(filter.requestingCustomerId, exclusiveStartKey)

    const response = await this.queryItems({
      TableName: this.tableName,
      Limit: limit,
      ScanIndexForward: false,
      ...queryInput,
    })

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
    const response = await this.queryItems({
      TableName: this.tableName,
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
    })

    return {
      items: (response.Items ?? []).map(Order.fromRecord),
      lastEvaluatedKey: response.LastEvaluatedKey,
    }
  }
}

