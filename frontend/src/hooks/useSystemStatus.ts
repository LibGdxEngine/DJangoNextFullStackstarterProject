import { useState, useCallback } from "react";
import { apiClient } from "@/lib/api";
import { SystemStatus, HelloResponse } from "@/types";

export function useSystemStatus() {
  const [helloData, setHelloData] = useState<HelloResponse | null>(null);
  const [helloLoading, setHelloLoading] = useState(false);
  const [helloError, setHelloError] = useState<string | null>(null);

  const [statusData, setStatusData] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [triggeringTask, setTriggeringTask] = useState(false);
  const [taskResult, setTaskResult] = useState<string | null>(null);

  const fetchHello = useCallback(async () => {
    setHelloLoading(true);
    setHelloError(null);
    try {
      const data = await apiClient<HelloResponse>("/hello/");
      setHelloData(data);
    } catch (err: unknown) {
      setHelloError(err instanceof Error ? err.message : "Failed to reach backend API");
    } finally {
      setHelloLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await apiClient<SystemStatus>("/status/");
      setStatusData(data);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to fetch system status");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const triggerCelery = useCallback(async () => {
    setTriggeringTask(true);
    setTaskResult(null);
    try {
      const data = await apiClient<SystemStatus>("/status/");
      setStatusData(data);
      if (typeof data.celery === "object" && data.celery.task_id) {
        setTaskResult(
          `Task triggered! Task ID: ${data.celery.task_id}. Worker processes task asynchronously.`
        );
      } else {
        setTaskResult("Failed to trigger Celery task.");
      }
    } catch (err: unknown) {
      setTaskResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTriggeringTask(false);
    }
  }, []);

  return {
    helloData,
    helloLoading,
    helloError,
    fetchHello,
    statusData,
    statusLoading,
    statusError,
    fetchStatus,
    triggerCelery,
    triggeringTask,
    taskResult,
  };
}
