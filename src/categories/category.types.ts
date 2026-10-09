export interface Category {
  categoryId: string
  name: string
  description?: string
  status: 'ACTIVE' | 'DELETED'
  deletedAt?: string
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
  createdAt: string
  updatedAt: string
}
