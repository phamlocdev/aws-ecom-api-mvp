import { Module } from '@nestjs/common'
import { CartsModule } from '../carts/presentation/carts.module'
import { InventoryModule } from '../inventory/inventory.module'
import { MailModule } from '../mail/mail.module'
import { ProductsModule } from '../products/presentation/products.module'
import { UsersModule } from '../users/users.module'
import { PaymentsController } from './payments.controller'
import { OrderEventsPublisher } from './order-events.publisher'
import { OrdersController } from './orders.controller'
import { OrdersQueueService } from './orders.queue'
import { OrdersService } from './orders.service'
import { VnpayService } from './vnpay.service'

@Module({
  imports: [CartsModule, InventoryModule, MailModule, ProductsModule, UsersModule],
  controllers: [OrdersController, PaymentsController],
  providers: [OrderEventsPublisher, OrdersQueueService, OrdersService, VnpayService],
  exports: [OrderEventsPublisher, OrdersQueueService, OrdersService, VnpayService],
})
export class OrdersModule {}
