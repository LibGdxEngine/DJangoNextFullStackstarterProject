"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";

type Schemas = components["schemas"];

export type AgentRun = Schemas["AgentRun"];
export type AgentRunEvent = Schemas["AgentRunEvent"];
export type AgentArtifact = Schemas["AgentArtifact"];
export type AgentRunStatus = Schemas["AgentRunStatusEnum"];
export type AgentLiveFrame = Schemas["AgentLiveFrame"];
export type AgentLive = Schemas["AgentLive"];
export type AgentControlState = Schemas["AgentControlState"];
export type AgentInputEvent = Schemas["AgentInputEventRequest"];
export type AgentRole = Schemas["AgentRole"];
export type AgentRoleSummary = Schemas["AgentRoleSummary"];
export type TaskTemplate = Schemas["TaskTemplate"];

const BASE = "/product/browser_agent/runs";
const ROLES = "/product/browser_agent/roles";

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
  /** Who drives the browser, plus its newest frame if it is newer than `after`. */
  live: (id: string, after?: number) =>
    apiClient.get<AgentLive>(`${BASE}/${encodeURIComponent(id)}/live/`, { query: { after } }),
  /** Take the browser over from the agent, or hand it back. */
  control: (id: string, action: Schemas["AgentControlActionEnum"]) =>
    apiClient.post<AgentControlState>(`${BASE}/${encodeURIComponent(id)}/control/`, { action }),
  sendInput: (id: string, events: AgentInputEvent[]) =>
    apiClient.post<void>(`${BASE}/${encodeURIComponent(id)}/input/`, { events }),
  /** Built-in roles plus the organization's own, with how many runs each has active. */
  listRoles: (organization?: string) => apiClient.get<AgentRole[]>(`${ROLES}/`, { query: { organization } }),
  createRole: (body: Schemas["AgentRoleRequest"]) => apiClient.post<AgentRole>(`${ROLES}/`, body),
  deleteRole: (id: string) => apiClient.delete<void>(`${ROLES}/${encodeURIComponent(id)}/`),
  listTaskTemplates: (organization?: string) =>
    apiClient.get<TaskTemplate[]>("/product/browser_agent/task-templates/", { query: { organization } }),
};
