"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { organizationsApi, type Organization } from "@/lib/api/organizations";
import { describeApiError } from "@/lib/api/errors";

type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; organization: Organization };

const WorkspaceContext = createContext<WorkspaceState>({ status: "loading" });

function personalWorkspaceSlug(): string {
  return `ws-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Agent runs belong to an organization. Use the user's first one, or create a personal
 * workspace the first time they open the dashboard.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await organizationsApi.list();
        const organization =
          existing.find((org) => org.is_active !== false) ??
          (await organizationsApi.create({ name: "مساحة عملي", slug: personalWorkspaceSlug() }));
        if (!cancelled) setState({ status: "ready", organization });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: describeApiError(error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  return useContext(WorkspaceContext);
}
