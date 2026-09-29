import { ConsoleLogger, INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { OrderAuditLogProcessorModule } from './audit/order-audit-log-processor.module'
import { CognitoTriggersModule } from './cognito/cognito-triggers.module'
import { PostConfirmationModule } from './cognito/post-confirmation.module'
import { SesEventProcessorModule } from './mail/ses-event-processor.module'
import { OrderNotificationWorkerModule } from './notifications/order-notification-worker.module'
import { OrdersWorkerModule } from './workers/orders-worker.module'

export async function createOrdersWorkerApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(OrdersWorkerModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}

export async function createOrderAuditLogProcessorApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(OrderAuditLogProcessorModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}

export async function createSesEventProcessorApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(SesEventProcessorModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}

export async function createOrderNotificationWorkerApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(OrderNotificationWorkerModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}

export async function createPostConfirmationApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(PostConfirmationModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}

export async function createCognitoTriggersApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(CognitoTriggersModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })
}
