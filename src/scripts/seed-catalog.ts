import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { buildSeedCategories, buildSeedProducts, getInventoryQuantity } from './catalog-seed-data'
import { exitWithError, getScriptContext, nowIso } from './script-helpers'

export async function seedCatalog(): Promise<void> {
  const { documentClient, runtimeEnv } = getScriptContext()
  const timestamp = nowIso()
  const categories = buildSeedCategories()
  const products = buildSeedProducts()

  for (const category of categories) {
    await documentClient.send(
      new PutCommand({
        TableName: runtimeEnv.CATEGORIES_TABLE,
        Item: {
          id: category.categoryId,
          name: category.name,
          description: category.description,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }),
    )
  }

  for (const [index, product] of products.entries()) {
    await documentClient.send(
      new PutCommand({
        TableName: runtimeEnv.PRODUCTS_TABLE,
        Item: {
          id: product.productId,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          price: product.price,
          currency: product.currency,
          status: product.status,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }),
    )

    await documentClient.send(
      new PutCommand({
        TableName: runtimeEnv.INVENTORY_TABLE,
        Item: {
          productId: product.productId,
          availableQuantity: getInventoryQuantity(index),
          reservedQuantity: 0,
          updatedAt: timestamp,
        },
      }),
    )
  }

  console.log(
    `Seeded catalog successfully: categories=${categories.length}, products=${products.length}, inventories=${products.length}.`,
  )
}

async function main(): Promise<void> {
  await seedCatalog()
}

if (require.main === module) {
  void main().catch(exitWithError)
}
