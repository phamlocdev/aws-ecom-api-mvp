import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import {
  exitWithError,
  getAwsOutputs,
  getScriptContext,
  readIntFlag,
} from './script-helpers'

const PRODUCT_EVENT_SOURCE = 'ecommerce.products'
const PRODUCT_UPDATED_DETAIL_TYPE = 'ProductUpdated'
const EVENTBRIDGE_PUT_EVENTS_BATCH_SIZE = 10
const SCAN_PAGE_SIZE = 100

type ProductKey = {
  id: string
}

async function main(): Promise<void> {
  const { runtimeEnv, documentClient } = getScriptContext()
  const outputs = getAwsOutputs()
  const productsTable = outputs.ProductsTableName ?? runtimeEnv.PRODUCTS_TABLE
  const eventBusName = outputs.OrderEventsBusName ?? runtimeEnv.ORDER_EVENTS_BUS_NAME
  const region = runtimeEnv.AWS_REGION ?? runtimeEnv.AWS_DEFAULT_REGION
  const dryRun = process.argv.includes('--dry-run')
  const limit = readOptionalPositiveIntFlag('limit')
  const eventBridgeClient = new EventBridgeClient({ region })

  console.log(
    `Backfilling product SEO pages from table ${productsTable} via bus ${eventBusName}${
      dryRun ? ' (dry run)' : ''
    }.`,
  )

  let scannedCount = 0
  let publishedCount = 0
  let lastEvaluatedKey: Record<string, unknown> | undefined

  do {
    const remaining = limit ? limit - scannedCount : undefined
    if (remaining !== undefined && remaining <= 0) {
      break
    }

    const response = await documentClient.send(
      new ScanCommand({
        TableName: productsTable,
        ProjectionExpression: 'id',
        Limit: remaining ? Math.min(remaining, SCAN_PAGE_SIZE) : SCAN_PAGE_SIZE,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    )

    const products = ((response.Items ?? []) as ProductKey[]).filter((item) => item.id)
    scannedCount += products.length

    if (dryRun) {
      for (const product of products) {
        console.log(`[dry-run] Would publish ${PRODUCT_UPDATED_DETAIL_TYPE} for ${product.id}.`)
      }
    } else {
      publishedCount += await publishProductUpdatedEvents(eventBridgeClient, eventBusName, products)
    }

    lastEvaluatedKey = response.LastEvaluatedKey
  } while (lastEvaluatedKey && (!limit || scannedCount < limit))

  console.log(
    `Finished product SEO backfill. Scanned ${scannedCount} product(s), ${
      dryRun ? 'would publish' : 'published'
    } ${dryRun ? scannedCount : publishedCount} event(s).`,
  )
}

async function publishProductUpdatedEvents(
  eventBridgeClient: EventBridgeClient,
  eventBusName: string,
  products: ProductKey[],
): Promise<number> {
  let publishedCount = 0

  for (let start = 0; start < products.length; start += EVENTBRIDGE_PUT_EVENTS_BATCH_SIZE) {
    const batch = products.slice(start, start + EVENTBRIDGE_PUT_EVENTS_BATCH_SIZE)
    const response = await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: batch.map((product) => ({
          EventBusName: eventBusName,
          Source: PRODUCT_EVENT_SOURCE,
          DetailType: PRODUCT_UPDATED_DETAIL_TYPE,
          Detail: JSON.stringify({ productId: product.id }),
        })),
      }),
    )

    const failedEntry = response.Entries?.find((entry) => entry.ErrorCode || entry.ErrorMessage)
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      throw new Error(
        `Failed to publish product SEO backfill event: ${failedEntry?.ErrorCode ?? 'unknown-error'} ${
          failedEntry?.ErrorMessage ?? ''
        }`.trim(),
      )
    }

    publishedCount += batch.length
    console.log(`Published ${batch.length} product SEO backfill event(s).`)
  }

  return publishedCount
}

function readOptionalPositiveIntFlag(name: string): number | undefined {
  if (!process.argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))) {
    return undefined
  }

  return readIntFlag(name, 1)
}

void main().catch(exitWithError)
