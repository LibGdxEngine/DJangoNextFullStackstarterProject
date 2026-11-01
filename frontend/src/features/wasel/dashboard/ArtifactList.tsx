"use client";

import { useState } from "react";
import { agentApi, type AgentArtifact } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";
import { formatBytes, saveBlob } from "@/lib/download";
import type { FileNote } from "./describe-step";

function fileName(artifact: AgentArtifact): string {
  return artifact.path.split("/").pop() || artifact.path;
}

const arabic = (n: number): string => n.toLocaleString("ar-EG");

/**
 * The files a run saved, each one a button that downloads it. With `notes` (from
 * fileNotes) each file says where it came from, and the page dumps and lists the agent
 * made for itself are folded away under "working files" so the results stand out.
 */
export function ArtifactList({ runId, artifacts, notes }: { runId: string; artifacts: AgentArtifact[]; notes?: Map<string, FileNote> }) {
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

  const noteOf = (artifact: AgentArtifact) => notes?.get(fileName(artifact));
  const working = artifacts.filter((a) => noteOf(a)?.working);
  const results = artifacts.filter((a) => !noteOf(a)?.working);

  const renderFile = (artifact: AgentArtifact) => {
    const note = noteOf(artifact);
    return (
      <button
        key={artifact.id}
        onClick={() => void download(artifact)}
        disabled={downloading === artifact.id}
        title={`تنزيل ${fileName(artifact)}`}
        className="flex max-w-full items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-start text-xs hover:border-violet hover:text-violet disabled:opacity-60"
      >
        <span aria-hidden className="text-base">{artifact.kind === "screenshot" ? "🖼" : "📄"}</span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span dir="ltr" className="truncate font-medium">{fileName(artifact)}</span>
            <span className="text-muted-soft">{formatBytes(artifact.size)}</span>
          </span>
          {note ? <span className="truncate text-muted">{note.text}</span> : null}
        </span>
        <span aria-hidden className="text-violet">{downloading === artifact.id ? "…" : "⬇"}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {results.length > 0 ? (
        <>
          <div className="text-xs text-muted-soft">الملفات ({arabic(results.length)})</div>
          <div className="flex flex-wrap gap-2">{results.map(renderFile)}</div>
        </>
      ) : null}
      {working.length > 0 ? (
        <details className="group rounded-2xl border border-dashed border-line px-3 py-2">
          <summary className="cursor-pointer list-none text-xs text-muted-soft">
            <span className="me-1 inline-block transition-transform group-open:rotate-90">▸</span>
            ملفات العمل ({arabic(working.length)}): صفحات وقوائم حفظها الوكيل لنفسه أثناء البحث
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">{working.map(renderFile)}</div>
        </details>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl bg-[#FEE2E2] px-3 py-2 text-xs text-[#B91C1C]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
