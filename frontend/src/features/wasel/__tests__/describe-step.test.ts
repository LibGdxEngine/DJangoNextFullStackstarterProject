import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@/lib/api/agent";
import {
  describeCall, fileNotes, formatDuration, groupSteps, progressOf, summarizeResult,
} from "../dashboard/describe-step";

const event = (seq: number, kind: AgentRunEvent["kind"], payload: unknown): AgentRunEvent =>
  ({ seq, kind, payload, created_at: "" }) as AgentRunEvent;

describe("describeCall", () => {
  it("says what the agent does in plain words, naming the site", () => {
    expect(describeCall("web_search", { query: "MacBook Air 16GB price Egypt" }).text).toBe(
      "يبحث في الإنترنت عن «MacBook Air 16GB price Egypt»",
    );
    expect(describeCall("browse", { url: "https://www.amazon.eg/-/en/s?k=macbook" }).text).toBe("يفتح صفحة على amazon.eg");
    expect(describeCall("fetch_page", { url: "https://ts3era.com/?s=x" }).text).toBe("يقرأ صفحة من ts3era.com");
    const many = describeCall("fetch_many", {
      urls: ["https://www.noon.com/a", "https://jumia.com.eg/b", "https://btoga.com/c", "https://2b.com.eg/d", "https://x.eg/e"],
      save_as: "eg_stores_2.json",
    });
    expect(many.text).toBe("يقرأ ٥ صفحات دفعة واحدة (noon.com، jumia.com.eg، btoga.com و٢ أخرى)");
    expect(many.file).toBe("eg_stores_2.json");
    expect(describeCall("extract_items", { save_as: "amazon.json" })).toMatchObject({ text: "يستخرج قائمة العناصر من الصفحة", file: "amazon.json" });
    expect(describeCall("click", { element: "35" }).text).toBe("يضغط على عنصر في الصفحة");
    expect(describeCall("click", { element: "Add to cart" }).text).toBe("يضغط على «Add to cart»");
    expect(describeCall("read_file", { file_path: "amazon_eg_search.json" }).text).toBe("يراجع الملف amazon_eg_search.json");
    expect(describeCall("some_new_tool", {}).text).toBe("some new tool");
  });
});

describe("summarizeResult", () => {
  it("explains why a step failed without the technical text", () => {
    expect(summarizeResult("write_todos", "Error: write_todos is not a valid tool, try one of [ls]", "error")).toEqual({
      ok: false, text: "أداة غير متاحة للوكيل",
    });
    expect(summarizeResult("browse", "Failed to open https://noon.com/x: Error: Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://noon.com/x", "failed").text)
      .toBe("الموقع رفض الاتصال، غالباً يمنع المتصفحات الآلية");
    expect(summarizeResult("fetch_page", "Fetch failed: TimeoutError: APIRequestContext.get: Timeout 20000ms exceeded.").text)
      .toBe("الموقع لم يستجب في الوقت المحدد");
    expect(summarizeResult("fetch_page", "Fetch failed: Error: getaddrinfo ENOTFOUND www.btoga.com").text).toBe("عنوان الموقع غير موجود");
    expect(summarizeResult("fetch_page", "Fetch failed: HTTP 404 for https://btech.com/en/search?q=x. This looks like a guessed URL").text)
      .toBe("الصفحة غير موجودة (404)");
    expect(summarizeResult("fetch_page", "Fetch failed: HTTP 402 for https://abukartona.site/p/x.").text).toBe("الموقع يطلب اشتراكاً مدفوعاً");
    expect(summarizeResult("fetch_page", "Skipped: noon.com is unreachable from this browser (it drops the connection; 2 attempts failed).").text)
      .toBe("تخطّى noon.com لأنه لا يمكن الوصول إليه");
    expect(summarizeResult("browse", "(Retried after HTTP 503.)\n(This looks like a sign-in wall, CAPTCHA or access block. Stop and report it.)\nURL: https://dubizzle.com.eg/\nTitle: Security check | Dubizzle"))
      .toEqual({ ok: false, text: "الموقع يطلب تحققاً بشرياً أو تسجيل دخول" });
  });

  it("marks a repeated step and reads the wrapped result", () => {
    const content = "Note: you already ran browse(url='x') at step 7 and got: Failed to open x. Repeating it won't help.\n\nFailed to open x: Error: Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at x";
    expect(summarizeResult("browse", content)).toEqual({ ok: false, text: "خطوة مكررة: الموقع رفض الاتصال، غالباً يمنع المتصفحات الآلية" });
  });

  it("summarizes what a successful step brought back", () => {
    expect(summarizeResult("web_search", "Top 10 results for 'q' (brave):\n\n1. A").text).toBe("وجد ١٠ نتائج");
    expect(summarizeResult("fetch_many", "Fetched 3 of 5 pages (2 failed). Saved full text of 3 pages as JSON to x.json.").text)
      .toBe("قرأ ٣ من ٥ صفحات، وتعذّرت ٢");
    expect(summarizeResult("fetch_many", "Fetched 4 of 4 pages. Saved").text).toBe("قرأ ٤ من ٤ صفحات");
    expect(summarizeResult("extract_items", "48 items found in <div.s-main-slot>, showing 40:\nSaved all 40 items as JSON to a.json.").text)
      .toBe("وجد ٤٨ عنصراً وحفظ ٤٠");
    expect(summarizeResult("browse", "URL: https://www.amazon.eg/s?k=x\nTitle: Amazon.eg : macbook air\nHTTP status: 200").text)
      .toBe("فتح: Amazon.eg : macbook air");
    expect(summarizeResult("fetch_page", "URL: https://shop.example/\nTitle: Shop\nFetched: HTTP 200\n\n(Only 158 characters of readable text in a 350 KB page: it is drawn by scripts. use browse for this page.)\nSkip").text)
      .toBe("الصفحة فارغة بدون متصفح، تحتاج فتحها فعلياً");
    expect(summarizeResult("read_file", "@@ lines 1-100 of 242 | next offset 100 @@\n[").text).toBe("قرأ ٢٤٢ سطراً");
  });
});

