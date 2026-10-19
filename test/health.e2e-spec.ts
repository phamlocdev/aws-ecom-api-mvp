import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { HealthModule } from '../src/health/health.module'
import { DynamoDbModule } from '../src/dynamodb/dynamodb.module'
import { DynamoDbService } from '../src/dynamodb/dynamodb.service'

// Baseline e2e smoke test for Giai đoạn 0: confirms the HTTP contract of
// GET /health (200 when DynamoDB is reachable, 503 otherwise) before any
// refactor touches this flow. See docs/refactor/PLAN.md.
describe('Health (e2e)', () => {
  let app: INestApplication
  let checkConnection: jest.Mock

  beforeEach(async () => {
    checkConnection = jest.fn()

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [HealthModule, DynamoDbModule],
    })
      .overrideProvider(DynamoDbService)
      .useValue({ checkConnection })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /health returns 200 when DynamoDB is reachable', async () => {
    checkConnection.mockResolvedValue(undefined)

    const response = await request(app.getHttpServer()).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', dynamodb: 'ok' })
  })

  it('GET /health returns 503 when DynamoDB is unreachable', async () => {
    checkConnection.mockRejectedValue(new Error('connection refused'))

    const response = await request(app.getHttpServer()).get('/health')

    expect(response.status).toBe(503)
  })
})
