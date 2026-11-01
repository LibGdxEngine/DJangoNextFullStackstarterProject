import type { AgentRunEvent } from "@/lib/api/agent";

/**
 * Turns the raw tool calls and results a run records into what a person watching the
 * run needs: what the agent is doing, in plain Arabic, and whether it worked.
 */

export type Dict = Record<string, unknown>;

export function asRecord(value: unknown): Dict {
  return value && typeof value === "object" ? (value as Dict) : {};
}

export function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const clip = (text: string, max = 70): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const fileName = (path: unknown): string => str(path).split("/").pop() || str(path);
const arabic = (n: number): string => n.toLocaleString("ar-EG");

export function listHosts(urls: unknown, max = 3): string {
  const hosts = Array.from(new Set((Array.isArray(urls) ? urls : []).map(hostOf).filter(Boolean)));
  const shown = hosts.slice(0, max).join("، ");
  return hosts.length > max ? `${shown} و${arabic(hosts.length - max)} أخرى` : shown;
}

export interface CallDescription {
  icon: string;
  text: string;
  /** A file this call writes into the workspace, if any. */
  file?: string;
}

/** What the agent is doing, from a tool call's name and arguments. */
export function describeCall(name: string, rawArgs: unknown): CallDescription {
  const args = asRecord(rawArgs);
  const url = str(args.url);
  const host = hostOf(url);
  const where = host ? ` من ${host}` : "";
  switch (name) {
    case "web_search":
      return { icon: "🔎", text: `يبحث في الإنترنت عن «${clip(str(args.query))}»` };
    case "browse":
      return { icon: "🌐", text: host ? `يفتح صفحة على ${host}` : "يفتح صفحة" };
    case "fetch_page":
      return { icon: "📄", text: `يقرأ صفحة${where}` };
    case "fetch_many": {
      const urls = Array.isArray(args.urls) ? args.urls : [];
      const text = `يقرأ ${arabic(urls.length)} صفحات دفعة واحدة` + (urls.length ? ` (${listHosts(urls)})` : "");
      return { icon: "📚", text, file: str(args.save_as) || undefined };
    }
    case "extract_items":
      return { icon: "📋", text: "يستخرج قائمة العناصر من الصفحة", file: str(args.save_as) || undefined };
    case "read_current_page":
      return { icon: "👀", text: "يعيد قراءة الصفحة" };
    case "find_on_page":
      return { icon: "🔍", text: `يبحث داخل الصفحة عن «${clip(str(args.text))}»` };
    case "list_links":
      return { icon: "🔗", text: args.contains ? `يجمع الروابط التي تحتوي «${clip(str(args.contains))}»` : "يجمع روابط الصفحة" };
    case "scroll":
      return { icon: "↕️", text: "يمرّر الصفحة" };
    case "wait_for":
      return { icon: "⏳", text: args.text ? `ينتظر ظهور «${clip(str(args.text))}»` : "ينتظر تحميل الصفحة" };
    case "go_back":
      return { icon: "↩️", text: "يرجع للصفحة السابقة" };
    case "click":
      return { icon: "👆", text: `يضغط على ${target(args.element)}` };
    case "type_text":
      return { icon: "⌨️", text: `يكتب «${clip(str(args.text), 40)}»` };
    case "set_checkbox":
      return { icon: "☑️", text: args.checked === false ? "يلغي تحديد خيار" : "يحدد خياراً" };
    case "select_option":
      return { icon: "🔽", text: `يختار «${clip(str(args.option), 40)}» من القائمة` };
    case "hover":
      return { icon: "🖱️", text: `يمرّر المؤشر فوق ${target(args.element)}` };
    case "drag":
      return { icon: "✋", text: "يسحب عنصراً ويفلته" };
    case "press_key":
      return { icon: "⌨️", text: `يضغط زر ${str(args.key)}` };
    case "upload_file":
      return { icon: "📤", text: `يرفع الملف ${fileName(args.file_path)}` };
    case "download_file":
      return { icon: "📥", text: host ? `ينزّل ملفاً من ${host}` : "ينزّل ملفاً", file: str(args.save_as) || undefined };
    case "read_pdf":
      return { icon: "📕", text: `يقرأ ملف ${fileName(args.file_path)}` };
    case "dismiss_overlays":
      return { icon: "✖️", text: "يغلق النوافذ المنبثقة" };
    case "solve_turnstile":
    case "solve_recaptcha":
      return { icon: "🤖", text: "يجتاز التحقق من أنه ليس روبوتاً" };
    case "hand_over_to_user":
    case "manual_captcha_handoff":
      return { icon: "🙋", text: "يطلب منك تولّي المتصفح" };
    case "ask_user":
      return { icon: "❓", text: "يسألك سؤالاً" };
    case "list_tabs":
      return { icon: "🗂️", text: "يراجع التبويبات المفتوحة" };
    case "switch_tab":
      return { icon: "🗂️", text: "ينتقل إلى تبويب آخر" };
    case "close_tab":
      return { icon: "🗂️", text: "يغلق التبويب" };
    case "screenshot":
      return { icon: "📸", text: "يلتقط صورة للشاشة" };
    case "check_exit_ip":
      return { icon: "🌍", text: "يتحقق من اتصال الإنترنت" };
    case "write_todos":
      return { icon: "🗒️", text: "يحدّث خطة العمل" };
    case "read_file":
      return { icon: "📂", text: `يراجع الملف ${fileName(args.file_path)}` };
    case "write_file":
      return { icon: "💾", text: `يكتب الملف ${fileName(args.file_path)}`, file: str(args.file_path) || undefined };
    case "edit_file":
      return { icon: "✏️", text: `يعدّل الملف ${fileName(args.file_path)}`, file: str(args.file_path) || undefined };
    case "delete":
      return { icon: "🗑️", text: `يحذف الملف ${fileName(args.file_path ?? args.path)}` };
    case "ls":
    case "glob":
    case "grep":
      return { icon: "📂", text: "يبحث بين ملفاته" };
    default:
      return { icon: "⚙️", text: name.replace(/_/g, " ") };
  }
}

