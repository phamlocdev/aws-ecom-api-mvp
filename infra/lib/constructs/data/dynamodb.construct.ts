import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'

export class DynamoDbConstruct extends Construct {
  readonly productsTable: dynamodb.Table
  readonly categoriesTable: dynamodb.Table
  readonly cartsTable: dynamodb.Table
  readonly cartItemsTable: dynamodb.Table
  readonly ordersTable: dynamodb.Table
  readonly orderAuditLogTable: dynamodb.Table
  readonly orderItemsTable: dynamodb.Table
  readonly emailTrackingTable: dynamodb.Table
  readonly eventConsumerIdempotencyTable: dynamodb.Table
  readonly inventoryTable: dynamodb.Table
  readonly userAccountsTable: dynamodb.Table
  readonly userLoginAuditTable: dynamodb.Table

  constructor(scope: Construct, id: string) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    this.productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: infraEnv.productsTableName,
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.categoriesTable = new dynamodb.Table(this, 'CategoriesTable', {
      tableName: infraEnv.categoriesTableName,
      partitionKey: { name: 'categoryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.cartsTable = new dynamodb.Table(this, 'CartsTable', {
      tableName: infraEnv.cartsTableName,
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'cartId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.cartItemsTable = new dynamodb.Table(this, 'CartItemsTable', {
      tableName: infraEnv.cartItemsTableName,
      partitionKey: { name: 'cartId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: infraEnv.ordersTableName,
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'GSI_OrderStatusCreatedAt',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    })
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'GSI_OrderCreatedAt',
      partitionKey: { name: 'entityType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    })
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'GSI_CustomerOrders',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    })
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'GSI_CustomerEmailOrders',
      partitionKey: { name: 'customerEmail', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    })
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'GSI_OrderStatusPaymentExpiresAt',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'paymentExpiresAt', type: dynamodb.AttributeType.NUMBER },
    })

    this.orderAuditLogTable = new dynamodb.Table(this, 'OrderAuditLogTable', {
      tableName: infraEnv.orderAuditLogTableName,
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'occurredAtAuditId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.orderItemsTable = new dynamodb.Table(this, 'OrderItemsTable', {
      tableName: infraEnv.orderItemsTableName,
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lineId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.emailTrackingTable = new dynamodb.Table(this, 'EmailTrackingTable', {
      tableName: infraEnv.emailTrackingTableName,
      partitionKey: { name: 'emailId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    this.emailTrackingTable.addGlobalSecondaryIndex({
      indexName: 'GSI_SesMessageRecipient',
      partitionKey: { name: 'sesMessageId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'recipientEmail', type: dynamodb.AttributeType.STRING },
    })
    this.emailTrackingTable.addGlobalSecondaryIndex({
      indexName: 'GSI_ContextEmailType',
      partitionKey: { name: 'contextKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'emailType', type: dynamodb.AttributeType.STRING },
    })
    this.emailTrackingTable.addGlobalSecondaryIndex({
      indexName: 'GSI_EmailTypeStatus',
      partitionKey: { name: 'emailType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    })

    this.eventConsumerIdempotencyTable = new dynamodb.Table(this, 'EventConsumerIdempotencyTable', {
      tableName: infraEnv.eventConsumerIdempotencyTableName,
      partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.inventoryTable = new dynamodb.Table(this, 'InventoryTable', {
      tableName: infraEnv.inventoryTableName,
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.userAccountsTable = new dynamodb.Table(this, 'UserAccountsTable', {
      tableName: infraEnv.userAccountsTableName,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.userLoginAuditTable = new dynamodb.Table(this, 'UserLoginAuditTable', {
      tableName: infraEnv.userLoginAuditTableName,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'loginAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    new cdk.CfnOutput(this, 'OrdersEntityType', {
      value: infraEnv.ordersEntityType,
    })
  }
}
