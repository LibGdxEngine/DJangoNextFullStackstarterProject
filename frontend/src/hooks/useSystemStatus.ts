import { useState, useCallback } from "react";
import { systemApi } from "@/lib/api/system";
import { SystemStatus, HelloResponse } from "@/types";

export function useSystemStatus() {
  const [helloData, setHelloData] = useState<HelloResponse | null>(null);
  const [helloLoading, setHelloLoading] = useState(false);
  const [helloError, setHelloError] = useState<string | null>(null);

  const [statusData, setStatusData] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [checkingBackground, setCheckingBackground] = useState(false);
  const [backgroundResult, setBackgroundResult] = useState<string | null>(null);

  const fetchHello = useCallback(async () => {
    setHelloLoading(true);
    setHelloError(null);
    try {
      const data = await systemApi.hello();
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
      const data = await systemApi.status();
      setStatusData(data);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to fetch system status");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const checkBackground = useCallback(async () => {
    setCheckingBackground(true);
    setBackgroundResult(null);
    try {
      const data = await systemApi.status();
      setStatusData(data);
      const status = data.celery;
      setBackgroundResult(status === "up"
        ? "Recent scheduled heartbeat completed successfully."
        : "No recent background heartbeat. Check the scheduler, broker, worker, and cache.");
    } catch (err: unknown) {
      setBackgroundResult(err instanceof Error ? err.message : "Unable to check background health.");
    } finally {
      setCheckingBackground(false);
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
    checkBackground,
    checkingBackground,
    backgroundResult,
  };
}
