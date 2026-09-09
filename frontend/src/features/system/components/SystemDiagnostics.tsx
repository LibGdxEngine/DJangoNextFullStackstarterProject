"use client";

import React, { useEffect } from "react";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function SystemDiagnostics() {
  const {
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
  } = useSystemStatus();

  useEffect(() => {
    fetchHello();
    fetchStatus();
  }, [fetchHello, fetchStatus]);

  const getBadgeVariant = (val: string | undefined) => {
    if (!val) return "neutral";
    if (val === "up") return "success";
    if (val.startsWith("down") || val.startsWith("failed")) return "error";
    return "warning";
  };

  return (
    <Card
      title="Platform Health & Diagnostics"
      subtitle="Runtime connectivity validation across PostgreSQL, Redis cache, and Celery queue"
      headerAction={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchHello();
            fetchStatus();
          }}
          isLoading={statusLoading || helloLoading}
        >
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Hello API Banner */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/40 border border-zinc-800 text-sm">
          <div>
            <span className="font-semibold text-zinc-300">API Connection: </span>
            {helloLoading ? (
              <span className="text-zinc-500">Checking...</span>
            ) : helloError ? (
              <span className="text-red-400">{helloError}</span>
            ) : helloData ? (
              <span className="text-emerald-400">{helloData.message}</span>
            ) : (
              <span className="text-zinc-500">Idle</span>
            )}
          </div>
          <Badge variant={helloData?.status === "success" ? "success" : "neutral"} size="sm">
            {helloData?.status || "PENDING"}
          </Badge>
        </div>

        {statusError && (
          <div className="p-3 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
            {statusError}
          </div>
        )}

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Database */}
          <div className="p-4 rounded-lg bg-zinc-800/30 border border-zinc-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase font-semibold text-zinc-400">PostgreSQL</span>
                <Badge variant={getBadgeVariant(statusData?.database)} size="sm">
                  {statusData?.database || "WAITING"}
                </Badge>
              </div>
              <p className="text-xs text-zinc-400">
                Connection verification via Django raw database connection.
              </p>
            </div>
          </div>

          {/* Redis */}
          <div className="p-4 rounded-lg bg-zinc-800/30 border border-zinc-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase font-semibold text-zinc-400">Redis Cache</span>
                <Badge variant={getBadgeVariant(statusData?.redis)} size="sm">
                  {statusData?.redis || "WAITING"}
                </Badge>
              </div>
              <p className="text-xs text-zinc-400">
                Cache set/get transaction probe against Redis instance.
              </p>
            </div>
          </div>

          {/* Celery */}
          <div className="p-4 rounded-lg bg-zinc-800/30 border border-zinc-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase font-semibold text-zinc-400">Celery Worker</span>
                <Badge
                  variant={getBadgeVariant(statusData?.celery)}
                  size="sm"
                >
                  {statusData?.celery || "WAITING"}
                </Badge>
              </div>
              <p className="text-xs text-zinc-400">
                Recent scheduled heartbeat completed by a background worker.
              </p>
            </div>
          </div>

          {/* Celery Beat */}
          <div className="p-4 rounded-lg bg-zinc-800/30 border border-zinc-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase font-semibold text-zinc-400">Background Heartbeat</span>
                <Badge
                  variant={getBadgeVariant(statusData?.beat.status)}
                  size="sm"
                >
                  {statusData?.beat.status || "WAITING"}
                </Badge>
              </div>
              <p className="text-xs text-zinc-400">
                Checks the scheduler, broker, worker, and cache together.
              </p>
            </div>
          </div>
        </div>

        {/* Background health check and feedback */}
        <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-zinc-800/80">
          <div>
            <p className="text-sm font-medium text-zinc-300">Background Job Health</p>
            <p className="text-xs text-zinc-400">
              Check when a scheduled heartbeat last completed.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={checkBackground}
            isLoading={checkingBackground}
          >
            Check Background Health
          </Button>
        </div>

        {backgroundResult && (
          <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 font-mono text-xs text-zinc-300">
            {backgroundResult}
          </div>
        )}
      </div>
    </Card>
  );
}
