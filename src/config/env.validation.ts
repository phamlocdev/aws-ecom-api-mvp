import { z } from 'zod'

const trimmedString = z.string().trim().min(1)
const emailString = z.string().trim().email()
const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim() || undefined
}, z.string().min(1).optional())
const optionalEmailString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim() || undefined
}, z.string().email().optional())
const urlString = z.string().trim().url()
const positiveIntegerFromEnv = z.coerce.number().int().positive()
const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return value
  }

  const normalizedValue = value.trim().toLowerCase()
  if (normalizedValue === 'true') {
    return true
  }

  if (normalizedValue === 'false') {
    return false
  }

  return value
}, z.boolean())
const ipv4AddressString = z
  .string()
  .trim()
  .regex(
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
    'Expected a valid IPv4 address',
  )

function splitCsv(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return items.length > 0 ? items : fallback
}

function splitCsvEmails(value: string | undefined): string[] {
  return splitCsv(value, []).map((email) => emailString.parse(email))
}

const csvEmailArrayFromEnv = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return []
  }

  return splitCsvEmails(value)
}, z.array(z.string().email()))

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: positiveIntegerFromEnv.default(8000),
  AWS_REGION: trimmedString.default('ap-southeast-1'),
  AWS_DEFAULT_REGION: trimmedString.default('ap-southeast-1'),
  PRODUCTS_TABLE: trimmedString.default('products'),
  CATEGORIES_TABLE: trimmedString.default('categories'),
  CARTS_TABLE: trimmedString.default('carts'),
  CART_ITEMS_TABLE: trimmedString.default('cart-items'),
  INVENTORY_TABLE: trimmedString.default('inventory'),
  ORDERS_TABLE: trimmedString.default('orders'),
  ORDER_ITEMS_TABLE: trimmedString.default('order-items'),
  EMAIL_TRACKING_TABLE: trimmedString.default('email-tracking'),
  EVENT_CONSUMER_IDEMPOTENCY_TABLE: trimmedString.default('event-consumer-idempotency'),
  USER_ACCOUNTS_TABLE: trimmedString.default('user-accounts'),
  USER_LOGIN_AUDIT_TABLE: trimmedString.default('user-login-audit'),
  PLACE_ORDER_QUEUE_NAME: trimmedString.default('place-order.fifo'),
  PLACE_ORDER_DLQ_NAME: trimmedString.default('place-order-dlq.fifo'),
  PLACE_ORDER_QUEUE_URL: optionalTrimmedString,
  ORDER_EVENTS_BUS_NAME: trimmedString.default('ecommerce-domain-events'),
  COGNITO_USER_POOL_ID: optionalTrimmedString,
  COGNITO_CLIENT_ID: optionalTrimmedString,
  COGNITO_DEFAULT_GROUP: trimmedString.default('customer'),
  COGNITO_DISPOSABLE_EMAIL_DOMAINS: trimmedString.default(
    '10minutemail.com,mailinator.com,tempmail.com,temp-mail.org,guerrillamail.com,yopmail.com',
  ),
  CLIENT_COGNITO_CALLBACK_URLS: trimmedString.default('http://localhost:3000/auth/callback'),
  CLIENT_COGNITO_LOGOUT_URLS: trimmedString.default('http://localhost:3000/auth/login'),
  CLIENT_CORS_ORIGINS: trimmedString.default('http://localhost:3000'),
  CLIENT_DOMAIN_NAME: optionalTrimmedString,
  CLIENT_HOSTED_ZONE_NAME: optionalTrimmedString,
  CLIENT_WAF_WEB_ACL_ARN: optionalTrimmedString,
  API_DOMAIN_NAME: optionalTrimmedString,
  API_HOSTED_ZONE_NAME: optionalTrimmedString,
  FRONT_END_PAYMENT_RETURN_URL: urlString.default('http://localhost:3000/orders/payment-return'),
  COGNITO_DOMAIN_PREFIX: trimmedString.default('ecommerce-dev'),
  MEDIA_BUCKET_NAME: trimmedString.default('ecommerce-media-dev'),
  MEDIA_DOMAIN_NAME: optionalTrimmedString,
  MEDIA_HOSTED_ZONE_NAME: optionalTrimmedString,
  MEDIA_WAF_WEB_ACL_ARN: optionalTrimmedString,
  MEDIA_PUBLIC_READ_PREFIXES: trimmedString.default('products/'),
  MEDIA_PUBLIC_BASE_URL: optionalTrimmedString,
  PRODUCT_IMAGE_MAX_COUNT: positiveIntegerFromEnv.default(10),
  MEDIA_READ_URL_TTL_SECONDS: positiveIntegerFromEnv.default(900),
  UPLOAD_MAX_FILE_SIZE_BYTES: positiveIntegerFromEnv.default(5242880),
  ORDERS_ENTITY_TYPE: trimmedString.default('ORDER'),
  PAYMENT_CONFIRMATION_SECONDS_TIMEOUT: positiveIntegerFromEnv.default(60 * 5),
  RESERVATION_EXPIRY_POLLER_SCHEDULE_MINUTES: positiveIntegerFromEnv.default(1),
  PLACE_ORDER_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  GOOGLE_CLIENT_ID: optionalTrimmedString,
  GOOGLE_CLIENT_SECRET: optionalTrimmedString,
  ADMIN_USERNAME: optionalTrimmedString,
  ADMIN_EMAIL: optionalTrimmedString,
  ADMIN_PASSWORD: optionalTrimmedString,
  CDK_DEFAULT_ACCOUNT: optionalTrimmedString,
  VNPAY_TMN_CODE: trimmedString.default('replace-me'),
  VNPAY_SECURE_SECRET: trimmedString.default('replace-me'),
  VNPAY_PAYMENT_URL: urlString.default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: urlString.default('http://localhost:8000/payments/vnpay/return'),
  VNPAY_IPN_URL: urlString.default('http://localhost:8000/payments/vnpay/ipn'),
  VNPAY_LOCALE: z.enum(['vn', 'en']).default('vn'),
  VNPAY_ORDER_TYPE: trimmedString.default('other'),
  VNPAY_API_IP_ADDR: ipv4AddressString.default('127.0.0.1'),
  SES_ENABLED: booleanFromEnv.default(false),
  SES_FROM_EMAIL: optionalEmailString,
  SES_VERIFIED_RECIPIENTS: csvEmailArrayFromEnv,
  SES_CONFIGURATION_SET_NAME: trimmedString.default('ecommerce-email-events'),
})

