import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { MailModule } from '../mail/mail.module'
import { validateRuntimeEnv } from '../config/env.validation'
import { ORDER_REPOSITORY } from '../orders/domain/order.repository.port'
import { DynamoDbOrderRepository } from '../orders/infrastructure/dynamodb-order.repository'
import { OrderNotificationWorkerService } from './order-notification-worker.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    DynamoDbModule,
    MailModule,
  ],
  providers: [
    OrderNotificationWorkerService,
    { provide: ORDER_REPOSITORY, useClass: DynamoDbOrderRepository },
  ],
  exports: [OrderNotificationWorkerService],
})
export class OrderNotificationWorkerModule {}
