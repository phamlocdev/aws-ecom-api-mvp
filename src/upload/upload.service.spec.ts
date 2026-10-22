import { mockClient } from 'aws-sdk-client-mock'
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { ConfigService } from '@nestjs/config'
import { ForbiddenDomainError, InvalidInputError } from '../common/domain-error'
import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import { UploadService } from './upload.service'
import { UploadTarget } from './dto/presign-upload.dto'

// Mock the presigned URL functions so no real AWS calls are needed
jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn().mockResolvedValue({
    url: 'https://bucket.s3.amazonaws.com',
    fields: { key: 'some/path.webp', 'Content-Type': 'image/webp' },
  }),
}))

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/signed-url'),
}))

const s3Mock = mockClient(S3Client)

function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const config: Record<string, unknown> = {
    AWS_REGION: 'ap-southeast-1',
    MEDIA_BUCKET_NAME: 'test-media-bucket',
    PRODUCT_IMAGE_MAX_COUNT: 5,
    UPLOAD_MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
    MEDIA_READ_URL_TTL_SECONDS: 900,
    ...overrides,
  }
  return {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService
}

function makeUser(groups: Role[]): AuthenticatedUser {
  return {
    sub: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    groups,
    permissions: [],
    tokenUse: 'access',
    clientId: 'client',
  }
}

