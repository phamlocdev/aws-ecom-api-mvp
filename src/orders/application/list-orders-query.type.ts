import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { OrderStatus } from '../domain/order-status.enum'

// Use-case input for listing orders: pagination fields plus the same filters
// as OrderListFilter (kept separate from the HTTP-layer ListOrdersQueryDto so
// the application layer never depends on presentation/).
export type ListOrdersQuery = PaginationQueryDto & {
  status?: OrderStatus
  customerId?: string
  customerEmail?: string
}
