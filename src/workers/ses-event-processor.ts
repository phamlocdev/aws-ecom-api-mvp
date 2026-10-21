import { SNSEvent } from 'aws-lambda'
import { SesEventProcessorService } from '../mail/ses-event-processor.service'
import { createSesEventProcessorApp } from '../worker.bootstrap'

let eventProcessorServicePromise: Promise<SesEventProcessorService>

async function getEventProcessorService(): Promise<SesEventProcessorService> {
  if (!eventProcessorServicePromise) {
    eventProcessorServicePromise = createSesEventProcessorApp().then((app) =>
      app.get(SesEventProcessorService),
    )
  }

  return eventProcessorServicePromise
}

export async function handler(event: SNSEvent): Promise<void> {
  const eventProcessor = await getEventProcessorService()
  return eventProcessor.handleSesEventBatch(event)
}
