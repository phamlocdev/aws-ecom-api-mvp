import { SQSEvent, SQSBatchResponse } from 'aws-lambda'
import { OrderAuditLogProcessorService } from './audit/order-audit-log-processor.service'
import { createOrderAuditLogProcessorApp } from './worker.bootstrap'

let processorServicePromise: Promise<OrderAuditLogProcessorService>

async function getProcessorService(): Promise<OrderAuditLogProcessorService> {
  if (!processorServicePromise) {
    processorServicePromise = createOrderAuditLogProcessorApp().then((app) =>
      app.get(OrderAuditLogProcessorService),
    )
  }

  return processorServicePromise
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  throw new Error('test-dlq-feature')
  // const processor = await getProcessorService()
  // return processor.handleBatch(event)
}
