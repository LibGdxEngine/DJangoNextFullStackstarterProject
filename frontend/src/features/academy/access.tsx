"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Capability, Role } from "./types";

/** Mirrors CAPABILITIES in backend/product/academy/access.py. */
export const CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  admin: new Set(["manage_people", "manage_schedule", "report_lesson", "approve_session", "view_finance", "manage_finance", "manage_settings", "manage_roles", "view_internal", "import", "reports"]),
  coordinator: new Set(["manage_people", "manage_schedule", "report_lesson", "approve_session", "view_internal", "import", "reports"]),
  accountant: new Set(["view_finance", "manage_finance", "reports"]),
  teacher: new Set(["report_lesson", "view_internal", "own_earnings"]),
  family: new Set(["request_change", "submit_payment"]),
};

export const MANAGEMENT_ROLES: Role[] = ["admin", "coordinator", "accountant"];

const ROLE_STORAGE_KEY = "academy_demo_role";

interface AccessValue {
  userName: string;
  role: Role;
  setRole: (role: Role) => void;
  can: (capability: Capability) => boolean;
}

const AccessContext = createContext<AccessValue | null>(null);

/**
 * Current staff member and role. The role switch exists so reviewers can see
 * locked and permission-denied states; real roles will come from the API.
 */
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("admin");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the demo role after mount.
      if (stored && stored in CAPABILITIES) setRoleState(stored as Role);
    } catch {
      // Storage unavailable: keep the default role.
    }
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the role still applies for this visit.
    }
  }, []);

  const value = useMemo<AccessValue>(() => ({
    userName: "Sara Mostafa",
    role,
    setRole,
    can: (capability) => CAPABILITIES[role].has(capability),
  }), [role, setRole]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error("useAccess must be used inside AccessProvider.");
  return value;
}
