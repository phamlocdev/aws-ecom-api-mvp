import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateRuntimeEnv } from '../config/env.validation'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { OrderAuditLogProcessorService } from './order-audit-log-processor.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    DynamoDbModule,
  ],
  providers: [OrderAuditLogProcessorService],
  exports: [OrderAuditLogProcessorService],
})
export class OrderAuditLogProcessorModule {}
