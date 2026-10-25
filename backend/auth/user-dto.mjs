export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
}

export function toUserDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  }
}
