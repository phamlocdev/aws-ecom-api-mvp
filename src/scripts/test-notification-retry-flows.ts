import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from '@aws-sdk/client-cloudformation'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  type EnvironmentResponse,
} from '@aws-sdk/client-lambda'
import {
  DeleteMessageBatchCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs'
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { exitWithError, getAwsOutputs, getScriptContext, nowIso } from './script-helpers'

type Flow =
  | 'delivery-failed'
  | 'processing-failed'
  | 'duplicate-events'
  | 'event-consumer-duplicates'
  | 'event-consumer-states'
  | 'event-consumer-failure'

type StackResources = {
  orderNotificationWorkerFunctionName: string
  analyticsDemoWorkerFunctionName: string
  fulfillmentDemoWorkerFunctionName: string
  cancellationInventoryDemoWorkerFunctionName: string
  cancellationAccountingDemoWorkerFunctionName: string
  eventTargetDlqUrl: string
  orderShippedNotificationDlqUrl: string
  orderShippedAnalyticsDlqUrl: string
  orderShippedFulfillmentDlqUrl: string
  orderCancelledNotificationDlqUrl: string
  orderCancelledInventoryDlqUrl: string
  orderCancelledAccountingDlqUrl: string
}

type EmailTrackingItem = {
  emailId: string
  emailType: string
  recipientEmail: string
  status: string
  contextType: string
  contextId: string
  attemptNumber?: number
  createdAt: string
  updatedAt: string
}

type EventConsumerIdempotencyItem = {
  idempotencyKey: string
  status: string
  consumerName: string
  contextId: string
  attemptNumber?: number
  updatedAt: string
  inProgressExpiresAt?: number
  failureReason?: string
}

async function main(): Promise<void> {
  const flow = readFlowFlag()
  const stackName = readStringFlag('stack', 'ServerDevStack')
  const orderId = readOptionalStringFlag('orderId')
  const timeoutSeconds = readIntFlag('timeoutSeconds', flow === 'processing-failed' ? 240 : 90)
  const deleteReceived = readBooleanFlag('delete-received', false)
  const purgeBeforeRun = readBooleanFlag('purge', false)

  if (!orderId) {
    throw new Error('Missing required flag --orderId.')
  }

  const { runtimeEnv } = getScriptContext()
  const region = runtimeEnv.AWS_REGION ?? runtimeEnv.AWS_DEFAULT_REGION
  const resources = await resolveStackResources(stackName, region)

  if (purgeBeforeRun) {
    await purgeTestQueues(resources, region)
  }

  if (flow === 'delivery-failed') {
    await testDeliveryFailed({
      region,
      orderId,
      resources,
      timeoutSeconds,
      deleteReceived,
    })
    return
  }

  if (flow === 'processing-failed') {
    await testProcessingFailed({
      region,
      orderId,
      resources,
      timeoutSeconds,
      deleteReceived,
    })
    return
  }

  if (flow === 'duplicate-events') {
    await testDuplicateEvents({
      region,
      orderId,
      duplicateCount: readIntFlag('count', 2),
      timeoutSeconds,
    })
    return
  }

  if (flow === 'event-consumer-duplicates') {
    await testEventConsumerDuplicates({
      region,
      orderId,
      duplicateCount: readIntFlag('count', 2),
      timeoutSeconds,
    })
    return
  }

  if (flow === 'event-consumer-states') {
    await testEventConsumerStates({ region, orderId, timeoutSeconds })
    return
  }

  await testEventConsumerFailure({
    region,
    orderId,
    resources,
    timeoutSeconds,
  })
}

async function testDeliveryFailed(input: {
  region: string
  orderId: string
  resources: StackResources
  timeoutSeconds: number
  deleteReceived: boolean
}): Promise<void> {
  console.log(
    'EventBridge now targets SQS queues. To test delivery failure, temporarily break the EventBridge-to-SQS target permission or target queue out-of-band, then publish an event.',
  )
  await publishOrderShippedEvent(input.region, input.orderId)
  const messages = await waitForQueueMessages({
    region: input.region,
    queueUrl: input.resources.eventTargetDlqUrl,
    timeoutSeconds: input.timeoutSeconds,
    deleteReceived: input.deleteReceived,
  })

  printMessages('eventTargetDlq', messages)
}

async function testProcessingFailed(input: {
  region: string
  orderId: string
  resources: StackResources
  timeoutSeconds: number
  deleteReceived: boolean
}): Promise<void> {
  const lambdaClient = new LambdaClient({ region: input.region })
  const functionName = input.resources.orderNotificationWorkerFunctionName
  const originalConfiguration = await lambdaClient.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  )
  const originalEnvironment = originalConfiguration.Environment

  console.log(
    'Temporarily setting ORDERS_TABLE to a missing table to force worker processing failure.',
  )

  try {
    await updateLambdaEnvironment(lambdaClient, functionName, {
      ...(originalEnvironment?.Variables ?? {}),
      ORDERS_TABLE: `missing-orders-table-${Date.now()}`,
    })
    await publishOrderShippedEvent(input.region, input.orderId)
    const messages = await waitForQueueMessages({
      region: input.region,
      queueUrl: input.resources.orderShippedNotificationDlqUrl,
      timeoutSeconds: input.timeoutSeconds,
      deleteReceived: input.deleteReceived,
    })

    printMessages('orderShippedNotificationDlq', messages)
  } finally {
    await updateLambdaEnvironment(lambdaClient, functionName, originalEnvironment?.Variables ?? {})
    console.log('Restored original worker Lambda environment variables.')
  }
}

