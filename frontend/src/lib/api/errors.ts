import { ApiError } from "./client";

export interface ApiFailure {
  message: string;
  code?: string;
  /** First message for each invalid field, keyed by field name. */
  fields: Record<string, string>;
}

/** Normalises anything thrown by a domain API into something a form can display. */
export function describeApiError(error: unknown, fallback = "حدث خطأ غير متوقع. حاول مرة أخرى."): ApiFailure {
  if (error instanceof ApiError) {
    const fields: Record<string, string> = {};
    for (const [name, messages] of Object.entries(error.fields)) {
      if (messages[0]) fields[name] = messages[0];
    }
    return { message: error.message || fallback, code: error.code, fields };
  }
  return { message: error instanceof Error ? error.message : fallback, fields: {} };
}
