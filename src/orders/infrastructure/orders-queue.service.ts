import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { PlaceOrderMessage } from '../domain/order.entity'

@Injectable()
export class OrdersQueueService {
  private readonly sqsClient: SQSClient
  private readonly placeOrderQueueUrl: string

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'
    this.placeOrderQueueUrl = configService.get<string>('PLACE_ORDER_QUEUE_URL') ?? ''

    this.sqsClient = new SQSClient({
      region,
    })
  }

  async enqueuePlaceOrder(message: PlaceOrderMessage): Promise<void> {
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.placeOrderQueueUrl,
        MessageBody: JSON.stringify(message),
        // MessageGroupId: message.customerId,
        MessageGroupId: 'ORDER',
        MessageDeduplicationId: message.deduplicationKey,
      }),
    )
  }
}
