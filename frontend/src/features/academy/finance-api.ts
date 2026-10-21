/**
 * Money operations (fixture-backed). Mirrors PackageViewSet, EnrollmentViewSet,
 * PaymentViewSet (upload-receipt, review), PayrollViewSet (transition),
 * EarningEntryViewSet (adjust) and EarningsIssueViewSet (resolve).
 *
 * Rules kept here, not in the UI:
 * - Package definitions never change purchased enrollments.
 * - Student deductions (balance ledger) and teacher earnings are separate rows.
 * - Closed payroll months never change; corrections are adjustment rows.
 * - Amounts are never summed across currencies.
 */
import * as db from "./fixtures";
import { NotFoundError, respond } from "./api";
import { totalsByCurrency } from "@/lib/format";
import type { EarningEntry, Enrollment, Package, Payment, PayrollStatus } from "./types";

const NEXT: Record<PayrollStatus, PayrollStatus | null> = { draft: "reviewed", reviewed: "approved", approved: "paid", paid: null };

function enrollmentOf(id: string) {
  const e = db.enrollments.find((x) => x.id === id);
  if (!e) throw new NotFoundError("Enrollment");
  return e;
}

function studentName(id: string) {
  return db.students.find((s) => s.id === id)?.name ?? "";
}

/** Same amount and currency, and either the same reference or the same family within 7 days. */
export function duplicateOf(payment: Payment): Payment | null {
  const ref = payment.reference.trim().toLowerCase();
  const generic = !ref || ["card", "bank transfer", "cash"].includes(ref);
  return db.payments.find((o) =>
    o.id !== payment.id &&
    o.status !== "rejected" &&
    o.amount === payment.amount &&
    o.currency === payment.currency &&
    ((!generic && o.reference.trim().toLowerCase() === ref) ||
      (o.familyId === payment.familyId && Math.abs(new Date(o.submittedAt).getTime() - new Date(payment.submittedAt).getTime()) < 7 * 86_400_000))) ?? null;
}

function paymentRow(p: Payment) {
  const enrollment = db.enrollments.find((e) => e.id === p.enrollmentId) ?? null;
  return {
    payment: p,
    studentName: studentName(p.studentId),
    familyName: db.families.find((f) => f.id === p.familyId)?.name ?? "",
    enrollment,
    duplicate: p.status === "pending" ? duplicateOf(p) : null,
  };
}

function activate(enrollment: Enrollment, actorName: string) {
  if (enrollment.status !== "pending") return;
  enrollment.status = "active";
  enrollment.balance += enrollment.lessonCount;
  db.balanceEntries.push({
    id: `${enrollment.id}-act-${Date.now().toString(36)}`,
    enrollmentId: enrollment.id,
    delta: enrollment.lessonCount,
    balanceAfter: enrollment.balance,
    kind: "activation",
    reason: `${enrollment.packageName} · ${enrollment.currency} ${enrollment.price}`,
    actorName,
    createdAt: new Date().toISOString(),
  });
}

function payrollOf(month: string) {
  let payroll = db.payrolls.find((p) => p.month === month);
  if (!payroll) {
    payroll = { month, status: "draft" };
    db.payrolls.push(payroll);
  }
  return payroll;
}

function entryRow(e: EarningEntry) {
  const session = e.sessionId ? db.sessions.find((s) => s.id === e.sessionId) ?? null : null;
  return { entry: e, sessionNumber: session?.number ?? null, startsAt: session?.startsAt ?? null, studentName: session ? studentName(session.studentId) : null };
}

