"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";

type Schemas = components["schemas"];

export type AgentRun = Schemas["AgentRun"];
export type AgentRunEvent = Schemas["AgentRunEvent"];
export type AgentArtifact = Schemas["AgentArtifact"];
export type AgentRunStatus = Schemas["AgentRunStatusEnum"];

const BASE = "/product/browser_agent/runs";

export const TERMINAL_STATUSES: readonly AgentRunStatus[] = ["succeeded", "failed", "cancelled", "timeout"];

export function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const agentApi = {
  createRun: (body: Schemas["AgentRunRequest"]) => apiClient.post<AgentRun>(`${BASE}/`, body),
  listRuns: (organization?: string) =>
    apiClient.get<AgentRun[]>(`${BASE}/`, { query: { organization } }),
  getRun: (id: string) => apiClient.get<AgentRun>(`${BASE}/${encodeURIComponent(id)}/`),
  events: (id: string, after?: number) =>
    apiClient.get<AgentRunEvent[]>(`${BASE}/${encodeURIComponent(id)}/events/`, { query: { after } }),
  cancel: (id: string) => apiClient.post<AgentRun>(`${BASE}/${encodeURIComponent(id)}/cancel/`),
  artifacts: (id: string) =>
    apiClient.get<AgentArtifact[]>(`${BASE}/${encodeURIComponent(id)}/artifacts/`),
};
