type CloudFrontFunctionEvent = {
  request: {
    uri?: string
  }
}

function handler(event: CloudFrontFunctionEvent): CloudFrontFunctionEvent['request'] {
  const request = event.request
  const originalUri = request.uri || '/'
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const productDetailPattern =
    /^\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // Phục vụ SEO cho Product Detail Page

  // Trang root của static export luôn map trực tiếp tới index.html trong S3
  if (originalUri === '/') {
    request.uri = '/index.html'
  } else if (
    // Bỏ qua asset, file có extension, hoặc URI đã được rewrite sẵn
    originalUri.startsWith('/_next/') ||
    originalUri.includes('.') ||
    originalUri.endsWith('/index.html')
  ) {
    request.uri = originalUri
  } else {
    // Chuẩn hóa trailing slash để mọi route đều resolve về cùng một object key
    // Ví dụ:
    //    + originalUri = /products/1234/ => normalized = "/products/1234"
    //    + originalUri = /products/ => normalized = "/products"
    const normalized =
      originalUri.endsWith('/') && originalUri.length > 1 ? originalUri.slice(0, -1) : originalUri

    // Trường hợp đặc biệt
    if (
      // 1. Product Detail Page => Cần SEO
      productDetailPattern.test(normalized) ||
      // 2. "payment-return" là static route thật, không phải order_id
      normalized === '/orders/payment-return'
    ) {
      request.uri = `${normalized}/index.html`
    } else {
      // Tất cả những dynamic routes có chứa UUID trong URI như: /admin/orders/[id], /admin/products/[id]/edit, /admin/users/[id]/access,...
      // => replace chuỗi UUID bằng chuỗi "__fallback" để CloudFront get đúng pre-rendered HTML từ S3
      // => Không cần nhiều câu lệnh if else để rewrite từng dynamic route riêng lẻ, chỉ cần check UUID pattern và replace là đủ
      const rewritten = normalized
        .split('/')
        .map((segment) => (uuidPattern.test(segment) ? '__fallback' : segment))
        .join('/')

      request.uri = `${rewritten}/index.html`
    }
  }

  if (originalUri !== request.uri) {
    console.log(`[CloudFront Rewrite Function] ${originalUri} -> ${request.uri}`)
  }

  return request
}
