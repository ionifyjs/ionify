import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createResolver, ResolverOptions, ResolveContext } from '../src/core/plugins/resolver'
import type { IonifyPlugin } from '../src/types/plugin'
import path from 'path'
import fs from 'fs'
import { mkdir, writeFile, rm } from 'fs/promises'

type ResolverPlugin = IonifyPlugin & {
  onLoad: (file: string, context?: ResolveContext) => Promise<{ path: string } | null>
}

const TEST_DIR = path.join(process.cwd(), '__resolver_test__')

async function createTestFile(filePath: string, content: string = '') {
  const fullPath = path.join(TEST_DIR, filePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
  return fullPath
}

describe('Resolver Plugin', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
    process.chdir(TEST_DIR)
  })

  afterEach(async () => {
    process.chdir(path.dirname(TEST_DIR))
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('should resolve src-relative paths correctly', async () => {
    // Create test files
    await createTestFile('src/Shared/Hooks/useConfiguration.ts')
    await createTestFile('src/Shared/Lib/logger.ts')

    const resolver = createResolver() as ResolverPlugin

    // Test src-relative resolution
    const result1 = await resolver.onLoad('src/Shared/Hooks/useConfiguration')
    const result2 = await resolver.onLoad('src/Shared/Lib/logger')

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.ts')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.ts')
    )
  })

  it('should resolve index files in directories', async () => {
    await createTestFile('src/Shared/Hooks/useConfiguration/index.ts')
    await createTestFile('src/Shared/Lib/logger/index.ts')

    const resolver = createResolver() as ResolverPlugin

    const result1 = await resolver.onLoad('src/Shared/Hooks/useConfiguration')
    const result2 = await resolver.onLoad('src/Shared/Lib/logger')

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration/index.ts')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger/index.ts')
    )
  })

  it('should resolve files with different extensions', async () => {
    await createTestFile('src/Shared/Hooks/useConfiguration.tsx')
    await createTestFile('src/Shared/Lib/logger.js')

    const resolver = createResolver() as ResolverPlugin

    const result1 = await resolver.onLoad('src/Shared/Hooks/useConfiguration')
    const result2 = await resolver.onLoad('src/Shared/Lib/logger')

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.tsx')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.js')
    )
  })

  it('should resolve relative paths from different base directories', async () => {
    await createTestFile('src/Shared/Hooks/useConfiguration.ts')
    await createTestFile('src/Shared/Lib/logger.ts')

    const resolver = createResolver() as ResolverPlugin

    // Test relative path resolution from different contexts
    const result1 = await resolver.onLoad('./Shared/Hooks/useConfiguration', {
      baseDir: path.join(TEST_DIR, 'src')
    })
    const result2 = await resolver.onLoad('./Lib/logger', {
      baseDir: path.join(TEST_DIR, 'src/Shared')
    })

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.ts')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.ts')
    )
  })

  it('should resolve aliases from tsconfig.json', async () => {
    // Create tsconfig.json with path aliases
    await createTestFile('tsconfig.json', JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@@/*": ["*"]
        }
      }
    }))

    await createTestFile('src/Shared/Hooks/useConfiguration.ts')
    await createTestFile('src/Shared/Lib/logger.ts')

    const resolver = createResolver({ tsconfig: true }) as ResolverPlugin

    const result1 = await resolver.onLoad('@/Shared/Hooks/useConfiguration')
    const result2 = await resolver.onLoad('@@/src/Shared/Lib/logger')

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.ts')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.ts')
    )
  })

  it('should resolve Shared directory imports', async () => {
    await createTestFile('src/Shared/Hooks/useConfiguration.ts')
    await createTestFile('src/Shared/Lib/logger.tsx')

    const resolver = createResolver() as ResolverPlugin

    const result1 = await resolver.onLoad('src/Shared/Hooks/useConfiguration')
    const result2 = await resolver.onLoad('src/Shared/Lib/logger')
    const result3 = await resolver.onLoad('./Shared/Hooks/useConfiguration', {
      baseDir: path.join(TEST_DIR, 'src')
    })
    const result4 = await resolver.onLoad('./Lib/logger', {
      baseDir: path.join(TEST_DIR, 'src/Shared')
    })

    expect(result1?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.ts')
    )
    expect(result2?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.tsx')
    )
    expect(result3?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Hooks/useConfiguration.ts')
    )
    expect(result4?.path).toEqual(
      path.join(TEST_DIR, 'src/Shared/Lib/logger.tsx')
    )
  })
})