async function testDuplicateEvents(input: {
  region: string
  orderId: string
  duplicateCount: number
  timeoutSeconds: number
}): Promise<void> {
  const before = await findNotificationTrackingItems(input.orderId)
  await publishDuplicateOrderShippedEvents(input.region, input.orderId, input.duplicateCount)

  const after = await waitForTrackingItems({
    orderId: input.orderId,
    timeoutSeconds: input.timeoutSeconds,
    minimumCount: Math.max(1, before.length),
  })
  const hasClaimOnceTracking = after.some((item) => item.emailId.startsWith('claim-once#'))
  if (!hasClaimOnceTracking) {
    throw new Error(
      'No claim-once tracking item was found. Make sure the order exists, is SHIPPED, is PAID, and has a recipient email.',
    )
  }

  const grouped = groupTrackingByRecipient(after)
  const duplicateRecipients = Array.from(grouped.entries()).filter(([, items]) => items.length > 1)

  console.log(
    JSON.stringify(
      {
        orderId: input.orderId,
        publishedEvents: input.duplicateCount,
        beforeCount: before.length,
        afterCount: after.length,
        trackingItems: after.map((item) => ({
          emailId: item.emailId,
          recipientEmail: item.recipientEmail,
          status: item.status,
          attemptNumber: item.attemptNumber,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        duplicateRecipients: duplicateRecipients.map(([recipientEmail, items]) => ({
          recipientEmail,
          count: items.length,
          emailIds: items.map((item) => item.emailId),
        })),
        passed: duplicateRecipients.length === 0,
      },
      null,
      2,
    ),
  )

  if (duplicateRecipients.length > 0) {
    throw new Error('Duplicate tracking records were found for at least one recipient.')
  }
}

async function testEventConsumerDuplicates(input: {
  region: string
  orderId: string
  duplicateCount: number
  timeoutSeconds: number
}): Promise<void> {
  await publishDuplicateOrderShippedEvents(input.region, input.orderId, input.duplicateCount)
  await publishDuplicateOrderCancelledEvents(input.region, input.orderId, input.duplicateCount)

  const expectedKeys = [
    buildEventConsumerKey(input.orderId, 'ANALYTICS_ORDER_SHIPPED'),
    buildEventConsumerKey(input.orderId, 'FULFILLMENT_ORDER_SHIPPED'),
    buildEventConsumerKey(input.orderId, 'INVENTORY_ORDER_CANCELLED'),
    buildEventConsumerKey(input.orderId, 'ACCOUNTING_ORDER_CANCELLED'),
  ]
  await deleteEventConsumerRecords(expectedKeys)
  const records = await waitForEventConsumerRecords({
    keys: expectedKeys,
    expectedStatus: 'COMPLETED',
    timeoutSeconds: input.timeoutSeconds,
  })

  console.log(
    JSON.stringify(
      {
        orderId: input.orderId,
        publishedEventsPerType: input.duplicateCount,
        records: records.map(formatEventConsumerRecord),
        passed: records.every((record) => record.status === 'COMPLETED'),
      },
      null,
      2,
    ),
  )
}

async function testEventConsumerStates(input: {
  region: string
  orderId: string
  timeoutSeconds: number
}): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const staleKey = buildEventConsumerKey(input.orderId, 'ANALYTICS_ORDER_SHIPPED')
  const inProgressKey = buildEventConsumerKey(input.orderId, 'FULFILLMENT_ORDER_SHIPPED')
  const failedFinalKey = buildEventConsumerKey(input.orderId, 'INVENTORY_ORDER_CANCELLED')

  await putEventConsumerRecord({
    idempotencyKey: staleKey,
    status: 'IN_PROGRESS',
    consumerName: 'order-shipped-analytics-demo-worker',
    contextId: input.orderId,
    attemptNumber: 1,
    inProgressExpiresAt: nowSeconds - 60,
  })
  await putEventConsumerRecord({
    idempotencyKey: inProgressKey,
    status: 'IN_PROGRESS',
    consumerName: 'order-shipped-fulfillment-demo-worker',
    contextId: input.orderId,
    attemptNumber: 1,
    inProgressExpiresAt: nowSeconds + 15 * 60,
  })
  await putEventConsumerRecord({
    idempotencyKey: failedFinalKey,
    status: 'FAILED_FINAL',
    consumerName: 'order-cancelled-inventory-demo-worker',
    contextId: input.orderId,
    attemptNumber: 1,
    failureReason: 'non-retryable-test-failure',
  })

  await publishOrderShippedEvent(input.region, input.orderId)
  await publishDuplicateOrderCancelledEvents(input.region, input.orderId, 1)

  const stale = await waitForEventConsumerRecord({
    key: staleKey,
    expectedStatus: 'COMPLETED',
    timeoutSeconds: input.timeoutSeconds,
  })
  await wait(5000)
  const inProgress = await getEventConsumerRecord(inProgressKey)
  const failedFinal = await getEventConsumerRecord(failedFinalKey)

  const passed =
    stale?.status === 'COMPLETED' &&
    (stale.attemptNumber ?? 0) > 1 &&
    inProgress?.status === 'IN_PROGRESS' &&
    inProgress.attemptNumber === 1 &&
    failedFinal?.status === 'FAILED_FINAL'

  console.log(
    JSON.stringify(
      {
        orderId: input.orderId,
        staleReclaimed: formatEventConsumerRecord(stale),
        nonStaleInProgressSkipped: formatEventConsumerRecord(inProgress),
        failedFinalSkipped: formatEventConsumerRecord(failedFinal),
        passed,
      },
      null,
      2,
    ),
  )

  if (!passed) {
    throw new Error('Event consumer state behavior did not match expectations.')
  }
}

async function testEventConsumerFailure(input: {
  region: string
  orderId: string
  resources: StackResources
  timeoutSeconds: number
}): Promise<void> {
  const lambdaClient = new LambdaClient({ region: input.region })
  const functionName = input.resources.analyticsDemoWorkerFunctionName
  const key = buildEventConsumerKey(input.orderId, 'ANALYTICS_ORDER_SHIPPED')
  await deleteEventConsumerRecords([key])
  const originalConfiguration = await lambdaClient.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  )
  const originalEnvironment = originalConfiguration.Environment

  try {
    await updateLambdaEnvironment(lambdaClient, functionName, {
      ...(originalEnvironment?.Variables ?? {}),
      FORCE_EVENT_CONSUMER_FAILURE: 'order-shipped-analytics-demo-worker',
    })
    await publishOrderShippedEvent(input.region, input.orderId)
    const record = await waitForEventConsumerRecord({
      key,
      expectedStatus: 'FAILED_RETRYABLE',
      timeoutSeconds: input.timeoutSeconds,
    })

    console.log(
      JSON.stringify(
        {
          orderId: input.orderId,
          record: formatEventConsumerRecord(record),
          passed: record?.status === 'FAILED_RETRYABLE',
        },
        null,
        2,
      ),
    )
  } finally {
    await updateLambdaEnvironment(lambdaClient, functionName, originalEnvironment?.Variables ?? {})
    console.log('Restored original analytics demo worker environment variables.')
  }
}

async function resolveStackResources(stackName: string, region: string): Promise<StackResources> {
  const cloudFormationClient = new CloudFormationClient({ region })
  const resources: StackResourceSummary[] = []
  let nextToken: string | undefined

  do {
    const response = await cloudFormationClient.send(
      new ListStackResourcesCommand({
        StackName: stackName,
        NextToken: nextToken,
      }),
    )
    resources.push(...(response.StackResourceSummaries ?? []))
    nextToken = response.NextToken
  } while (nextToken)

  return {
    orderNotificationWorkerFunctionName: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::Lambda::Function' &&
        Boolean(resource.LogicalResourceId?.includes('OrderNotificationWorker')),
      'OrderNotification worker Lambda',
    ),
    analyticsDemoWorkerFunctionName: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::Lambda::Function' &&
        Boolean(resource.LogicalResourceId?.includes('OrderNotificationAnalyticsDemoWorker')),
      'OrderNotification analytics demo worker Lambda',
    ),
    fulfillmentDemoWorkerFunctionName: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::Lambda::Function' &&
        Boolean(resource.LogicalResourceId?.includes('OrderNotificationFulfillmentDemoWorker')),
      'OrderNotification fulfillment demo worker Lambda',
    ),
    cancellationInventoryDemoWorkerFunctionName: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::Lambda::Function' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationCancellationInventoryDemoWorker'),
        ),
      'OrderNotification cancellation inventory demo worker Lambda',
    ),
    cancellationAccountingDemoWorkerFunctionName: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::Lambda::Function' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationCancellationAccountingDemoWorker'),
        ),
      'OrderNotification cancellation accounting demo worker Lambda',
    ),
    eventTargetDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(resource.LogicalResourceId?.includes('OrderNotificationEventTargetDlq')),
      'OrderNotification event target DLQ',
    ),
    orderShippedNotificationDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationOrderShippedNotificationDlq'),
        ),
      'OrderShipped notification worker DLQ',
    ),
    orderShippedAnalyticsDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(resource.LogicalResourceId?.includes('OrderNotificationOrderShippedAnalyticsDlq')),
      'OrderShipped analytics worker DLQ',
    ),
    orderShippedFulfillmentDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationOrderShippedFulfillmentDlq'),
        ),
      'OrderShipped fulfillment worker DLQ',
    ),
    orderCancelledNotificationDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationOrderCancelledNotificationDlq'),
        ),
      'OrderCancelled notification worker DLQ',
    ),
    orderCancelledInventoryDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationOrderCancelledInventoryDlq'),
        ),
      'OrderCancelled inventory worker DLQ',
    ),
    orderCancelledAccountingDlqUrl: requirePhysicalResourceId(
      resources,
      (resource) =>
        resource.ResourceType === 'AWS::SQS::Queue' &&
        Boolean(
          resource.LogicalResourceId?.includes('OrderNotificationOrderCancelledAccountingDlq'),
        ),
      'OrderCancelled accounting worker DLQ',
    ),
  }
}

