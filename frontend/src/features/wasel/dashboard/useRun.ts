"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentApi, isTerminal, type AgentArtifact, type AgentRun, type AgentRunEvent } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";

const POLL_MS = 2000;

interface RunState {
  run?: AgentRun;
  events: AgentRunEvent[];
  artifacts: AgentArtifact[];
  error?: string;
  notFound: boolean;
}

/** Follows one agent run: polls its status and new events until it reaches a final state. */
export function useRun(runId: string) {
  const [state, setState] = useState<RunState>({ events: [], artifacts: [], notFound: false });
  const nextSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    nextSeq.current = 0;

    const tick = async () => {
      try {
        const run = await agentApi.getRun(runId);
        const fresh = await agentApi.events(runId, nextSeq.current);
        // Files appear when the agent does something; re-list them after new steps and at the end.
        const refreshFiles = isTerminal(run.status) || fresh.length > 0;
        const artifacts = refreshFiles ? await agentApi.artifacts(runId) : undefined;
        if (cancelled) return;
        if (fresh.length > 0) nextSeq.current = fresh[fresh.length - 1].seq + 1;
        setState((prev) => ({
          run,
          events: fresh.length > 0 ? [...prev.events, ...fresh] : prev.events,
          artifacts: artifacts ?? prev.artifacts,
          error: undefined,
          notFound: false,
        }));
        if (!isTerminal(run.status)) timer = setTimeout(() => void tick(), POLL_MS);
      } catch (error) {
        if (cancelled) return;
        const failure = describeApiError(error);
        if (failure.code === "not_found") {
          setState((prev) => ({ ...prev, notFound: true }));
          return;
        }
        setState((prev) => ({ ...prev, error: failure.message }));
        timer = setTimeout(() => void tick(), POLL_MS * 3);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const cancel = useCallback(async () => {
    try {
      const run = await agentApi.cancel(runId);
      setState((prev) => ({ ...prev, run }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: describeApiError(error).message }));
    }
  }, [runId]);

  const answer = useCallback(
    async (reply: string) => {
      try {
        const run = await agentApi.answer(runId, reply);
        setState((prev) => ({ ...prev, run }));
      } catch (error) {
        setState((prev) => ({ ...prev, error: describeApiError(error).message }));
      }
    },
    [runId],
  );

  return { ...state, cancel, answer };
}
