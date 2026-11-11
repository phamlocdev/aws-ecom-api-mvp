import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { S3Event, S3Handler } from 'aws-lambda'
import sharp from 'sharp'
import { createS3Client, getS3Settings } from '../upload/s3.config'

const PROCESSED_METADATA_KEY = 'image-processed'
const PROCESSED_METADATA_VALUE = 'true'
const PRODUCT_IMAGE_MAX_DIMENSION = 1600
const PRODUCT_IMAGE_WEBP_QUALITY = 5
const AVATAR_SIZE = 512
const AVATAR_WEBP_QUALITY = 82

const settings = getS3Settings()
const s3Client = createS3Client(settings)

export const handler: S3Handler = async (event: S3Event): Promise<void> => {
  await Promise.all(event.Records.map((record) => processRecord(record, s3Client)))
}

async function processRecord(record: S3Event['Records'][number], client: S3Client): Promise<void> {
  const bucket = record.s3.bucket.name
  const key = decodeS3Key(record.s3.object.key)

  if (!isSupportedImageKey(key)) {
    console.info(`Ignoring unsupported media key: ${key}`)
    return
  }

  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  if (head.Metadata?.[PROCESSED_METADATA_KEY] === PROCESSED_METADATA_VALUE) {
    console.info(`Ignoring already processed image: ${key}`)
    return
  }

  const source = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!source.Body) {
    throw new Error(`S3 object body is empty: ${key}`)
  }

  const sourceBuffer = Buffer.from(await source.Body.transformToByteArray())
  const optimizedImage = await transformImage(sourceBuffer, key)

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: optimizedImage,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        [PROCESSED_METADATA_KEY]: PROCESSED_METADATA_VALUE,
        'image-processor-version': '1',
      },
    }),
  )

  console.info(`Processed image: ${key}`)
}

function transformImage(source: Buffer, key: string): Promise<Buffer> {
  const pipeline = sharp(source, { failOn: 'none' }).rotate()

  if (key.startsWith('users/')) {
    return pipeline
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer()
  }

  return pipeline
    .resize(PRODUCT_IMAGE_MAX_DIMENSION, PRODUCT_IMAGE_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY })
    .toBuffer()
}

function isSupportedImageKey(key: string): boolean {
  return key.startsWith('products/') || key.startsWith('users/')
}

function decodeS3Key(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '))
}
