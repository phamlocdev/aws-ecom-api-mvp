import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { CartsModule } from '../carts/presentation/carts.module'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { InventoryModule } from '../inventory/inventory.module'
import { OrdersModule } from '../orders/presentation/orders.module'
import { ProductsModule } from '../products/presentation/products.module'
import { validateRuntimeEnv } from '../config/env.validation'
import { UsersModule } from '../users/presentation/users.module'
import { OrdersWorkerService } from './orders-worker.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    DynamoDbModule,
    UsersModule,
    ProductsModule,
    CartsModule,
    InventoryModule,
    OrdersModule,
  ],
  providers: [OrdersWorkerService],
  exports: [OrdersWorkerService],
})
export class OrdersWorkerModule {}
