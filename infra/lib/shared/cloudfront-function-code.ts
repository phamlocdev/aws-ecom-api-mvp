import * as fs from 'fs'
import { transformSync } from 'esbuild'

export function buildCloudFrontFunctionCode(entryPath: string): string {
  const source = fs.readFileSync(entryPath, 'utf8')
  const result = transformSync(source, {
    loader: 'ts',
    target: 'es2020',
    minify: true,
  })

  return result.code
}
