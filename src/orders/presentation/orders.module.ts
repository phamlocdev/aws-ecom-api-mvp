import { Module } from '@nestjs/common'
import { CartsModule } from '../../carts/presentation/carts.module'
import { InventoryModule } from '../../inventory/inventory.module'
import { MailModule } from '../../mail/mail.module'
import { ProductsModule } from '../../products/presentation/products.module'
import { UsersModule } from '../../users/presentation/users.module'
import { ORDER_REPOSITORY } from '../domain/order.repository.port'
import { DynamoDbOrderRepository } from '../infrastructure/dynamodb-order.repository'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { OrdersQueueService } from '../infrastructure/orders-queue.service'
import { VnpayService } from '../infrastructure/vnpay.service'
import { CancelConfirmedPaidOrderUseCase } from '../application/cancel-confirmed-paid-order.use-case'
import { CreateOrderRequestUseCase } from '../application/create-order-request.use-case'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from '../application/expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FailPendingOrderAndReleaseReservationUseCase } from '../application/fail-pending-order-and-release-reservation.use-case'
import { FindExpiredReservedOrdersUseCase } from '../application/find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from '../application/find-one-order.use-case'
import { FindOrderItemsUseCase } from '../application/find-order-items.use-case'
import { FindOrdersUseCase } from '../application/find-orders.use-case'
import { GetOrderByIdUseCase } from '../application/get-order-by-id.use-case'
import { GetOrderEmailStatisticsUseCase } from '../application/get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from '../application/get-order-email-tracking.use-case'
import { HandleVnpayIpnUseCase } from '../application/handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from '../application/handle-vnpay-return.use-case'
import { MarkExpiredPaymentRefundedUseCase } from '../application/mark-expired-payment-refunded.use-case'
import { MarkFailedUseCase } from '../application/mark-failed.use-case'
import { MarkOrderShippedUseCase } from '../application/mark-order-shipped.use-case'
import { MarkPaymentFailedUseCase } from '../application/mark-payment-failed.use-case'
import { MarkPaymentSucceededUseCase } from '../application/mark-payment-succeeded.use-case'
import { MarkReservedUseCase } from '../application/mark-reserved.use-case'
import { ReconcileVerifiedGatewayResultUseCase } from '../application/reconcile-verified-gateway-result.use-case'
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
    OrderEventsPublisher,
    OrdersQueueService,
    VnpayService,
    CancelConfirmedPaidOrderUseCase,
    CreateOrderRequestUseCase,
    ExpireReservationAndReleaseInventoryIfUnpaidUseCase,
    FailPendingOrderAndReleaseReservationUseCase,
    FindExpiredReservedOrdersUseCase,
    FindOneOrderUseCase,
    FindOrderItemsUseCase,
    FindOrdersUseCase,
    GetOrderByIdUseCase,
    GetOrderEmailStatisticsUseCase,
    GetOrderEmailTrackingUseCase,
    HandleVnpayIpnUseCase,
    HandleVnpayReturnUseCase,
    MarkExpiredPaymentRefundedUseCase,
    MarkFailedUseCase,
    MarkOrderShippedUseCase,
    MarkPaymentFailedUseCase,
    MarkPaymentSucceededUseCase,
    MarkReservedUseCase,
    ReconcileVerifiedGatewayResultUseCase,
    ReleaseExpiredOrderReservationUseCase,
    ResendFailedOrderEmailUseCase,
    ReserveOrderCheckoutItemsUseCase,
    TriggerPaymentUseCase,
    UpdateOrderStatusUseCase,
  ],
  exports: [
    OrderEventsPublisher,
    OrdersQueueService,
    VnpayService,
    ExpireReservationAndReleaseInventoryIfUnpaidUseCase,
    FailPendingOrderAndReleaseReservationUseCase,
    FindExpiredReservedOrdersUseCase,
    FindOrderItemsUseCase,
    GetOrderByIdUseCase,
    MarkFailedUseCase,
    MarkReservedUseCase,
    ReserveOrderCheckoutItemsUseCase,
  ],
})
export class OrdersModule {}
