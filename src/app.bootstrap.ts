import { ConsoleLogger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { DomainExceptionFilter } from './common/domain-exception.filter'

const { eventContext } = require('@codegenie/serverless-express/src/middleware') as {
  eventContext: (options?: {
    reqPropKey?: string
    deleteHeaders?: boolean
  }) => (req: unknown, res: unknown, next: () => void) => void
}

export interface BootstrapOptions {
  enableSwagger?: boolean
}

export async function createNestApp(
  options: BootstrapOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger('', {
      logLevels: ['log', 'error', 'warn'],
      colors: false,
    }),
  })

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )

  app.useGlobalFilters(new DomainExceptionFilter())

  app.use(eventContext({ reqPropKey: 'apiGateway' }))

  if (options.enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DynamoDB E-commerce Learning API')
      .setDescription('REST API for learning DynamoDB on AWS')
      .setVersion('1.0')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api', app, document)
  }

  return app
}
