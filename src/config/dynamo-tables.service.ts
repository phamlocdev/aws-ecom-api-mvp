import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// Single place for DynamoDB table names, read once from env vars with the
// same defaults every *.service.ts used to hardcode individually (see
// docs/refactor/PLAN.md, Giai đoạn 1). Inject this instead of reading
// `configService.get<string>('X_TABLE')` directly in feature services.
@Injectable()
export class DynamoTablesService {
  readonly products: string
  readonly inventory: string
  readonly categories: string
  readonly carts: string
  readonly cartItems: string
  readonly orders: string
  readonly orderItems: string
  readonly auditLog: string
  readonly userAccounts: string
  readonly userLoginAudit: string
  readonly emailTracking: string

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.products = configService.get<string>('PRODUCTS_TABLE') ?? 'products'
    this.inventory = configService.get<string>('INVENTORY_TABLE') ?? 'inventory'
    this.categories = configService.get<string>('CATEGORIES_TABLE') ?? 'categories'
    this.carts = configService.get<string>('CARTS_TABLE') ?? 'carts'
    this.cartItems = configService.get<string>('CART_ITEMS_TABLE') ?? 'cart-items'
    this.orders = configService.get<string>('ORDERS_TABLE') ?? 'orders'
    this.orderItems = configService.get<string>('ORDER_ITEMS_TABLE') ?? 'order-items'
    this.auditLog = configService.get<string>('AUDIT_LOG_TABLE') ?? 'audit-log'
    this.userAccounts = configService.get<string>('USER_ACCOUNTS_TABLE') ?? 'user-accounts'
    this.userLoginAudit =
      configService.get<string>('USER_LOGIN_AUDIT_TABLE') ?? 'user-login-audit'
    this.emailTracking = configService.get<string>('EMAIL_TRACKING_TABLE') ?? 'email-tracking'
  }
}