function requirePhysicalResourceId(
  resources: StackResourceSummary[],
  predicate: (resource: StackResourceSummary) => boolean,
  label: string,
): string {
  const resource = resources.find(predicate)
  const physicalResourceId = resource?.PhysicalResourceId
  if (!physicalResourceId) {
    throw new Error(`Could not resolve ${label} from stack resources.`)
  }

  return physicalResourceId
}

async function updateLambdaEnvironment(
  lambdaClient: LambdaClient,
  functionName: string,
  variables: NonNullable<EnvironmentResponse['Variables']>,
): Promise<void> {
  await lambdaClient.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: { Variables: variables },
    }),
  )

  await waitForLambdaUpdate(lambdaClient, functionName)
}

async function waitForLambdaUpdate(
  lambdaClient: LambdaClient,
  functionName: string,
): Promise<void> {
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    const response = await lambdaClient.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName }),
    )
    if (response.LastUpdateStatus === 'Successful') {
      return
    }
    if (response.LastUpdateStatus === 'Failed') {
      throw new Error(
        `Lambda update failed: ${response.LastUpdateStatusReason ?? 'unknown reason'}`,
      )
    }

    await wait(2000)
  }

  throw new Error(`Timed out waiting for Lambda ${functionName} configuration update.`)
}

