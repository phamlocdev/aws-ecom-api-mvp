import { SQSEvent, SQSBatchResponse } from 'aws-lambda'
import { OrdersWorkerService } from './orders-worker.service'
import { createOrdersWorkerApp } from '../worker.bootstrap'

let workerServicePromise: Promise<OrdersWorkerService>

async function getWorkerService(): Promise<OrdersWorkerService> {
  if (!workerServicePromise) {
    workerServicePromise = createOrdersWorkerApp().then((app) => app.get(OrdersWorkerService))
  }

  return workerServicePromise
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const worker = await getWorkerService()
  return worker.handlePlaceOrderBatch(event)
}
