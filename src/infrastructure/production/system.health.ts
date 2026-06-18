
import { prisma } from '../../config/prisma'

export async function systemHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`

    return {
      status: 'healthy',
      db: true,
      timestamp: new Date().toISOString()
    }
  } catch (e) {
    return {
      status: 'critical',
      db: false,
      error: String(e)
    }
  }
}
