/**
 * Hardcoded admin allowlist — this app has no role system, so "admin" is
 * just an email list checked client-side (UI gating) and mirrored in
 * firestore.rules (actual enforcement). Add/remove emails here as needed.
 */
export const ADMIN_EMAILS = ["tanawat.han@gunkul.com"];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
