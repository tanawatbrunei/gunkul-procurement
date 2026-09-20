import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { isBootstrapAdmin, allowlistId } from "./config/admins";

/**
 * Whether the signed-in user may use the app.
 *  unverified → email not verified yet (Firestore rules require it)
 *  denied     → verified, but the email is not on the allowlist
 *  allowed    → on the allowlist (or a bootstrap admin)
 * The client check is for UX only; firestore.rules is what actually blocks data.
 */
export type AccessState =
  | { status: "checking" }
  | { status: "unverified" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "allowed"; isAdmin: boolean };

export function useAccessCheck(user: User | null, refreshKey: number): AccessState {
  const [state, setState] = useState<AccessState>({ status: "checking" });

  useEffect(() => {
    let alive = true;
    const set = (s: AccessState) => { if (alive) setState(s); };
    if (!user) { set({ status: "checking" }); return; }
    if (!user.emailVerified) { set({ status: "unverified" }); return; }
    const email = user.email ?? "";
    if (isBootstrapAdmin(email)) { set({ status: "allowed", isAdmin: true }); return; }

    set({ status: "checking" });
    getDoc(doc(db, "allowedUsers", allowlistId(email)))
      .then((snap) => {
        if (!snap.exists()) set({ status: "denied" });
        else set({ status: "allowed", isAdmin: snap.data().role === "admin" });
      })
      .catch((err: { code?: string; message?: string }) => {
        // permission-denied on your own doc = rules already closed and you're not listed.
        if (err.code === "permission-denied") set({ status: "denied" });
        else set({ status: "error", message: err.message ?? String(err) });
      });
    return () => { alive = false; };
  }, [user, refreshKey]);

  return state;
}

const AccessContext = createContext<{ isAdmin: boolean }>({ isAdmin: false });
export const AccessProvider = AccessContext.Provider;
export const useAccess = () => useContext(AccessContext);