async function publishOrderShippedEvent(region: string, orderId: string): Promise<void> {
  await publishDuplicateOrderShippedEvents(region, orderId, 1)
}

async function publishDuplicateOrderShippedEvents(
  region: string,
  orderId: string,
  count: number,
): Promise<void> {
  const outputs = getAwsOutputs()
  const { runtimeEnv } = getScriptContext()
  const eventBusName = outputs.OrderEventsBusName ?? runtimeEnv.ORDER_EVENTS_BUS_NAME
  const eventBridgeClient = new EventBridgeClient({ region })
  const entries = Array.from({ length: count }, () => ({
    EventBusName: eventBusName,
    Source: 'ecommerce.orders',
    DetailType: 'OrderShipped',
    Detail: JSON.stringify({
      orderId,
      shippedAt: nowIso(),
    }),
  }))

  const response = await eventBridgeClient.send(new PutEventsCommand({ Entries: entries }))
  if ((response.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `PutEvents failed for ${response.FailedEntryCount} entrie(s): ${JSON.stringify(response.Entries)}`,
    )
  }

  console.log(`Published ${entries.length} OrderShipped event(s) for order ${orderId}.`)
}

async function publishDuplicateOrderCancelledEvents(
  region: string,
  orderId: string,
  count: number,
): Promise<void> {
  const outputs = getAwsOutputs()
  const { runtimeEnv } = getScriptContext()
  const eventBusName = outputs.OrderEventsBusName ?? runtimeEnv.ORDER_EVENTS_BUS_NAME
  const eventBridgeClient = new EventBridgeClient({ region })
  const entries = Array.from({ length: count }, () => ({
    EventBusName: eventBusName,
    Source: 'ecommerce.orders',
    DetailType: 'OrderCancelled',
    Detail: JSON.stringify({
      orderId,
      cancelledAt: nowIso(),
      totalAmount: 10_000_000,
    }),
  }))

  const response = await eventBridgeClient.send(new PutEventsCommand({ Entries: entries }))
  if ((response.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `PutEvents failed for ${response.FailedEntryCount} entrie(s): ${JSON.stringify(response.Entries)}`,
    )
  }

  console.log(`Published ${entries.length} OrderCancelled event(s) for order ${orderId}.`)
}

