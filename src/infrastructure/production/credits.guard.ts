
import { prisma } from '../../config/prisma'

export async function creditsGuard(userId: string, cost: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } })

  if (!user) throw new Error('USER_NOT_FOUND')

  if (user.credits < cost) {
    throw new Error('INSUFFICIENT_CREDITS')
  }

  await prisma.user.update({
    where: { id: userId },
    data: { credits: { decrement: cost } }
  })

  return true
}