const awsInfraEnvSchema = runtimeEnvSchema.transform((environment) => {
  if (!environment.CDK_DEFAULT_ACCOUNT || !/^\d{12}$/.test(environment.CDK_DEFAULT_ACCOUNT)) {
    throw new Error('CDK_DEFAULT_ACCOUNT must be your 12-digit AWS account ID.')
  }

  return {
    account: environment.CDK_DEFAULT_ACCOUNT,
    region: environment.AWS_REGION,
    callbackUrls: splitCsv(environment.CLIENT_COGNITO_CALLBACK_URLS, [
      'http://localhost:3000/auth/callback',
    ]),
    logoutUrls: splitCsv(environment.CLIENT_COGNITO_LOGOUT_URLS, [
      'http://localhost:3000/auth/login',
    ]),
    hostedUiDomainPrefix: environment.COGNITO_DOMAIN_PREFIX,
    clientOrigins: splitCsv(environment.CLIENT_CORS_ORIGINS, ['http://localhost:3000']),
    clientDomainName: environment.CLIENT_DOMAIN_NAME,
    clientHostedZoneName: environment.CLIENT_HOSTED_ZONE_NAME,
    clientWafWebAclArn: environment.CLIENT_WAF_WEB_ACL_ARN,
    apiDomainName: environment.API_DOMAIN_NAME,
    apiHostedZoneName: environment.API_HOSTED_ZONE_NAME,
    frontendPaymentReturnUrl: environment.FRONT_END_PAYMENT_RETURN_URL,
    googleClientId: environment.GOOGLE_CLIENT_ID,
    googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
    productsTableName: environment.PRODUCTS_TABLE,
    categoriesTableName: environment.CATEGORIES_TABLE,
    cartsTableName: environment.CARTS_TABLE,
    cartItemsTableName: environment.CART_ITEMS_TABLE,
    ordersTableName: environment.ORDERS_TABLE,
    orderItemsTableName: environment.ORDER_ITEMS_TABLE,
    emailTrackingTableName: environment.EMAIL_TRACKING_TABLE,
    eventConsumerIdempotencyTableName: environment.EVENT_CONSUMER_IDEMPOTENCY_TABLE,
    inventoryTableName: environment.INVENTORY_TABLE,
    userAccountsTableName: environment.USER_ACCOUNTS_TABLE,
    userLoginAuditTableName: environment.USER_LOGIN_AUDIT_TABLE,
    cognitoDisposableEmailDomains: splitCsv(environment.COGNITO_DISPOSABLE_EMAIL_DOMAINS, []),
    placeOrderQueueName: environment.PLACE_ORDER_QUEUE_NAME,
    placeOrderDlqName: environment.PLACE_ORDER_DLQ_NAME,
    orderEventsBusName: environment.ORDER_EVENTS_BUS_NAME,
    ordersEntityType: environment.ORDERS_ENTITY_TYPE,
    mediaBucketName: environment.MEDIA_BUCKET_NAME,
    mediaDomainName: environment.MEDIA_DOMAIN_NAME,
    mediaHostedZoneName: environment.MEDIA_HOSTED_ZONE_NAME,
    mediaWafWebAclArn: environment.MEDIA_WAF_WEB_ACL_ARN,
    mediaPublicReadPrefixes: splitCsv(environment.MEDIA_PUBLIC_READ_PREFIXES, ['products/']),
    mediaPublicBaseUrl: environment.MEDIA_PUBLIC_BASE_URL,
    productImageMaxCount: environment.PRODUCT_IMAGE_MAX_COUNT,
    mediaReadUrlTtlSeconds: environment.MEDIA_READ_URL_TTL_SECONDS,
    uploadMaxFileSizeBytes: environment.UPLOAD_MAX_FILE_SIZE_BYTES,
    paymentConfirmationTimeoutSeconds: environment.PAYMENT_CONFIRMATION_SECONDS_TIMEOUT,
    reservationExpiryPollerScheduleMinutes: environment.RESERVATION_EXPIRY_POLLER_SCHEDULE_MINUTES,
    vnpayTmnCode: environment.VNPAY_TMN_CODE,
    vnpaySecureSecret: environment.VNPAY_SECURE_SECRET,
    vnpayPaymentUrl: environment.VNPAY_PAYMENT_URL,
    vnpayReturnUrl: environment.VNPAY_RETURN_URL,
    vnpayIpnUrl: environment.VNPAY_IPN_URL,
    vnpayLocale: environment.VNPAY_LOCALE,
    vnpayOrderType: environment.VNPAY_ORDER_TYPE,
    vnpayApiIpAddr: environment.VNPAY_API_IP_ADDR,
    sesEnabled: environment.SES_ENABLED,
    sesFromEmail: environment.SES_FROM_EMAIL,
    sesVerifiedRecipients: environment.SES_VERIFIED_RECIPIENTS,
    sesConfigurationSetName: environment.SES_CONFIGURATION_SET_NAME,
  }
})

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>
export type AwsInfraEnv = z.infer<typeof awsInfraEnvSchema>

export function validateRuntimeEnv(environment: Record<string, unknown>): RuntimeEnv {
  return runtimeEnvSchema.parse(environment)
}

export function validateAwsInfraEnv(environment: Record<string, unknown>): AwsInfraEnv {
  return awsInfraEnvSchema.parse(environment)
}
