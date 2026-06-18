
const store = new Map()

export function rateLimit(userId: string, limit = 20) {
  const now = Date.now()
  const window = 60 * 1000

  const data = store.get(userId) || { count: 0, start: now }

  if (now - data.start > window) {
    data.count = 0
    data.start = now
  }

  data.count++

  store.set(userId, data)

  if (data.count > limit) {
    throw new Error('RATE_LIMIT_EXCEEDED')
  }

  return true
}