async function waitForQueueMessages(input: {
  region: string
  queueUrl: string
  timeoutSeconds: number
  deleteReceived: boolean
}): Promise<Message[]> {
  const sqsClient = new SQSClient({ region: input.region })
  const deadline = Date.now() + input.timeoutSeconds * 1000

  while (Date.now() < deadline) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: input.queueUrl,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: input.deleteReceived ? undefined : 5,
      }),
    )
    const messages = response.Messages ?? []
    if (messages.length > 0) {
      if (input.deleteReceived) {
        await sqsClient.send(
          new DeleteMessageBatchCommand({
            QueueUrl: input.queueUrl,
            Entries: messages
              .filter((message) => message.ReceiptHandle)
              .map((message, index) => ({
                Id: String(index),
                ReceiptHandle: message.ReceiptHandle,
              })),
          }),
        )
      }

      return messages
    }
  }

  throw new Error(`Timed out waiting for messages in ${input.queueUrl}.`)
}

async function findNotificationTrackingItems(orderId: string): Promise<EmailTrackingItem[]> {
  const { documentClient, runtimeEnv } = getScriptContext()
  const outputs = getAwsOutputs()
  const tableName = outputs.EmailTrackingTableName ?? runtimeEnv.EMAIL_TRACKING_TABLE
  const response = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI_ContextEmailType',
      KeyConditionExpression: '#contextKey = :contextKey AND #emailType = :emailType',
      ExpressionAttributeNames: {
        '#contextKey': 'contextKey',
        '#emailType': 'emailType',
      },
      ExpressionAttributeValues: {
        ':contextKey': `ORDER#${orderId}`,
        ':emailType': 'SHIPPED_ORDER_NOTIFICATION',
      },
    }),
  )

  return (response.Items ?? []) as EmailTrackingItem[]
}

