import { Order } from './order.entity'

// Pure business rules shared by several order use-cases. Kept in domain/
// because they only depend on the Order entity, not on Nest/AWS SDK.

export function toEpochSeconds(timestampMs: number): number {
  return Math.floor(timestampMs / 1000)
}

export function isOrderPaymentExpired(order: Order): boolean {
  return Boolean(order.paymentExpiresAt && order.paymentExpiresAt <= toEpochSeconds(Date.now()))
}

export function normalizeAdditionalReceivingEmails(emails: string[] | undefined): string[] | undefined {
  if (!emails) {
    return undefined
  }

  const normalizedEmails = Array.from(
    new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0)),
  )

  return normalizedEmails.length > 0 ? normalizedEmails : undefined
}

export function normalizeEmail(email: string | undefined): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase()
  return normalizedEmail || undefined
}

export function aggregateReservedQuantities<T extends { productId: string; quantity: number }>(
  items: T[],
): Array<{ productId: string; quantity: number }> {
  const quantityByProductId = new Map<string, number>()

  for (const item of items) {
    quantityByProductId.set(
      item.productId,
      (quantityByProductId.get(item.productId) ?? 0) + item.quantity,
    )
  }

  return [...quantityByProductId.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }))
}
