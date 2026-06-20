
export function tenantGuard(req: any) {
  const user = req.user

  if (!user?.organizationId) {
    throw new Error('NO_ORGANIZATION')
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role
  }
}
