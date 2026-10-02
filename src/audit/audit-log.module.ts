import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateRuntimeEnv } from '../config/env.validation'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { AuditLogController } from './audit-log.controller'
import { AuditLogService } from './audit-log.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    DynamoDbModule,
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
