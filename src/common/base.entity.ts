export abstract class BaseEntity<Props extends object> {
  declare readonly createdAt: string
  declare readonly updatedAt: string
  declare readonly lastModifiedByType: string
  declare readonly lastModifiedById: string
  declare readonly lastModifiedByEmail: string
  declare readonly lastModifiedReason: string

  protected with(changes: Partial<Props>): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this
    return Object.assign(clone, this, changes)
  }
}
