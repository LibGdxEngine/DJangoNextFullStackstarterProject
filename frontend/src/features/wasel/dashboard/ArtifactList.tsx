"use client";

import { useState } from "react";
import { agentApi, type AgentArtifact } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";
import { formatBytes, saveBlob } from "@/lib/download";

function fileName(artifact: AgentArtifact): string {
  return artifact.path.split("/").pop() || artifact.path;
}

/** The files a run saved, each one a button that downloads it. */
export function ArtifactList({ runId, artifacts }: { runId: string; artifacts: AgentArtifact[] }) {
  const [downloading, setDownloading] = useState<string>();
  const [error, setError] = useState<string>();

  if (artifacts.length === 0) return null;

  async function download(artifact: AgentArtifact) {
    setDownloading(artifact.id);
    setError(undefined);
    try {
      saveBlob(await agentApi.downloadArtifact(runId, artifact.id), fileName(artifact));
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setDownloading(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-soft">الملفات ({artifacts.length.toLocaleString("ar-EG")})</div>
      <div className="flex flex-wrap gap-2">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            onClick={() => void download(artifact)}
            disabled={downloading === artifact.id}
            title={`تنزيل ${fileName(artifact)}`}
            className="flex max-w-full items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs hover:border-violet hover:text-violet disabled:opacity-60"
          >
            <span aria-hidden>{artifact.kind === "screenshot" ? "🖼" : "📄"}</span>
            <span dir="ltr" className="truncate">{fileName(artifact)}</span>
            <span className="text-muted-soft">{formatBytes(artifact.size)}</span>
            <span aria-hidden className="text-violet">{downloading === artifact.id ? "…" : "⬇"}</span>
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="rounded-xl bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
