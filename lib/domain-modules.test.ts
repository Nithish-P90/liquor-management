import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { DOMAIN_MODULES, FACADE_MODULES } from "@/lib/domain-modules"

const libRoot = join(process.cwd(), "lib")

function findProductionLibFiles(dir: string, prefix = "lib"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    const filePath = `${prefix}/${entry.name}`

    if (entry.isDirectory()) {
      return findProductionLibFiles(fullPath, filePath)
    }

    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      return []
    }

    if (entry.name.endsWith(".test.ts")) {
      return []
    }

    return [filePath]
  })
}

describe("domain module ownership", () => {
  it("points to files that exist", () => {
    for (const domain of DOMAIN_MODULES) {
      for (const file of domain.files) {
        expect(existsSync(join(process.cwd(), file)), `${file} is listed by ${domain.domain}`).toBe(true)
      }
    }
  })

  it("indexes every production lib file", () => {
    const indexedFiles = [...DOMAIN_MODULES.flatMap((domain) => domain.files), ...FACADE_MODULES].sort()
    const actualFiles = findProductionLibFiles(libRoot).sort()

    expect(indexedFiles).toEqual(actualFiles)
  })

  it("does not assign one file to multiple domains", () => {
    const indexedFiles = DOMAIN_MODULES.flatMap((domain) => domain.files)
    expect(new Set(indexedFiles).size).toBe(indexedFiles.length)
  })

  it("keeps legacy root modules as re-export facades only", () => {
    for (const file of FACADE_MODULES) {
      const source = readFileSync(join(process.cwd(), file), "utf8").trim()
      expect(source, `${file} should only re-export its canonical domain module`).toMatch(/^export \* from "@\/lib\//)
    }
  })
})
