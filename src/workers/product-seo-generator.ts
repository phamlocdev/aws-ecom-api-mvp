import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { EventBridgeEvent } from 'aws-lambda'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbProductRepository } from '../products/infrastructure/dynamodb-product.repository'
import { ProductSeoData, renderProductSeoHtml } from './product-seo-renderer'

type ProductEventDetailType = 'ProductCreated' | 'ProductUpdated' | 'ProductDeleted'

type ProductEventDetail = {
  productId?: string
}

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-1'
const productsTable = requireEnv('PRODUCTS_TABLE')
const siteBucket = requireEnv('CLIENT_SITE_BUCKET')
const distributionId = requireEnv('CLIENT_DISTRIBUTION_ID')
const clientBaseUrl = requireEnv('CLIENT_BASE_URL').replace(/\/$/, '')
const mediaPublicBaseUrl = requireEnv('MEDIA_PUBLIC_BASE_URL').replace(/\/$/, '')
const templateKey = process.env.PRODUCT_TEMPLATE_KEY ?? 'products/__template/index.html'

const s3Client = new S3Client({ region })
const dynamoDbDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
const cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' })

// Reuses the canonical Infrastructure adapter (same table wiring/query shape
// as the HTTP products API) instead of hand-rolling a GetCommand here, per
// docs/refactor/PLAN.md Giai đoạn 4. This Lambda otherwise avoids booting a
// full NestJS application context, so the repository is constructed with a
// minimal stand-in for DynamoDbService/DynamoTablesService rather than DI.
const productRepository = new DynamoDbProductRepository(
  { documentClient: dynamoDbDocumentClient } as unknown as DynamoDbService,
  { products: productsTable } as unknown as DynamoTablesService,
)

export async function handler(
  event: EventBridgeEvent<ProductEventDetailType, ProductEventDetail>,
): Promise<void> {
  const detailType = event['detail-type']
  const rawProductId = event.detail.productId

  console.log(
    `Product SEO generator received ${detailType} event for productId: ${rawProductId ?? '<missing>'}.`,
  )

  try {
    const productId = normalizeProductId(rawProductId)
    const productKey = getProductPageKey(productId)

    console.log(`Processing ${detailType} for product ${productId} with page key ${productKey}.`)

    if (detailType === 'ProductDeleted') {
      console.log(`Deleting product SEO page from s3://${siteBucket}/${productKey}.`)
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: siteBucket,
          Key: productKey,
        }),
      )

      console.log(`Deleted product SEO page for product ${productId}.`)
      await invalidateProductPaths(productId)

      console.log(`Finished ProductDeleted SEO cleanup for product ${productId}.`)
      return
    }

    const product = await getProduct(productId)
    const template = await getTemplate()
    const html = renderProductSeoHtml(template, product, {
      clientBaseUrl,
      mediaPublicBaseUrl,
    })

    console.log(`Writing rendered product SEO page to s3://${siteBucket}/${productKey}.`)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: siteBucket,
        Key: productKey,
        Body: html,
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'public, max-age=60, stale-while-revalidate=300',
      }),
    )

    console.log(`Rendered product SEO page for product ${productId}.`)
    await invalidateProductPaths(productId)

    console.log(`Finished ${detailType} SEO generation for product ${productId}.`)
  } catch (error) {
    console.error(
      `Failed to process ${detailType} SEO event for productId: ${rawProductId ?? '<missing>'}.`,
      error,
    )
    throw error
  }
}

async function getProduct(productId: string): Promise<ProductSeoData> {
  console.log(`Loading product ${productId} from table ${productsTable}.`)
  const product = await productRepository.findOne(productId)

  if (!product) {
    throw new Error(`Product ${productId} was not found.`)
  }

  console.log(`Loaded product ${productId} from table ${productsTable}.`)
  return product
}

async function getTemplate(): Promise<string> {
  console.log(`Loading product SEO template from s3://${siteBucket}/${templateKey}.`)
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: siteBucket,
      Key: templateKey,
    }),
  )

  if (!response.Body) {
    throw new Error(`Template ${templateKey} was empty.`)
  }

  const template = await response.Body.transformToString()
  console.log(`Loaded product SEO template from s3://${siteBucket}/${templateKey}.`)

  return template
}

async function invalidateProductPaths(productId: string): Promise<void> {
  const paths = [`/products/${productId}`, `/products/${productId}/index.html`]

  console.log(
    `Creating CloudFront invalidation for product ${productId} on distribution ${distributionId}: ${paths.join(
      ', ',
    )}.`,
  )

  await cloudFrontClient.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${productId}-${Date.now()}`,
        Paths: {
          Quantity: paths.length,
          Items: paths,
        },
      },
    }),
  )

  console.log(`Created CloudFront invalidation for product ${productId}.`)
}

function getProductPageKey(productId: string): string {
  return `products/${productId}/index.html`
}

function normalizeProductId(productId: string | undefined): string {
  if (!productId || productId.includes('/') || productId.includes('\\')) {
    throw new Error('Product event detail.productId is required and must not contain slashes.')
  }

  return productId
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}
