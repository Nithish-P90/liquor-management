import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig, Pool } from '@neondatabase/serverless'

function createPrismaClient() {
  // Use WebSocket for Cloudflare Workers edge runtime
  if (typeof WebSocket !== 'undefined') {
    neonConfig.webSocketConstructor = WebSocket
  }
  // Fallback URL prevents build-time crash; runtime always has DATABASE_URL set
  const connectionString = process.env.DATABASE_URL || 'postgresql://build:build@localhost/build'
  const pool = new Pool({ connectionString })
  const adapter = new PrismaNeon(pool)
  return new PrismaClient({ adapter, log: ['error'] } as any)
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
