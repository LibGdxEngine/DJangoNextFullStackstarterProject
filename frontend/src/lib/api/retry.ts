/** Bounded public retry metadata; never transport arbitrary server errors in URLs. */
export function retrySeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (/^[A-Za-z]{3}, /.test(value) ? (Date.parse(value) - now) / 1000 : NaN);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(0, Math.ceil(seconds))) : undefined;
}

export function encodeAuthRetry(status: number, seconds?: number): string | undefined {
  if (status !== 429 && status !== 503) return undefined;
  const wait = seconds !== undefined && Number.isFinite(seconds) ? Math.max(0, Math.min(86400, Math.ceil(seconds))) : 5;
  return `MOBSER_RETRY_${status}_${wait}`;
}

export function decodeAuthRetry(value?: string | null) {
  const match = /^MOBSER_RETRY_(429|503)_(\d{1,5})$/.exec(value ?? "");
  if (!match || Number(match[2]) > 86400) return undefined;
  return { status: Number(match[1]), seconds: Number(match[2]) };
}
