import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { AuthenticatedUser } from '../auth/auth.types'
import { Role } from '../auth/roles.enum'
import { ForbiddenDomainError, InvalidInputError } from '../common/domain-error'
import {
  PresignUploadFileDto,
  PresignUploadRequestDto,
  PresignUploadResponseDto,
  UploadTarget,
} from './dto/presign-upload.dto'
import { createS3Client, getS3Settings } from './s3.config'

const DEFAULT_UPLOAD_EXPIRES_SECONDS = 900
const DEFAULT_READ_URL_TTL_SECONDS = 900
const DEFAULT_PRODUCT_IMAGE_MAX_COUNT = 10
const DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

export interface MediaReadUrl {
  key: string
  readUrl: string
  expiresInSeconds: number
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name)
  private readonly internalClient: S3Client
  private readonly publicClient: S3Client
  private readonly bucketName: string
  private readonly productImageMaxCount: number
  private readonly uploadMaxFileSizeBytes: number
  private readonly uploadExpiresSeconds = DEFAULT_UPLOAD_EXPIRES_SECONDS
  private readonly readUrlTtlSeconds: number

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const settings = getS3Settings({
      AWS_REGION: configService.get<string>('AWS_REGION'),
      AWS_DEFAULT_REGION: configService.get<string>('AWS_DEFAULT_REGION'),
      MEDIA_BUCKET_NAME: configService.get<string>('MEDIA_BUCKET_NAME'),
    })

    this.internalClient = createS3Client(settings)
    this.publicClient = createS3Client(settings)
    this.bucketName = settings.bucketName
    this.productImageMaxCount = readPositiveInteger(
      configService.get<number>('PRODUCT_IMAGE_MAX_COUNT'),
      DEFAULT_PRODUCT_IMAGE_MAX_COUNT,
    )
    this.uploadMaxFileSizeBytes = readPositiveInteger(
      configService.get<number>('UPLOAD_MAX_FILE_SIZE_BYTES'),
      DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES,
    )
    this.readUrlTtlSeconds = readPositiveInteger(
      configService.get<number>('MEDIA_READ_URL_TTL_SECONDS'),
      DEFAULT_READ_URL_TTL_SECONDS,
    )
  }

  async createPresignedUploadPolicies(
    dto: PresignUploadRequestDto,
    user: AuthenticatedUser,
  ): Promise<PresignUploadResponseDto> {
    if (dto.target === UploadTarget.AVATAR) {
      this.validateAvatarFiles(dto.files)
      return this.createPresignedPosts(
        dto.files.map((file) => ({
          file,
          imageKey: buildAvatarKey(user.sub, file),
        })),
      )
    }

    if (dto.target === UploadTarget.PRODUCT_IMAGE) {
      if (!user.groups.includes(Role.MANAGER) && !user.groups.includes(Role.ADMIN)) {
        throw new ForbiddenDomainError('Only managers and admins can upload product images.')
      }

      this.validateProductImageFiles(dto.files)
      const groupId = randomUUID()
      return this.createPresignedPosts(
        dto.files.map((file) => ({
          file,
          imageKey: buildProductImageKey(groupId, file),
        })),
      )
    }

    throw new InvalidInputError(`Unsupported upload target: ${dto.target}`)
  }

  private async createPresignedPosts(
    uploads: Array<{ file: PresignUploadFileDto; imageKey: string }>,
  ): Promise<PresignUploadResponseDto> {
    const items = await Promise.all(
      uploads.map(async ({ file, imageKey }) => {
        const presignedPost = await createPresignedPost(this.publicClient, {
          Bucket: this.bucketName,
          Key: imageKey,
          Expires: this.uploadExpiresSeconds,
          Fields: {
            key: imageKey,
            'Content-Type': file.contentType,
          },
          Conditions: [
            ['eq', '$key', imageKey],
            ['eq', '$Content-Type', file.contentType],
            ['content-length-range', 1, this.uploadMaxFileSizeBytes],
          ],
        })

        return {
          imageKey,
          url: presignedPost.url,
          fields: presignedPost.fields,
        }
      }),
    )

    return {
      expiresInSeconds: this.uploadExpiresSeconds,
      items,
    }
  }

  async verifyObjectsExist(keys: string[]): Promise<void> {
    for (const key of unique(keys)) {
      try {
        await this.internalClient.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
        )
      } catch (error) {
        if (isS3NotFound(error)) {
          throw new InvalidInputError(`Uploaded media object does not exist: ${key}`)
        }
        throw error
      }
    }
  }

  async createReadUrls(keys: string[]): Promise<MediaReadUrl[]> {
    return Promise.all(
      unique(keys).map(async (key) => ({
        key,
        readUrl: await getSignedUrl(
          this.publicClient,
          new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
          { expiresIn: this.readUrlTtlSeconds },
        ),
        expiresInSeconds: this.readUrlTtlSeconds,
      })),
    )
  }

  async deleteObjectsBestEffort(keys: string[]): Promise<void> {
    await Promise.all(
      unique(keys).map(async (key) => {
        try {
          await this.internalClient.send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: key,
            }),
          )
        } catch (error) {
          this.logger.error(`Failed to delete S3 object ${key}`, error)
        }
      }),
    )
  }

  getProductImageMaxCount(): number {
    return this.productImageMaxCount
  }

  isAvatarKeyForUser(key: string, userId: string): boolean {
    return key.startsWith(`users/${userId}/avatar/`)
  }

  private validateAvatarFiles(files: PresignUploadFileDto[]): void {
    if (files.length !== 1) {
      throw new InvalidInputError('Avatar upload requires exactly one file.')
    }

    const [file] = files
    if (file.sizeBytes > this.uploadMaxFileSizeBytes) {
      throw new InvalidInputError(
        `File ${file.fileName} exceeds the ${this.uploadMaxFileSizeBytes} byte limit.`,
      )
    }
  }

  private validateProductImageFiles(files: PresignUploadFileDto[]): void {
    if (files.length > this.productImageMaxCount) {
      throw new InvalidInputError(
        `Product images cannot exceed ${this.productImageMaxCount} files.`,
      )
    }

    const oversizedFile = files.find((file) => file.sizeBytes > this.uploadMaxFileSizeBytes)
    if (oversizedFile) {
      throw new InvalidInputError(
        `File ${oversizedFile.fileName} exceeds the ${this.uploadMaxFileSizeBytes} byte limit.`,
      )
    }
  }
}

function buildProductImageKey(groupId: string, file: PresignUploadFileDto): string {
  return `products/${groupId}/${randomUUID()}-${toWebpFileName(file.fileName)}`
}

function buildAvatarKey(userId: string, file: PresignUploadFileDto): string {
  return `users/${userId}/avatar/${randomUUID()}-${toWebpFileName(file.fileName)}`
}

function sanitizeFileName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop()?.trim().toLowerCase() ?? ''
  const sanitized = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)

  return sanitized || 'image'
}

function toWebpFileName(fileName: string): string {
  const sanitized = sanitizeFileName(fileName)
  const extensionIndex = sanitized.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? sanitized.slice(0, extensionIndex) : sanitized

  return `${baseName || 'image'}.webp`
}

function readPositiveInteger(value: number | string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isS3NotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  if ('name' in error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) {
    return true
  }

  return (
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  )
}
