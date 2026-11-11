/**
 * Migrates existing DynamoDB tables from entity-specific PKs to standardized `id`.
 *
 * Usage:
 *   Phase 1 — run BEFORE infra:deploy:
 *     npx ts-node -r tsconfig-paths/register src/scripts/migrate-pk-to-id.ts --phase export
 *
 *   Then deploy:
 *     AWS_PROFILE=loc AWS_REGION=ap-southeast-1 npm run infra:deploy
 *
 *   Phase 2 — run AFTER infra:deploy:
 *     npx ts-node -r tsconfig-paths/register src/scripts/migrate-pk-to-id.ts --phase import
 */

import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import * as fs from 'fs'
import * as path from 'path'
import { exitWithError, getScriptContext } from './script-helpers'

const BACKUP_DIR = path.resolve(__dirname, '../../migration-backup')
const BATCH_SIZE = 25

type TableMigration = {
  envKey: keyof ReturnType<typeof getScriptContext>['runtimeEnv']
  backupFile: string
  renameKey: (item: Record<string, unknown>) => Record<string, unknown>
}

const MIGRATIONS: TableMigration[] = [
  {
    envKey: 'ORDERS_TABLE',
    backupFile: 'orders.json',
    renameKey: (item) => renameAttr(item, 'orderId', 'id'),
  },
  {
    envKey: 'PRODUCTS_TABLE',
    backupFile: 'products.json',
    renameKey: (item) => renameAttr(item, 'productId', 'id'),
  },
  {
    envKey: 'CATEGORIES_TABLE',
    backupFile: 'categories.json',
    renameKey: (item) => renameAttr(item, 'categoryId', 'id'),
  },
  {
    envKey: 'CARTS_TABLE',
    backupFile: 'carts.json',
    renameKey: (item) => renameAttr(item, 'cartId', 'id'),
  },
  {
    envKey: 'INVENTORY_TABLE',
    backupFile: 'inventory.json',
    renameKey: (item) => renameAttr(item, 'productId', 'id'),
  },
]

function renameAttr(
  item: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  if (!(from in item)) return item
  const { [from]: value, ...rest } = item
  return { [to]: value, ...rest }
}

function readPhaseFlag(): 'export' | 'import' {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--phase')
  const value = idx !== -1 ? args[idx + 1] : undefined
  if (value === 'export' || value === 'import') return value
  throw new Error('Usage: --phase export  OR  --phase import')
}

async function scanAll(
  documentClient: ReturnType<typeof getScriptContext>['documentClient'],
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const response = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    items.push(...((response.Items ?? []) as Record<string, unknown>[]))
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)

  return items
}

async function batchWrite(
  documentClient: ReturnType<typeof getScriptContext>['documentClient'],
  tableName: string,
  items: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    await documentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
        },
      }),
    )
  }
}

async function runExport(): Promise<void> {
  const { documentClient, runtimeEnv } = getScriptContext()

  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  console.log(`Exporting to: ${BACKUP_DIR}`)

  for (const migration of MIGRATIONS) {
    const tableName = runtimeEnv[migration.envKey] as string
    console.log(`  Scanning ${tableName}...`)
    const items = await scanAll(documentClient, tableName)
    fs.writeFileSync(
      path.join(BACKUP_DIR, migration.backupFile),
      JSON.stringify(items, null, 2),
      'utf8',
    )
    console.log(`  Saved ${items.length} items → ${migration.backupFile}`)
  }

  console.log('\nExport complete. Now run infra:deploy, then run --phase import.')
}

async function runImport(): Promise<void> {
  const { documentClient, runtimeEnv } = getScriptContext()

  if (!fs.existsSync(BACKUP_DIR)) {
    throw new Error(`Backup directory not found: ${BACKUP_DIR}. Run --phase export first.`)
  }

  for (const migration of MIGRATIONS) {
    const tableName = runtimeEnv[migration.envKey] as string
    const backupPath = path.join(BACKUP_DIR, migration.backupFile)

    if (!fs.existsSync(backupPath)) {
      console.warn(`  Skipping ${tableName}: backup file not found (${migration.backupFile})`)
      continue
    }

    const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as Record<string, unknown>[]
    const transformed = raw.map(migration.renameKey)

    console.log(`  Writing ${transformed.length} items → ${tableName}...`)
    await batchWrite(documentClient, tableName, transformed)
    console.log(`  Done.`)
  }

  console.log('\nImport complete.')
}

async function main(): Promise<void> {
  const phase = readPhaseFlag()

  if (phase === 'export') {
    await runExport()
  } else {
    await runImport()
  }
}

main().catch(exitWithError)
