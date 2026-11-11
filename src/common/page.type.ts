export interface Page<T> {
  items: T[]
  lastEvaluatedKey?: Record<string, unknown>
}
