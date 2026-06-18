
import { systemHealth } from '@/src/infrastructure/production/system.health'

export async function GET() {
  const health = await systemHealth()
  return Response.json(health)
}