describe('UploadService', () => {
  let service: UploadService

  beforeEach(() => {
    s3Mock.reset()
    service = new UploadService(makeConfigService())
  })

  describe('getProductImageMaxCount', () => {
    it('returns the configured max count', () => {
      expect(service.getProductImageMaxCount()).toBe(5)
    })

    it('falls back to 10 when the config value is missing', () => {
      const fallbackService = new UploadService(
        makeConfigService({ PRODUCT_IMAGE_MAX_COUNT: undefined }),
      )
      expect(fallbackService.getProductImageMaxCount()).toBe(10)
    })
  })

  describe('isAvatarKeyForUser', () => {
    it('returns true when the key starts with the user avatar prefix', () => {
      expect(service.isAvatarKeyForUser('users/user-1/avatar/some-file.webp', 'user-1')).toBe(true)
    })

    it('returns false for a different user id', () => {
      expect(service.isAvatarKeyForUser('users/user-2/avatar/some-file.webp', 'user-1')).toBe(false)
    })

    it('returns false for a product image key', () => {
      expect(service.isAvatarKeyForUser('products/group-id/img.webp', 'user-1')).toBe(false)
    })
  })

  describe('createPresignedUploadPolicies — AVATAR target', () => {
    it('throws InvalidInputError when more than one file is provided', async () => {
      await expect(
        service.createPresignedUploadPolicies(
          {
            target: UploadTarget.AVATAR,
            files: [
              { fileName: 'a.webp', contentType: 'image/webp', sizeBytes: 1000 },
              { fileName: 'b.webp', contentType: 'image/webp', sizeBytes: 1000 },
            ],
          },
          makeUser([Role.CUSTOMER]),
        ),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('throws InvalidInputError when the file exceeds the size limit', async () => {
      await expect(
        service.createPresignedUploadPolicies(
          {
            target: UploadTarget.AVATAR,
            files: [
              {
                fileName: 'big.webp',
                contentType: 'image/webp',
                sizeBytes: 10 * 1024 * 1024,
              },
            ],
          },
          makeUser([Role.CUSTOMER]),
        ),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('returns a presigned post for a valid avatar upload', async () => {
      const result = await service.createPresignedUploadPolicies(
        {
          target: UploadTarget.AVATAR,
          files: [{ fileName: 'avatar.webp', contentType: 'image/webp', sizeBytes: 100_000 }],
        },
        makeUser([Role.CUSTOMER]),
      )

      expect(result.items).toHaveLength(1)
      expect(result.items[0].imageKey).toMatch(/^users\/user-1\/avatar\//)
      expect(result.expiresInSeconds).toBe(900)
    })
  })

  describe('createPresignedUploadPolicies — PRODUCT_IMAGE target', () => {
    it('throws ForbiddenDomainError when a customer tries to upload a product image', async () => {
      await expect(
        service.createPresignedUploadPolicies(
          {
            target: UploadTarget.PRODUCT_IMAGE,
            files: [{ fileName: 'shoe.webp', contentType: 'image/webp', sizeBytes: 100_000 }],
          },
          makeUser([Role.CUSTOMER]),
        ),
      ).rejects.toBeInstanceOf(ForbiddenDomainError)
    })

    it('throws InvalidInputError when too many product images are provided', async () => {
      const files = Array.from({ length: 6 }, (_, i) => ({
        fileName: `img-${i}.webp`,
        contentType: 'image/webp' as const,
        sizeBytes: 100_000,
      }))

      await expect(
        service.createPresignedUploadPolicies(
          { target: UploadTarget.PRODUCT_IMAGE, files },
          makeUser([Role.ADMIN]),
        ),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('returns presigned posts for admin uploading product images within the limit', async () => {
      const result = await service.createPresignedUploadPolicies(
        {
          target: UploadTarget.PRODUCT_IMAGE,
          files: [
            { fileName: 'shoe-1.webp', contentType: 'image/webp', sizeBytes: 100_000 },
            { fileName: 'shoe-2.webp', contentType: 'image/webp', sizeBytes: 100_000 },
          ],
        },
        makeUser([Role.ADMIN]),
      )

      expect(result.items).toHaveLength(2)
      result.items.forEach((item) => {
        expect(item.imageKey).toMatch(/^products\//)
      })
    })

    it('allows managers to upload product images', async () => {
      const result = await service.createPresignedUploadPolicies(
        {
          target: UploadTarget.PRODUCT_IMAGE,
          files: [{ fileName: 'shoe.webp', contentType: 'image/webp', sizeBytes: 100_000 }],
        },
        makeUser([Role.MANAGER]),
      )

      expect(result.items).toHaveLength(1)
    })
  })

  describe('verifyObjectsExist', () => {
    it('resolves when all objects exist in S3', async () => {
      s3Mock.on(HeadObjectCommand).resolves({})

      await expect(service.verifyObjectsExist(['products/a/1.webp'])).resolves.toBeUndefined()
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(1)
    })

    it('throws InvalidInputError when an object is not found (404)', async () => {
      s3Mock.on(HeadObjectCommand).rejects(
        Object.assign(new Error('Not Found'), { name: 'NotFound' }),
      )

      await expect(
        service.verifyObjectsExist(['products/missing.webp']),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('deduplicates keys before checking', async () => {
      s3Mock.on(HeadObjectCommand).resolves({})

      await service.verifyObjectsExist(['key.webp', 'key.webp'])

      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(1)
    })
  })

  describe('createReadUrls', () => {
    it('returns a signed URL for each unique key', async () => {
      const urls = await service.createReadUrls(['products/a/1.webp', 'products/b/2.webp'])

      expect(urls).toHaveLength(2)
      urls.forEach((item) => {
        expect(item.readUrl).toBeTruthy()
        expect(item.expiresInSeconds).toBe(900)
      })
    })

    it('deduplicates keys', async () => {
      const urls = await service.createReadUrls(['products/a/1.webp', 'products/a/1.webp'])

      expect(urls).toHaveLength(1)
    })
  })

  describe('deleteObjectsBestEffort', () => {
    it('sends a DeleteObjectCommand for each key', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({})

      await service.deleteObjectsBestEffort(['products/a/1.webp', 'products/b/2.webp'])

      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(2)
    })

    it('does not throw when a delete fails', async () => {
      s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 error'))

      await expect(
        service.deleteObjectsBestEffort(['products/a/1.webp']),
      ).resolves.toBeUndefined()
    })

    it('deduplicates keys before deleting', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({})

      await service.deleteObjectsBestEffort(['key.webp', 'key.webp'])

      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1)
    })
  })
})
