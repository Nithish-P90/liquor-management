import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { API_ROUTES } from "@/lib/api/routes"

const appApiRoot = join(process.cwd(), "app/api")

function routePathFromFile(file: string): string {
  return `/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`
}

function exportedMethods(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), "utf8")
  const directExports = Array.from(
    source.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|DELETE)\b/g),
    (match) => match[1],
  )
  const aliasedExports = Array.from(
    source.matchAll(/handler\s+as\s+(GET|POST|PATCH|DELETE)\b/g),
    (match) => match[1],
  )

  return Array.from(new Set([...directExports, ...aliasedExports])).sort()
}

function findRouteFiles(dir: string, prefix = "app/api"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    const filePath = `${prefix}/${entry.name}`

    if (entry.isDirectory()) {
      return findRouteFiles(fullPath, filePath)
    }

    return entry.isFile() && entry.name === "route.ts" ? [filePath] : []
  })
}

describe("API route registry", () => {
  it("documents every route file exactly once", () => {
    const registeredFiles = API_ROUTES.map((route) => route.file).sort()
    const actualFiles = findRouteFiles(appApiRoot).sort()

    expect(registeredFiles).toEqual(actualFiles)
  })

  it("keeps paths and HTTP methods aligned with route files", () => {
    for (const route of API_ROUTES) {
      expect(route.path).toBe(routePathFromFile(route.file))
      expect([...route.methods].sort()).toEqual(exportedMethods(route.file))
    }
  })

  it("keeps route identifiers unique", () => {
    const ids = API_ROUTES.map((route) => route.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
