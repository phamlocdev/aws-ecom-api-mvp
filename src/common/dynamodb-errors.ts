export function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}

export function isTransactionCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'TransactionCanceledException'
  )
}