function target(element: unknown): string {
  const text = str(element).trim();
  if (!text || /^\[?\d+\]?$/.test(text)) return "عنصر في الصفحة";
  return `«${clip(text, 40)}»`;
}

export interface ResultSummary {
  ok: boolean;
  /** One short line: what came back, or why the step did not work. */
  text: string;
}

const RESULT_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/is not a valid tool/, () => "أداة غير متاحة للوكيل"],
  [/^Skipped: ([\w.-]+) is unreachable/, (m) => `تخطّى ${m[1]} لأنه لا يمكن الوصول إليه`],
  [/ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION|ECONNRESET|socket hang up|drops the connection/, () => "الموقع رفض الاتصال، غالباً يمنع المتصفحات الآلية"],
  [/Timeout \d+ms exceeded|ERR_TIMED_OUT|does not answer in time/, () => "الموقع لم يستجب في الوقت المحدد"],
  [/ENOTFOUND|ERR_NAME_NOT_RESOLVED|does not resolve/, () => "عنوان الموقع غير موجود"],
  [/SSL|EPROTO|ERR_CERT|TLS certificate/, () => "مشكلة في شهادة أمان الموقع"],
  [/HTTP 404/, () => "الصفحة غير موجودة (404)"],
  [/HTTP 402/, () => "الموقع يطلب اشتراكاً مدفوعاً"],
  [/HTTP 401|HTTP 403/, () => "الموقع يمنع الوصول"],
  [/HTTP 429/, () => "الموقع طلب الإبطاء (طلبات كثيرة)"],
  [/HTTP 5\d\d/, () => "خطأ من جهة الموقع"],
  [/bot check|CAPTCHA|sign-in wall|access block|Security check/i, () => "الموقع يطلب تحققاً بشرياً أو تسجيل دخول"],
  [/^Blocked:/, () => "موقع خارج النطاق المسموح"],
  [/^Not done/, () => "لم يُنفَّذ: لم توافق على الخطوة"],
  [/^Nobody took over/, () => "لم يتولَّ أحد المتصفح في الوقت المحدد"],
  [/^No element/, () => "العنصر لم يعد موجوداً في الصفحة"],
  [/^No repeated items/, () => "لم يجد قائمة عناصر في الصفحة"],
];

