import { SQSEvent, SQSBatchResponse } from 'aws-lambda'
import { AuditLogService } from './audit/audit-log.service'
import { createOrderAuditLogProcessorApp } from './worker.bootstrap'

let processorServicePromise: Promise<AuditLogService>

async function getProcessorService(): Promise<AuditLogService> {
  if (!processorServicePromise) {
    processorServicePromise = createOrderAuditLogProcessorApp().then((app) => app.get(AuditLogService))
  }

  return processorServicePromise
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const processor = await getProcessorService()
  return processor.handleBatch(event)
}