async function waitForTrackingItems(input: {
  orderId: string
  timeoutSeconds: number
  minimumCount: number
}): Promise<EmailTrackingItem[]> {
  const deadline = Date.now() + input.timeoutSeconds * 1000
  let latest: EmailTrackingItem[] = []

  while (Date.now() < deadline) {
    latest = await findNotificationTrackingItems(input.orderId)
    if (
      latest.length >= input.minimumCount &&
      latest.some((item) => item.emailId.startsWith('claim-once#'))
    ) {
      return latest
    }

    await wait(2000)
  }

  return latest
}

async function putEventConsumerRecord(input: {
  idempotencyKey: string
  status: string
  consumerName: string
  contextId: string
  attemptNumber: number
  inProgressExpiresAt?: number
  failureReason?: string
}): Promise<void> {
  const now = nowIso()
  await getScriptContext().documentClient.send(
    new PutCommand({
      TableName: getEventConsumerIdempotencyTableName(),
      Item: {
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        consumerName: input.consumerName,
        contextType: 'ORDER',
        contextId: input.contextId,
        attemptNumber: input.attemptNumber,
        startedAt: now,
        updatedAt: now,
        inProgressExpiresAt: input.inProgressExpiresAt,
        failureReason: input.failureReason,
      },
    }),
  )
}

async function getEventConsumerRecord(
  key: string,
): Promise<EventConsumerIdempotencyItem | undefined> {
  const response = await getScriptContext().documentClient.send(
    new GetCommand({
      TableName: getEventConsumerIdempotencyTableName(),
      Key: { idempotencyKey: key },
    }),
  )

  return response.Item as EventConsumerIdempotencyItem | undefined
}

async function deleteEventConsumerRecords(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      getScriptContext().documentClient.send(
        new DeleteCommand({
          TableName: getEventConsumerIdempotencyTableName(),
          Key: { idempotencyKey: key },
        }),
      ),
    ),
  )
}

async function waitForEventConsumerRecord(input: {
  key: string
  expectedStatus: string
  timeoutSeconds: number
}): Promise<EventConsumerIdempotencyItem | undefined> {
  const deadline = Date.now() + input.timeoutSeconds * 1000
  let latest: EventConsumerIdempotencyItem | undefined

  while (Date.now() < deadline) {
    latest = await getEventConsumerRecord(input.key)
    if (latest?.status === input.expectedStatus) {
      return latest
    }

    await wait(2000)
  }

  return latest
}

async function waitForEventConsumerRecords(input: {
  keys: string[]
  expectedStatus: string
  timeoutSeconds: number
}): Promise<EventConsumerIdempotencyItem[]> {
  const deadline = Date.now() + input.timeoutSeconds * 1000
  let latest: EventConsumerIdempotencyItem[] = []

  while (Date.now() < deadline) {
    latest = (await Promise.all(input.keys.map((key) => getEventConsumerRecord(key)))).filter(
      (item): item is EventConsumerIdempotencyItem => Boolean(item),
    )
    if (
      latest.length === input.keys.length &&
      latest.every((item) => item.status === input.expectedStatus)
    ) {
      return latest
    }

    await wait(2000)
  }

  return latest
}