/** Whether a step worked and a one-line reading of its result, from the result event. */
export function summarizeResult(name: string, rawContent: unknown, status?: unknown): ResultSummary {
  const content = str(rawContent).trim();
  const repeated = content.startsWith("Note: you already ran");
  // A repeat note or a retry note comes before the result it wraps.
  let body = content;
  for (const prefix of ["Note: you already ran", "(Retried after"]) {
    if (body.startsWith(prefix) && body.includes("\n")) body = body.slice(body.indexOf("\n")).trim();
  }
  const failed = status === "error" || status === "failed" || /^(Error|Failed|Fetch failed|Download failed|Could not|Skipped|Blocked|Not done|Nobody took over|No element|No repeated items|\(This looks like a sign-in wall|\(This page is a bot check|The user gave up)/.test(body);
  const prefix = repeated ? "خطوة مكررة: " : "";
  if (failed) {
    for (const [pattern, describe] of RESULT_PATTERNS) {
      const m = body.match(pattern);
      if (m) return { ok: false, text: prefix + describe(m) };
    }
    return { ok: false, text: prefix + "لم تنجح الخطوة" };
  }
  return { ok: true, text: prefix + successText(name, body) };
}

function successText(name: string, body: string): string {
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^Top (\d+) results for/))) return `وجد ${arabic(Number(m[1]))} نتائج`;
  if (body.startsWith("Top 0 results") || /^No results/.test(body)) return "لم يجد نتائج";
  if ((m = body.match(/^Fetched (\d+) of (\d+) pages(?: \((\d+) failed(?:, (\d+) blocked)?\))?/))) {
    const [, ok, total, failed] = m;
    let text = `قرأ ${arabic(Number(ok))} من ${arabic(Number(total))} صفحات`;
    if (failed) text += `، وتعذّرت ${arabic(Number(failed))}`;
    return text;
  }
  if ((m = body.match(/^(\d+) items found/))) {
    const saved = body.match(/Saved all (\d+) items/);
    return `وجد ${arabic(Number(m[1]))} عنصراً` + (saved ? ` وحفظ ${arabic(Number(saved[1]))}` : "");
  }
  if (/drawn by scripts/.test(body)) return "الصفحة فارغة بدون متصفح، تحتاج فتحها فعلياً";
  if ((m = body.match(/^Title: (.+)$/m))) return `فتح: ${clip(m[1].trim(), 60)}`;
  if (body.startsWith("The user finished and handed the browser back")) return "استلم المتصفح منك";
  if (name === "write_todos") return "حدّث الخطة";
  if (name === "read_file" && (m = body.match(/lines (\d+)-(\d+) of (\d+)/))) return `قرأ ${arabic(Number(m[3]))} سطراً`;
  if (body.startsWith("(Page unchanged")) return "الصفحة لم تتغير";
  const first = body.split("\n", 1)[0] ?? "";
  return clip(first.replace(/^\(|\)$/g, ""), 70) || "تم";
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export function parseTodos(args: unknown): Todo[] {
  const list = asRecord(args).todos;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const todo = asRecord(item);
    const status = str(todo.status);
    const known: Todo["status"] = status === "completed" || status === "in_progress" ? status : "pending";
    return { content: str(todo.content) || str(todo.task) || str(todo.title), status: known };
  }).filter((todo) => todo.content);
}

/** The run's events regrouped: a step is a tool call with the result that answered it. */
export type Step =
  | { kind: "step"; seq: number; name: string; args: Dict; call: CallDescription; result?: ResultSummary; raw?: string; seconds?: number }
  | { kind: "plan"; seq: number; todos: Todo[] }
  | { kind: "message"; seq: number; text: string }
  | { kind: "question"; seq: number; text: string; payload: Dict }
  | { kind: "answer"; seq: number; text: string };