export const financeApi = {
  /* ── Packages & enrollments ─────────────────────────────── */

  packages: () => respond(db.packages.map((p) => ({
    pkg: p,
    activeEnrollments: db.enrollments.filter((e) => e.packageId === p.id && e.status === "active").length,
    pendingEnrollments: db.enrollments.filter((e) => e.packageId === p.id && e.status === "pending").length,
  }))),

  savePackage(input: Omit<Package, "id">, id?: string) {
    if (id) {
      const existing = db.packages.find((p) => p.id === id);
      if (!existing) throw new NotFoundError("Package");
      Object.assign(existing, input);
      return respond(existing);
    }
    const pkg = { ...input, id: `p-${Date.now().toString(36)}` };
    db.packages.push(pkg);
    return respond(pkg);
  },

  enrollments: () => respond(db.enrollments.map((e) => ({
    enrollment: e,
    studentName: studentName(e.studentId),
    familyId: db.students.find((s) => s.id === e.studentId)?.familyId ?? "",
    paid: db.payments.some((p) => p.enrollmentId === e.id && p.status === "approved"),
    pendingPayment: db.payments.some((p) => p.enrollmentId === e.id && p.status === "pending"),
  }))),

  enrollment(id: string) {
    const e = enrollmentOf(id);
    return respond({
      enrollment: e,
      studentName: studentName(e.studentId),
      ledger: db.balanceEntries.filter((b) => b.enrollmentId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      payments: db.payments.filter((p) => p.enrollmentId === id),
      renewedFrom: e.renewedFrom ? db.enrollments.find((x) => x.id === e.renewedFrom) ?? null : null,
    });
  },

  /** Renewal copies the package's current terms into a new pending enrollment. */
  renew(studentId: string, packageId: string) {
    const pkg = db.packages.find((p) => p.id === packageId);
    if (!pkg) throw new NotFoundError("Package");
    const current = db.enrollments.filter((e) => e.studentId === studentId && e.status !== "closed").sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
    const startsOn = current && current.expiresOn > new Date().toISOString().slice(0, 10) ? current.expiresOn : new Date().toISOString().slice(0, 10);
    const expires = new Date(`${startsOn}T12:00:00Z`);
    expires.setUTCDate(expires.getUTCDate() + pkg.validityDays);
    const enrollment: Enrollment = {
      id: `e-${Date.now().toString(36)}`,
      renewedFrom: current?.id,
      studentId,
      packageId: pkg.id,
      packageName: pkg.name,
      lessonCount: pkg.lessonCount,
      durationMinutes: pkg.durationMinutes,
      price: pkg.price,
      currency: pkg.currency,
      startsOn,
      expiresOn: expires.toISOString().slice(0, 10),
      status: "pending",
      balance: 0,
    };
    db.enrollments.push(enrollment);
    return respond(enrollment);
  },

  /* ── Payments ───────────────────────────────────────────── */

  payments: () => respond(db.payments.map(paymentRow).sort((a, b) => b.payment.submittedAt.localeCompare(a.payment.submittedAt))),

  /** Enrollments that can take a payment, for the record-payment form. */
  payable: () => respond(db.enrollments
    .filter((e) => e.status !== "closed")
    .map((e) => ({ enrollment: e, studentName: studentName(e.studentId), familyId: db.students.find((s) => s.id === e.studentId)?.familyId ?? "" }))),

  recordPayment(input: { enrollmentId: string; amount: number; currency: string; reference: string; method: string; receiptName?: string; approveNow: boolean }, actorName: string) {
    const enrollment = enrollmentOf(input.enrollmentId);
    const student = db.students.find((s) => s.id === enrollment.studentId)!;
    const payment: Payment = {
      id: `pay-${Date.now().toString(36)}`,
      enrollmentId: enrollment.id,
      studentId: student.id,
      familyId: student.familyId,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      method: input.method,
      receiptName: input.receiptName,
      status: input.approveNow ? "approved" : "pending",
      source: "staff_record",
      submittedBy: actorName,
      submittedAt: new Date().toISOString(),
      reviewedBy: input.approveNow ? actorName : undefined,
      reviewedAt: input.approveNow ? new Date().toISOString() : undefined,
    };
    db.payments.push(payment);
    if (input.approveNow) activate(enrollment, actorName);
    return respond(payment);
  },

  uploadReceipt(input: { enrollmentId: string; amount: number; currency: string; reference: string; method: string; receiptName: string }, submittedBy: string) {
    const enrollment = enrollmentOf(input.enrollmentId);
    const student = db.students.find((s) => s.id === enrollment.studentId)!;
    const payment: Payment = { id: `pay-${Date.now().toString(36)}`, ...input, studentId: student.id, familyId: student.familyId, status: "pending", source: "family_upload", submittedBy, submittedAt: new Date().toISOString() };
    db.payments.push(payment);
    return respond(payment);
  },

  approvePayment(id: string, actorName: string) {
    const payment = db.payments.find((p) => p.id === id);
    if (!payment) throw new NotFoundError("Payment");
    payment.status = "approved";
    payment.reviewedBy = actorName;
    payment.reviewedAt = new Date().toISOString();
    activate(enrollmentOf(payment.enrollmentId), actorName);
    return respond(payment);
  },

  rejectPayment(id: string, reason: string, actorName: string) {
    const payment = db.payments.find((p) => p.id === id);
    if (!payment) throw new NotFoundError("Payment");
    payment.status = "rejected";
    payment.reviewReason = reason;
    payment.reviewedBy = actorName;
    payment.reviewedAt = new Date().toISOString();
    return respond(payment);
  },

  /* ── Payroll ────────────────────────────────────────────── */

  payrollMonths: () => respond([...db.payrolls].sort((a, b) => b.month.localeCompare(a.month))),

  payroll(month: string) {
    const payroll = payrollOf(month);
    const entries = db.earnings.filter((e) => e.payrollMonth === month);
    const monthSessions = db.sessions.filter((s) => s.startsAt.slice(0, 7) === month);
    const now = Date.now();
    const teacherIds = [...new Set([...entries.map((e) => e.teacherId), ...db.teachers.filter((t) => t.isActive).map((t) => t.id)])];
    const teachers = teacherIds.map((id) => {
      const teacher = db.teachers.find((t) => t.id === id)!;
      const mine = entries.filter((e) => e.teacherId === id);
      return {
        teacher,
        sessions: mine.filter((e) => e.kind !== "adjustment").length,
        adjustments: mine.filter((e) => e.kind === "adjustment").length,
        totals: totalsByCurrency(mine, (e) => e.amount, (e) => e.currency),
        openIssues: db.issues.filter((i) => i.teacherId === id && i.status === "open").length,
        unreported: monthSessions.filter((s) => s.teacherId === id && s.status === "scheduled" && new Date(s.endsAt).getTime() < now).length,
      };
    }).filter((row) => row.sessions + row.adjustments + row.openIssues + row.unreported > 0);
    return respond({
      payroll,
      teachers,
      totals: totalsByCurrency(entries, (e) => e.amount, (e) => e.currency),
      exceptions: {
        openIssues: db.issues.filter((i) => i.status === "open"),
        unreported: monthSessions.filter((s) => s.status === "scheduled" && new Date(s.endsAt).getTime() < now).length,
        needsReview: monthSessions.filter((s) => s.status === "needs_review").length,
      },
    });
  },

  transitionPayroll(month: string, to: PayrollStatus, actorName: string, paymentReference?: string) {
    const payroll = payrollOf(month);
    if (NEXT[payroll.status] !== to) throw new Error(`Can't move ${payroll.status} → ${to}`);
    payroll.status = to;
    const at = new Date().toISOString();
    if (to === "reviewed") payroll.reviewedBy = actorName;
    if (to === "approved") {
      payroll.approvedBy = actorName;
      payroll.approvedAt = at;
    }
    if (to === "paid") {
      payroll.paidAt = at;
      payroll.paymentReference = paymentReference;
    }
    return respond(payroll);
  },

  statement(month: string, teacherId: string) {
    const teacher = db.teachers.find((t) => t.id === teacherId);
    if (!teacher) throw new NotFoundError("Teacher");
    const entries = db.earnings.filter((e) => e.payrollMonth === month && e.teacherId === teacherId).map(entryRow).sort((a, b) => (a.entry.earnedOn).localeCompare(b.entry.earnedOn));
    return respond({
      teacher,
      payroll: payrollOf(month),
      entries,
      totals: totalsByCurrency(entries.map((r) => r.entry), (e) => e.amount, (e) => e.currency),
      issues: db.issues.filter((i) => i.teacherId === teacherId),
      /** Entries from closed months that adjustments here point at. */
      originals: db.earnings.filter((e) => entries.some((r) => r.entry.adjustmentOf === e.id)).map(entryRow),
    });
  },

  /** A correction always becomes a new row in an open month; closed rows are never edited. */
  addAdjustment(input: { teacherId: string; amount: number; currency: string; reason: string; adjustmentOf?: string; sessionId?: string }, actorName: string) {
    const original = input.adjustmentOf ? db.earnings.find((e) => e.id === input.adjustmentOf) : undefined;
    const earnedOn = original?.earnedOn ?? new Date().toISOString().slice(0, 10);
    const entry: EarningEntry = {
      id: `en-adj-${Date.now().toString(36)}`,
      teacherId: input.teacherId,
      sessionId: input.sessionId ?? original?.sessionId,
      amount: input.amount,
      currency: input.currency,
      earnedOn,
      kind: "adjustment",
      reason: input.reason,
      payrollMonth: db.payrollMonthFor(earnedOn),
      adjustmentOf: input.adjustmentOf,
      createdBy: actorName,
    };
    db.earnings.push(entry);
    return respond(entry);
  },

  resolveIssue(id: string, resolution: string, adjustment: { amount: number; currency: string } | null, actorName: string) {
    const issue = db.issues.find((i) => i.id === id);
    if (!issue) throw new NotFoundError("Issue");
    issue.status = "resolved";
    issue.resolution = resolution;
    issue.resolvedAt = new Date().toISOString();
    if (adjustment && adjustment.amount !== 0) {
      void financeApi.addAdjustment({ teacherId: issue.teacherId, amount: adjustment.amount, currency: adjustment.currency, reason: `Issue resolved: ${resolution}`, adjustmentOf: issue.entryId, sessionId: issue.sessionId }, actorName);
    }
    return respond(issue);
  },

  /* ── Teacher view ───────────────────────────────────────── */

  teacherEarnings(teacherId: string) {
    const months = [...new Set([...db.payrolls.map((p) => p.month), ...db.earnings.filter((e) => e.teacherId === teacherId).map((e) => e.payrollMonth)])].sort().reverse();
    return respond({
      months: months.map((month) => {
        const entries = db.earnings.filter((e) => e.teacherId === teacherId && e.payrollMonth === month);
        return { month, payroll: payrollOf(month), entries: entries.map(entryRow).sort((a, b) => b.entry.earnedOn.localeCompare(a.entry.earnedOn)), totals: totalsByCurrency(entries, (e) => e.amount, (e) => e.currency) };
      }),
      issues: db.issues.filter((i) => i.teacherId === teacherId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  },

  reportIssue(teacherId: string, input: { entryId?: string; sessionId?: string; description: string }) {
    const issue = { id: `iss-${Date.now().toString(36)}`, teacherId, ...input, status: "open" as const, createdAt: new Date().toISOString() };
    db.issues.push(issue);
    return respond(issue);
  },

  /* ── Family view ────────────────────────────────────────── */

  familyMoney(familyId: string) {
    const students = db.students.filter((s) => s.familyId === familyId && s.status !== "archived");
    return respond({
      threshold: db.settings.lowBalanceThreshold,
      catalog: db.packages.filter((p) => p.isActive),
      children: students.map((s) => {
        const enrollments = db.enrollments.filter((e) => e.studentId === s.id).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
        return {
          student: s,
          current: enrollments.find((e) => e.status === "active") ?? null,
          pending: enrollments.filter((e) => e.status === "pending"),
          history: enrollments.filter((e) => e.status === "closed"),
          payments: db.payments.filter((p) => p.studentId === s.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
          recentLedger: db.balanceEntries.filter((b) => enrollments.some((e) => e.id === b.enrollmentId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
        };
      }),
    });
  },
};

export type PaymentRow = Awaited<ReturnType<typeof financeApi.payments>>[number];
export type PayrollData = Awaited<ReturnType<typeof financeApi.payroll>>;
export type StatementData = Awaited<ReturnType<typeof financeApi.statement>>;
export type EntryRow = StatementData["entries"][number];
export type FamilyMoney = Awaited<ReturnType<typeof financeApi.familyMoney>>;
export const NEXT_PAYROLL_STATUS = NEXT;
