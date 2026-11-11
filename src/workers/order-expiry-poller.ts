import { ScheduledEvent } from 'aws-lambda'
import { Logger } from '@nestjs/common'
import { OrdersWorkerService } from './orders-worker.service'
import { createOrdersWorkerApp } from '../worker.bootstrap'

let workerServicePromise: Promise<OrdersWorkerService>
const logger = new Logger('OrderExpiryPoller')

async function getWorkerService(): Promise<OrdersWorkerService> {
  if (!workerServicePromise) {
    workerServicePromise = createOrdersWorkerApp().then((app) => app.get(OrdersWorkerService))
  }

  return workerServicePromise
}

export async function handler(_event: ScheduledEvent): Promise<void> {
  logger.log('Reservation expiry poller invoked.')
  const worker = await getWorkerService()
  await worker.handleReservationExpirySweep()
}
