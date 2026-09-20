/**
 * Bootstrap admins. These emails are always allowed in and always admin, even
 * if the `allowedUsers` list is empty or damaged — so the team can never lock
 * itself out. Everyone else is managed on the "จัดการผู้ใช้" page (admin only),
 * which writes `allowedUsers/{email}` docs.
 *
 * Keep in sync with `isBootstrapAdmin()` in firestore.rules (the real enforcement).
 */
export const BOOTSTRAP_ADMIN_EMAILS = ["tanawat.han@gunkul.com"];

export function isBootstrapAdmin(email: string | null | undefined): boolean {
  return !!email && BOOTSTRAP_ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Firestore doc id for an allowlist entry: the lower-cased email. */
export function allowlistId(email: string): string {
  return email.trim().toLowerCase();
}
