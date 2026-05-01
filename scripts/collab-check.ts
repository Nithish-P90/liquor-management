import { execSync } from "node:child_process"

type Bucket =
  | "ui-pos"
  | "ui-other"
  | "api"
  | "domain-billing"
  | "domain-inventory"
  | "domain-other"
  | "platform"
  | "prisma"
  | "docs"
  | "infra"
  | "other"

const ROOT_FACADE_PATTERN = /^lib\/(?!domains\/|platform\/|api\/)[^/]+\.ts$/
const ROOT_EDIT_ALLOWLIST = new Set([
  "lib/domain-modules.ts",
  "lib/api/routes.ts",
])

function getChangedFiles(): string[] {
  return execSync("git diff --name-only --cached", { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function bucketOf(file: string): Bucket {
  if (file.startsWith("app/(app)/pos/")) return "ui-pos"
  if (file.startsWith("app/(app)/")) return "ui-other"
  if (file.startsWith("app/api/")) return "api"
  if (file.startsWith("lib/domains/billing/")) return "domain-billing"
  if (file.startsWith("lib/domains/inventory/")) return "domain-inventory"
  if (file.startsWith("lib/domains/")) return "domain-other"
  if (file.startsWith("lib/platform/")) return "platform"
  if (file.startsWith("prisma/")) return "prisma"
  if (file.startsWith("docs/") || file === "AGENTS.md" || file === "AGENT.md" || file === "agent.md") return "docs"
  if (file.startsWith(".github/") || file.startsWith("scripts/") || file === "package.json") return "infra"
  return "other"
}

function fail(message: string): never {
  console.error(`collab-check: ${message}`)
  process.exit(1)
}

const changed = getChangedFiles()

if (changed.length === 0) {
  console.log("collab-check: no staged files detected; stage a focused change set before running this gate")
  process.exit(0)
}

const rootFacadeEdits = changed.filter(
  (file) => ROOT_FACADE_PATTERN.test(file) && !ROOT_EDIT_ALLOWLIST.has(file),
)
if (rootFacadeEdits.length > 0) {
  fail(
    `root facade files changed (${rootFacadeEdits.join(", ")}). Edit canonical files in lib/domains/* or lib/platform/* instead.`,
  )
}

const buckets = new Set(changed.map(bucketOf))
const behavioralBuckets = Array.from(buckets).filter((bucket) =>
  ["ui-pos", "ui-other", "api", "domain-billing", "domain-inventory", "domain-other", "platform", "prisma"].includes(bucket),
)

const allowCrossDomain = process.env.COLLAB_ALLOW_CROSS === "1"
if (!allowCrossDomain && behavioralBuckets.length > 2) {
  fail(
    `too many behavioral buckets touched (${behavioralBuckets.join(", ")}). Split into smaller PRs or rerun with COLLAB_ALLOW_CROSS=1 and explicit rationale.`,
  )
}

const touchesPrismaSchema = changed.includes("prisma/schema.prisma")
const touchesUI = changed.some((file) => file.startsWith("app/(app)/"))
if (touchesPrismaSchema && touchesUI && !allowCrossDomain) {
  fail("prisma schema and UI changed together. Split migration/data work from UI work.")
}

const highRiskTouched = changed.filter((file) =>
  [
    "lib/domains/billing/",
    "lib/domains/inventory/",
    "lib/platform/",
    "prisma/schema.prisma",
    "app/api/cron/",
    "app/api/face/",
  ].some((prefix) => file.startsWith(prefix) || file === prefix),
)

console.log("collab-check: changed files =", changed.length)
console.log("collab-check: buckets =", Array.from(buckets).join(", "))
if (highRiskTouched.length > 0) {
  console.log("collab-check: high-risk paths touched:")
  for (const file of highRiskTouched) {
    console.log(`- ${file}`)
  }
}
console.log("collab-check: pass")