describe("groupSteps and progressOf", () => {
  const events = [
    event(0, "tool_call", { name: "write_todos", args: { todos: [{ content: "ابحث عن الأسعار", status: "in_progress" }, { content: "اكتب التقرير", status: "pending" }] }, id: "c0" }),
    event(1, "tool_call", { name: "web_search", args: { query: "q" }, id: "c1" }),
    event(2, "tool_result", { name: "write_todos", content: "Updated todo list", call_id: "c0", status: "ok" }),
    event(3, "tool_result", { name: "web_search", content: "Top 8 results for 'q' (brave):", call_id: "c1", status: "ok", seconds: 1.4 }),
    event(4, "tool_call", { name: "browse", args: { url: "https://noon.com/a" }, id: "c2" }),
    event(5, "tool_call", { name: "fetch_page", args: { url: "https://x.com/" }, id: "c3" }),
    event(6, "tool_result", { name: "fetch_page", content: "URL: https://x.com/\nTitle: X", call_id: "c3", status: "ok" }),
  ];

  it("pairs each call with its own result, even out of order, and reads the plan", () => {
    const steps = groupSteps(events);
    expect(steps.map((s) => s.kind)).toEqual(["plan", "step", "step", "step"]);
    expect(steps[0]).toMatchObject({ kind: "plan", todos: [{ content: "ابحث عن الأسعار", status: "in_progress" }, { content: "اكتب التقرير", status: "pending" }] });
    expect(steps[1]).toMatchObject({ kind: "step", call: { text: "يبحث في الإنترنت عن «q»" }, result: { ok: true, text: "وجد ٨ نتائج" }, seconds: 1.4 });
    expect(steps[2]).toMatchObject({ kind: "step", name: "browse" });
    expect(steps[2]).not.toHaveProperty("result");
    expect(steps[3]).toMatchObject({ kind: "step", name: "fetch_page", result: { ok: true, text: "فتح: X" } });
  });

  it("falls back to order when results carry no call id", () => {
    const legacy = [
      event(0, "tool_call", { name: "browse", args: { url: "https://a.com/" } }),
      event(1, "tool_call", { name: "browse", args: { url: "https://b.com/" } }),
      event(2, "tool_result", { name: "browse", content: "Failed to open https://a.com/: Error: net::ERR_CONNECTION_RESET" }),
    ];
    const steps = groupSteps(legacy);
    expect(steps[0]).toMatchObject({ result: { ok: false } });
    expect(steps[1]).not.toHaveProperty("result");
  });

  it("reports what is in progress, the counts and the latest plan", () => {
    const progress = progressOf(groupSteps(events));
    expect(progress).toEqual({
      current: ["يفتح صفحة على noon.com"],
      total: 3,
      failed: 0,
      plan: [{ content: "ابحث عن الأسعار", status: "in_progress" }, { content: "اكتب التقرير", status: "pending" }],
    });
  });
});

describe("fileNotes", () => {
  it("tells working files from deliverables and says where each came from", () => {
    const notes = fileNotes([
      event(0, "tool_call", { name: "fetch_many", args: { urls: ["https://a.com/1", "https://b.com/2"], save_as: "pages.json" } }),
      event(1, "tool_call", { name: "extract_items", args: { save_as: "items.json" } }),
      event(2, "tool_call", { name: "write_file", args: { file_path: "report.md", content: "..." } }),
      event(3, "tool_call", { name: "download_file", args: { url: "https://c.com/x.pdf", save_as: "x.pdf" } }),
    ]);
    expect(notes.get("pages.json")).toEqual({ working: true, text: "نصوص ٢ صفحات قرأها (a.com، b.com)" });
    expect(notes.get("items.json")).toEqual({ working: true, text: "قائمة العناصر التي استخرجها من صفحة" });
    expect(notes.get("report.md")).toEqual({ working: false, text: "ملف كتبه الوكيل" });
    expect(notes.get("x.pdf")).toEqual({ working: false, text: "ملف نزّله من c.com" });
  });
});

describe("formatDuration", () => {
  it("prints minutes and seconds in Arabic digits", () => {
    expect(formatDuration(42_000)).toBe("٤٢ ث");
    expect(formatDuration(365_000)).toBe("٦ د ٥ ث");
  });
});
