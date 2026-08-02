export function canTriggerSync(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin"
}
