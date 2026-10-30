import { Module } from '@nestjs/common'
import { CartsModule } from '../../carts/presentation/carts.module'
import { InventoryModule } from '../../inventory/presentation/inventory.module'
import { MailModule } from '../../mail/mail.module'
import { ProductsModule } from '../../products/presentation/products.module'
import { UsersModule } from '../../users/presentation/users.module'
import { ORDER_ITEM_REPOSITORY } from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY } from '../domain/order.repository.port'
import { DynamoDbOrderItemRepository } from '../infrastructure/dynamodb-order-item.repository'
import { DynamoDbOrderRepository } from '../infrastructure/dynamodb-order.repository'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { OrdersQueueService } from '../infrastructure/orders-queue.service'
import { VnpayService } from '../infrastructure/vnpay.service'
import { CreateOrderRequestUseCase } from '../application/create-order-request.use-case'
import { FindExpiredReservedOrdersUseCase } from '../application/find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from '../application/find-one-order.use-case'
import { FindOrdersUseCase } from '../application/find-orders.use-case'
import { GetOrderEmailStatisticsUseCase } from '../application/get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from '../application/get-order-email-tracking.use-case'
import { HandleVnpayIpnUseCase } from '../application/handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from '../application/handle-vnpay-return.use-case'
import { VnpayReconcileService } from '../application/vnpay-reconcile.service'
import { ReleaseExpiredOrderReservationUseCase } from '../application/release-expired-order-reservation.use-case'
import { ResendFailedOrderEmailUseCase } from '../application/resend-failed-order-email.use-case'
import { ReserveOrderCheckoutItemsUseCase } from '../application/reserve-order-checkout-items.use-case'
import { TriggerPaymentUseCase } from '../application/trigger-payment.use-case'
import { UpdateOrderStatusUseCase } from '../application/update-order-status.use-case'
import { OrdersController } from './orders.controller'
import { PaymentsController } from './payments.controller'

@Module({
  imports: [CartsModule, InventoryModule, MailModule, ProductsModule, UsersModule],
  controllers: [OrdersController, PaymentsController],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: DynamoDbOrderRepository },
    { provide: ORDER_ITEM_REPOSITORY, useClass: DynamoDbOrderItemRepository },
    OrderEventsPublisher,
    OrdersQueueService,
    VnpayService,
    CreateOrderRequestUseCase,
    FindExpiredReservedOrdersUseCase,
    FindOneOrderUseCase,
    FindOrdersUseCase,
    GetOrderEmailStatisticsUseCase,
    GetOrderEmailTrackingUseCase,
    HandleVnpayIpnUseCase,
    HandleVnpayReturnUseCase,
    VnpayReconcileService,
    ReleaseExpiredOrderReservationUseCase,
    ResendFailedOrderEmailUseCase,
    ReserveOrderCheckoutItemsUseCase,
    TriggerPaymentUseCase,
    UpdateOrderStatusUseCase,
  ],
  exports: [
    ORDER_REPOSITORY,
    OrderEventsPublisher,
    OrdersQueueService,
    VnpayService,
    FindExpiredReservedOrdersUseCase,
    ReleaseExpiredOrderReservationUseCase,
    ReserveOrderCheckoutItemsUseCase,
  ],
})
export class OrdersModule {}
