export type ProductSeoImage = {
  key: string
  sortOrder?: number
  isPrimary?: boolean
}

export type ProductSeoData = {
  productId: string
  name: string
  description: string
  categoryId: string
  price: number
  currency: string
  images?: ProductSeoImage[]
  status: string
}

export type RenderProductSeoHtmlOptions = {
  clientBaseUrl: string
  mediaPublicBaseUrl?: string
}

export function renderProductSeoHtml(
  template: string,
  product: ProductSeoData,
  options: RenderProductSeoHtmlOptions,
): string {
  const clientBaseUrl = options.clientBaseUrl.replace(/\/$/, '')
  const mediaPublicBaseUrl = options.mediaPublicBaseUrl?.replace(/\/$/, '')
  const productUrl = `${clientBaseUrl}/products/${encodeURIComponent(product.productId)}`
  const title = `${product.name} | DynamoDB MVP Storefront`
  const description = product.description || `${product.name} product details.`
  const publicImageUrl = getProductSeoImageUrl(product, mediaPublicBaseUrl)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    sku: product.productId,
    category: product.categoryId,
    ...(publicImageUrl ? { image: [publicImageUrl] } : {}),
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency || 'VND',
      availability:
        product.status === 'ACTIVE'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      url: productUrl,
    },
  }

  const seoHead = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeAttribute(description)}">`,
    `<link rel="canonical" href="${escapeAttribute(productUrl)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:title" content="${escapeAttribute(product.name)}">`,
    `<meta property="og:description" content="${escapeAttribute(description)}">`,
    `<meta property="og:url" content="${escapeAttribute(productUrl)}">`,
    publicImageUrl ? `<meta property="og:image" content="${escapeAttribute(publicImageUrl)}">` : '',
    `<meta name="twitter:card" content="${publicImageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeAttribute(product.name)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(description)}">`,
    publicImageUrl
      ? `<meta name="twitter:image" content="${escapeAttribute(publicImageUrl)}">`
      : '',
    `<script id="product-json-ld" type="application/ld+json">${escapeScriptJson(jsonLd)}</script>`,
  ]
    .filter(Boolean)
    .join('')

  const fallbackBody = [
    '<noscript>',
    '<main>',
    `<h1>${escapeHtml(product.name)}</h1>`,
    `<p>${escapeHtml(description)}</p>`,
    `<p>${escapeHtml(formatPrice(product.price, product.currency))}</p>`,
    '</main>',
    '</noscript>',
  ].join('')

  return template
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, '')
    .replace(/<script\s+id=["']product-json-ld["'][\s\S]*?<\/script>/gi, '')
    .replace('</head>', `${seoHead}</head>`)
    .replace(/<body([^>]*)>/i, `<body$1>${fallbackBody}`)
}

export function getProductSeoImageUrl(
  product: ProductSeoData,
  mediaPublicBaseUrl: string | undefined,
): string | undefined {
  if (!mediaPublicBaseUrl) {
    return undefined
  }

  const primaryImage = getPrimaryProductImage(product.images)
  if (!primaryImage) {
    return undefined
  }

  return `${mediaPublicBaseUrl.replace(/\/$/, '')}/${primaryImage.key.replace(/^\/+/, '')}`
}

function getPrimaryProductImage(images: ProductSeoImage[] | undefined): ProductSeoImage | undefined {
  if (!images || images.length === 0) {
    return undefined
  }

  const explicitPrimary = images.find((image) => image.isPrimary === true)
  if (explicitPrimary) {
    return explicitPrimary
  }

  return (
    [...images].sort(
      (left, right) =>
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER),
    )[0] ?? images[0]
  )
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency || 'VND',
  }).format(price)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
