import { BadRequestException, Logger } from '@nestjs/common'
import { UploadService } from '../../upload/upload.service'
import { Product, ProductImage } from '../domain/product.entity'

export interface ProductImageInput {
  key: string
  sortOrder: number
  isPrimary?: boolean
  altText?: string
}

export function getProductImageKeys(images: ProductImage[] | undefined): string[] {
  return images?.map((image) => image.key) ?? []
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  return values.find((value) => {
    if (seen.has(value)) {
      return true
    }

    seen.add(value)
    return false
  })
}

export async function prepareProductImages(
  uploadService: UploadService,
  images: ProductImageInput[] | undefined,
): Promise<ProductImage[] | undefined> {
  if (images === undefined) {
    return undefined
  }

  const maxImageCount = uploadService.getProductImageMaxCount()
  if (images.length > maxImageCount) {
    throw new BadRequestException(`Product images cannot exceed ${maxImageCount} files.`)
  }

  const duplicateKey = findDuplicate(images.map((image) => image.key))
  if (duplicateKey) {
    throw new BadRequestException(`Duplicate product image key: ${duplicateKey}`)
  }

  const normalizedImages = images.map((image) => ({
    key: image.key,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary ?? false,
    ...(image.altText ? { altText: image.altText } : {}),
  }))

  const primaryCount = normalizedImages.filter((image) => image.isPrimary).length
  if (primaryCount > 1) {
    throw new BadRequestException('Only one product image can be primary.')
  }
  if (normalizedImages.length > 0 && primaryCount === 0) {
    normalizedImages[0].isPrimary = true
  }

  await uploadService.verifyObjectsExist(getProductImageKeys(normalizedImages))
  return normalizedImages
}

export async function withPrimaryImageReadUrls(
  uploadService: UploadService,
  products: Product[],
): Promise<Product[]> {
  return Promise.all(products.map((product) => withPrimaryImageReadUrl(uploadService, product)))
}

async function withPrimaryImageReadUrl(
  uploadService: UploadService,
  product: Product,
): Promise<Product> {
  const primaryImage = product.images?.find((image) => image.isPrimary) ?? product.images?.[0]
  if (!primaryImage) {
    return product
  }

  const [readUrl] = await uploadService.createReadUrls([primaryImage.key])
  return {
    ...product,
    images: [
      {
        ...primaryImage,
        readUrl: readUrl.readUrl,
        readUrlExpiresInSeconds: readUrl.expiresInSeconds,
      },
    ],
  }
}

export async function withAllImageReadUrls(
  uploadService: UploadService,
  product: Product,
): Promise<Product> {
  if (!product.images || product.images.length === 0) {
    return product
  }

  const readUrls = await uploadService.createReadUrls(getProductImageKeys(product.images))
  const readUrlByKey = new Map(readUrls.map((item) => [item.key, item] as const))

  return {
    ...product,
    images: product.images.map((image) => {
      const readUrl = readUrlByKey.get(image.key)
      return readUrl
        ? {
            ...image,
            readUrl: readUrl.readUrl,
            readUrlExpiresInSeconds: readUrl.expiresInSeconds,
          }
        : image
    }),
  }
}

export async function deleteRemovedProductImages(
  uploadService: UploadService,
  logger: Logger,
  previousImages: ProductImage[] | undefined,
  nextImages: ProductImage[] | undefined,
): Promise<void> {
  const nextKeys = new Set(getProductImageKeys(nextImages))
  const removedKeys = getProductImageKeys(previousImages).filter((key) => !nextKeys.has(key))

  if (removedKeys.length === 0) {
    return
  }

  try {
    await uploadService.deleteObjectsBestEffort(removedKeys)
  } catch (error) {
    logger.error(`Failed to delete removed product images for ${removedKeys.join(', ')}`, error)
  }
}
