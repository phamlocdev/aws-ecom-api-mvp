export function buildPaymentOrderInfo(orderId: string): string {
  return `Thanh toan don hang ${orderId}`
}

export function buildAutoRefundReason(orderId: string): string {
  return `Hoan tien tu dong cho don hang ${orderId} do het han giu hang`
}
