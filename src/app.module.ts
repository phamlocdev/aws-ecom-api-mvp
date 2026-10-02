import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuditLogModule } from './audit/audit-log.module'
import { AuthModule } from './auth/auth.module'
import { CartsModule } from './carts/carts.module'
import { CategoriesModule } from './categories/categories.module'
import { DynamoDbModule } from './dynamodb/dynamodb.module'
import { HealthModule } from './health/health.module'
import { InventoryModule } from './inventory/inventory.module'
import { OrdersModule } from './orders/orders.module'
import { ProductsModule } from './products/products.module'
import { UploadModule } from './upload/upload.module'
import { UsersModule } from './users/users.module'
import { validateRuntimeEnv } from './config/env.validation'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    AuthModule,
    AuditLogModule,
    CartsModule,
    DynamoDbModule,
    HealthModule,
    InventoryModule,
    OrdersModule,
    ProductsModule,
    UploadModule,
    CategoriesModule,
    UsersModule,
  ],
})
export class AppModule {}
