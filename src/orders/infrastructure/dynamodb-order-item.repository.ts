import { Inject, Injectable } from '@nestjs/common'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { OrderItem } from '../domain/order-item.entity'
import { OrderItemRepositoryPort } from '../domain/order-item.repository.port'

@Injectable()
export class DynamoDbOrderItemRepository
  extends BaseDynamoDbRepository<OrderItem>
  implements OrderItemRepositoryPort
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
    this.tableName = dynamoTables.orderItems
  }

  protected fromRecord(item: Record<string, unknown>): OrderItem {
    return OrderItem.fromRecord(item)
  }

  protected toRecord(entity: OrderItem): Record<string, unknown> {
    return entity.toRecord()
  }

  async createMany(items: OrderItem[]): Promise<void> {
    for (const orderItem of items) {
      await this.putRecord(this.tableName, orderItem.toRecord())
    }
  }

  async findByOrderId(orderId: string): Promise<OrderItem[]> {
    const response = await this.queryItems({
      TableName: this.tableName,
      KeyConditionExpression: '#orderId = :orderId',
      ExpressionAttributeNames: { '#orderId': 'orderId' },
      ExpressionAttributeValues: { ':orderId': orderId },
    })

    return (response.Items ?? []).map(OrderItem.fromRecord)
  }
}