function getEventConsumerIdempotencyTableName(): string {
  const { runtimeEnv } = getScriptContext()
  const outputs = getAwsOutputs()
  return outputs.EventConsumerIdempotencyTableName ?? runtimeEnv.EVENT_CONSUMER_IDEMPOTENCY_TABLE
}

function buildEventConsumerKey(orderId: string, action: string): string {
  return `ORDER#${orderId}#${action}`
}

function formatEventConsumerRecord(
  record: EventConsumerIdempotencyItem | undefined,
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined
  }

  return {
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    consumerName: record.consumerName,
    contextId: record.contextId,
    attemptNumber: record.attemptNumber,
    updatedAt: record.updatedAt,
    inProgressExpiresAt: record.inProgressExpiresAt,
    failureReason: record.failureReason,
  }
}

function groupTrackingByRecipient(items: EmailTrackingItem[]): Map<string, EmailTrackingItem[]> {
  const grouped = new Map<string, EmailTrackingItem[]>()
  for (const item of items) {
    const key = item.recipientEmail
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }

  return grouped
}

async function purgeTestQueues(resources: StackResources, region: string): Promise<void> {
  const sqsClient = new SQSClient({ region })
  const queueUrls = [
    resources.eventTargetDlqUrl,
    resources.orderShippedNotificationDlqUrl,
    resources.orderShippedAnalyticsDlqUrl,
    resources.orderShippedFulfillmentDlqUrl,
    resources.orderCancelledNotificationDlqUrl,
    resources.orderCancelledInventoryDlqUrl,
    resources.orderCancelledAccountingDlqUrl,
  ]

  for (const queueUrl of queueUrls) {
    try {
      await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl }))
      console.log(`Purged ${queueUrl}.`)
    } catch (error) {
      console.warn(`Could not purge ${queueUrl}. Continuing.`, error)
    }
  }
}

function printMessages(label: string, messages: Message[]): void {
  console.log(
    JSON.stringify(
      {
        queue: label,
        count: messages.length,
        messages: messages.map((message) => ({
          messageId: message.MessageId,
          attributes: message.Attributes,
          messageAttributes: message.MessageAttributes,
          body: parseJsonIfPossible(message.Body),
        })),
      },
      null,
      2,
    ),
  )
}

function parseJsonIfPossible(value: string | undefined): unknown {
  if (!value) {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function readFlowFlag(): Flow {
  const flow = readOptionalStringFlag('flow')
  if (
    flow === 'delivery-failed' ||
    flow === 'processing-failed' ||
    flow === 'duplicate-events' ||
    flow === 'event-consumer-duplicates' ||
    flow === 'event-consumer-states' ||
    flow === 'event-consumer-failure'
  ) {
    return flow
  }

  throw new Error(
    'Missing or invalid --flow. Use delivery-failed, processing-failed, duplicate-events, event-consumer-duplicates, event-consumer-states, or event-consumer-failure.',
  )
}

function readStringFlag(name: string, fallback: string): string {
  return readOptionalStringFlag(name) ?? fallback
}

function readOptionalStringFlag(name: string): string | undefined {
  const args = process.argv.slice(2)
  const directFlag = `--${name}`

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (current === directFlag) {
      const next = args[index + 1]
      if (typeof next === 'string' && next.trim()) {
        return next.trim()
      }
      throw new Error(`Expected a value after ${directFlag}.`)
    }

    if (current?.startsWith(`${directFlag}=`)) {
      const value = current.slice(directFlag.length + 1).trim()
      if (value) {
        return value
      }
      throw new Error(`Expected a non-empty value for ${directFlag}.`)
    }
  }

  return undefined
}

function readIntFlag(name: string, fallback: number): number {
  const value = readOptionalStringFlag(name)
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected --${name} to be a positive integer.`)
  }

  return parsed
}

function readBooleanFlag(name: string, fallback: boolean): boolean {
  const args = process.argv.slice(2)
  const directFlag = `--${name}`
  if (args.includes(directFlag)) {
    return true
  }

  const value = readOptionalStringFlag(name)
  if (!value) {
    return fallback
  }

  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }

  throw new Error(`Expected --${name} to be true or false.`)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

void main().catch(exitWithError)