export function groupSteps(events: AgentRunEvent[]): Step[] {
  const steps: Step[] = [];
  const byCallId = new Map<string, Extract<Step, { kind: "step" }>>();
  const pendingByName = new Map<string, Extract<Step, { kind: "step" }>[]>();
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (event.kind === "tool_call") {
      const name = str(payload.name);
      if (name === "write_todos") {
        steps.push({ kind: "plan", seq: event.seq, todos: parseTodos(payload.args) });
        continue;
      }
      const step: Extract<Step, { kind: "step" }> = {
        kind: "step", seq: event.seq, name, args: asRecord(payload.args), call: describeCall(name, payload.args),
      };
      steps.push(step);
      const id = str(payload.id);
      if (id) byCallId.set(id, step);
      pendingByName.set(name, [...(pendingByName.get(name) ?? []), step]);
    } else if (event.kind === "tool_result") {
      const name = str(payload.name);
      const id = str(payload.call_id);
      let step = id ? byCallId.get(id) : undefined;
      if (!step) step = (pendingByName.get(name) ?? []).find((s) => !s.result);
      if (name === "write_todos") continue; // the plan card is the whole story
      if (!step) continue;
      step.result = summarizeResult(name, payload.content, payload.status);
      step.raw = str(payload.content);
      if (typeof payload.seconds === "number") step.seconds = payload.seconds;
    } else if (event.kind === "message") {
      steps.push({ kind: "message", seq: event.seq, text: str(payload.text) });
    } else if (event.kind === "question") {
      steps.push({ kind: "question", seq: event.seq, text: str(payload.question), payload });
    } else if (event.kind === "answer") {
      steps.push({ kind: "answer", seq: event.seq, text: str(payload.answer) });
    }
  }
  return steps;
}

export interface Progress {
  /** Steps the agent is in the middle of (called, not yet answered). */
  current: string[];
  total: number;
  failed: number;
  plan?: Todo[];
}

export function progressOf(steps: Step[]): Progress {
  const toolSteps = steps.filter((s): s is Extract<Step, { kind: "step" }> => s.kind === "step");
  const plans = steps.filter((s): s is Extract<Step, { kind: "plan" }> => s.kind === "plan");
  return {
    current: toolSteps.filter((s) => !s.result).map((s) => s.call.text),
    total: toolSteps.length,
    failed: toolSteps.filter((s) => s.result && !s.result.ok).length,
    plan: plans.length ? plans[plans.length - 1].todos : undefined,
  };
}

export interface FileNote {
  text: string;
  /** Page dumps and extracted lists the agent made for itself, as opposed to deliverables. */
  working: boolean;
}

/** What each file in the run's workspace is, from the call that wrote it. */
export function fileNotes(events: AgentRunEvent[]): Map<string, FileNote> {
  const notes = new Map<string, FileNote>();
  for (const event of events) {
    if (event.kind !== "tool_call") continue;
    const payload = asRecord(event.payload);
    const args = asRecord(payload.args);
    const name = str(payload.name);
    const saveAs = fileName(args.save_as);
    if (name === "fetch_many" && saveAs) {
      const urls = Array.isArray(args.urls) ? args.urls : [];
      notes.set(saveAs, { working: true, text: `نصوص ${arabic(urls.length)} صفحات قرأها (${listHosts(urls)})` });
    } else if (name === "extract_items" && saveAs) {
      notes.set(saveAs, { working: true, text: "قائمة العناصر التي استخرجها من صفحة" });
    } else if (name === "download_file" && saveAs) {
      const host = hostOf(args.url);
      notes.set(saveAs, { working: false, text: host ? `ملف نزّله من ${host}` : "ملف نزّله" });
    } else if ((name === "write_file" || name === "edit_file") && args.file_path) {
      notes.set(fileName(args.file_path), { working: false, text: "ملف كتبه الوكيل" });
    }
  }
  return notes;
}

/** "٣ د ١٢ ث" for a span in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${arabic(seconds)} ث`;
  return `${arabic(minutes)} د ${arabic(seconds)} ث`;
}
