"use client";

import { useCallback, useEffect, useState } from "react";
import { agentApi, type AgentRole, type AgentRoleSummary } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";
import { useWorkspace } from "./workspace";

/** Shown for runs that were not given a role. */
export const DEFAULT_ROLE: AgentRoleSummary = {
  id: "",
  name: "واصل",
  title: "مساعدك",
  avatar: "/agents/team.png",
  tint: "#F2F0F8",
};

type Loaded<T> = { data?: T[]; error?: string; reload: () => void };

/** Loads a list for the current workspace once it is ready; `reload` fetches it again. */
function useWorkspaceList<T>(load: (organization: string) => Promise<T[]>): Loaded<T> {
  const workspace = useWorkspace();
  const organization = workspace.status === "ready" ? workspace.organization.id : undefined;
  const [state, setState] = useState<{ data?: T[]; error?: string }>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    load(organization).then(
      (data) => !cancelled && setState({ data }),
      (err) => !cancelled && setState({ error: describeApiError(err).message })
    );
    return () => {
      cancelled = true;
    };
  }, [organization, load, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

export function useRoles(): Loaded<AgentRole> {
  return useWorkspaceList(agentApi.listRoles);
}

export function useTaskTemplates() {
  return useWorkspaceList(agentApi.listTaskTemplates);
}
