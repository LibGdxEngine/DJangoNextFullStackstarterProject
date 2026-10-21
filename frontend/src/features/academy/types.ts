/**
 * Academy domain types. Field names mirror backend/product/academy/models.py
 * (camelCased) so the fixture layer can be swapped for the generated API types.
 */

export type Lang = "ar" | "en";

export type Role = "admin" | "coordinator" | "accountant" | "teacher" | "family";
export type Workspace = "management" | "teacher" | "family";

export type Capability =
  | "manage_people"
  | "manage_schedule"
  | "report_lesson"
  | "approve_session"
  | "view_finance"
  | "manage_finance"
  | "manage_settings"
  | "manage_roles"
  | "view_internal"
  | "import"
  | "reports"
  | "own_earnings"
  | "request_change"
  | "submit_payment";

export type ConnectionStatus = "not_connected" | "pending" | "connected" | "action_required";

export interface AcademySettings {
  name: { en: string; ar: string };
  timezone: string;
  language: Lang;
  cancellationHours: number;
  lateCancelDeduct: boolean;
  lateCancelPayTeacher: boolean;
  reminderMinutes: number;
  lowBalanceThreshold: number;
  whatsappStatus: ConnectionStatus;
  paymentStatus: ConnectionStatus;
}

export interface FamilyContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  relationship: "parent" | "guardian" | "self";
  receivesNotifications: boolean;
}

export interface Family {
  id: string;
  name: string;
  timezone: string;
  language: Lang;
  isActive: boolean;
  contacts: FamilyContact[];
  createdAt: string;
}

export interface Teacher {
  id: string;
  name: string;
  phone: string;
  timezone: string;
  language: Lang;
  meetingUrl?: string;
  isActive: boolean;
  specialties: Program[];
  createdAt: string;
}

export interface TeacherRate {
  id: string;
  teacherId: string;
  amount: number;
  currency: string;
  basis: "session" | "hour";
  effectiveFrom: string;
}

/** Weekly availability; weekday 0 = Monday (Python convention). */
export interface Availability {
  id: string;
  teacherId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
}

export type Program = "memorization" | "recitation" | "tajweed" | "qaida";
export type StudentStatus = "active" | "paused" | "archived";

export interface Student {
  id: string;
  familyId: string;
  teacherId: string | null;
  name: string;
  birthDate: string | null;
  isAdult: boolean;
  language: Lang;
  timezone: string;
  status: StudentStatus;
  program: Program;
  createdAt: string;
}

export interface StudentNote {
  id: string;
  studentId: string;
  authorName: string;
  visibility: "internal" | "family";
  text: string;
  createdAt: string;
}

export interface Package {
  id: string;
  name: string;
  lessonCount: number;
  durationMinutes: number;
  validityDays: number;
  price: number;
  currency: string;
  isActive: boolean;
}

export interface Enrollment {
  id: string;
  renewedFrom?: string;
  studentId: string;
  packageId: string;
  packageName: string;
  lessonCount: number;
  durationMinutes: number;
  price: number;
  currency: string;
  startsOn: string;
  expiresOn: string;
  status: "pending" | "active" | "closed";
  balance: number;
}

export interface BalanceEntry {
  id: string;
  enrollmentId: string;
  sessionNumber?: number;
  delta: number;
  balanceAfter: number;
  kind: "activation" | "lesson" | "adjustment" | "cancellation";
  reason: string;
  actorName?: string;
  createdAt: string;
}

export type SessionStatus = "scheduled" | "needs_review" | "completed" | "cancelled";
export type Attendance = "unknown" | "present" | "late" | "absent";

export interface Session {
  id: string;
  number: number;
  studentId: string;
  teacherId: string;
  enrollmentId: string;
  startsAt: string;
  endsAt: string;
  status: SessionStatus;
  attendance: Attendance;
  seriesId?: string;
  actualMinutes?: number;
  lateMinutes?: number;
  cancelledBy?: "family" | "teacher" | "academy";
  cancelReason?: string;
  /** Original teacher when a substitute took the class. */
  substituteFor?: string;
  version: number;
}

/** Weekly pattern; `timezone` is the zone whose wall-clock time stays fixed. */
export interface RecurringSchedule {
  id: string;
  studentId: string;
  teacherId: string;
  enrollmentId: string;
  timezone: string;
  weekdays: number[];
  localTime: string;
  startsOn: string;
  endsOn: string;
  durationMinutes: number;
  isActive: boolean;
}

export interface LessonRecord {
  sessionId: string;
  authorName: string;
  familyNotes: string;
  internalNotes: string;
  homework: string;
  submittedAt: string;
}

export interface EarningEntry {
  id: string;
  teacherId: string;
  sessionId?: string;
  amount: number;
  currency: string;
  earnedOn: string;
  kind: "session" | "late_cancel" | "substitute" | "adjustment";
  reason: string;
  /** "2026-10": the payroll month this row is paid in. */
  payrollMonth: string;
  /** Set on a correction to an entry whose payroll was already closed. */
  adjustmentOf?: string;
  createdBy?: string;
}

export type PayrollStatus = "draft" | "reviewed" | "approved" | "paid";

/** One payroll per month (backend Payroll.month = first day of the month). */
export interface Payroll {
  month: string;
  status: PayrollStatus;
  reviewedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentReference?: string;
}

export interface EarningsIssue {
  id: string;
  teacherId: string;
  entryId?: string;
  sessionId?: string;
  description: string;
  status: "open" | "resolved";
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface HistoryEvent {
  id: string;
  entityId: string;
  at: string;
  actorName: string;
  action:
    | "created"
    | "reminder_sent"
    | "reminder_queued"
    | "report_submitted"
    | "completed"
    | "cancelled"
    | "rescheduled"
    | "substitute"
    | "attendance_corrected"
    | "reviewed";
  detail?: string;
}

export interface SessionRow extends Session {
  studentName: string;
  teacherName: string;
  studentTimezone: string;
  teacherTimezone: string;
  isAdult: boolean;
  reportDue: boolean;
  conflict: boolean;
}

export interface QuranProgress {
  id: string;
  studentId: string;
  sessionNumber: number;
  date: string;
  surah: number;
  ayahFrom: number;
  ayahTo: number;
  activity: "memorization" | "revision" | "recitation";
  rating: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface Payment {
  id: string;
  enrollmentId: string;
  studentId: string;
  familyId: string;
  amount: number;
  currency: string;
  reference: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  receiptName?: string;
  method?: string;
  /** Families upload receipts; staff can also record payments received directly. */
  source: "family_upload" | "staff_record";
  submittedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
}

/** Derived row for list pages. */
export interface StudentRow extends Student {
  familyName: string;
  teacherName: string | null;
  nextSession: Session | null;
  lessonsLeft: number;
  renewalDue: boolean;
}

export interface FamilyRow extends Family {
  studentCount: number;
  primaryContact: FamilyContact | null;
  lowBalanceCount: number;
  pendingPayments: number;
}

export interface TeacherRow extends Teacher {
  studentCount: number;
  weekSessions: number;
}

export type SetupStepKey =
  | "profile"
  | "locale"
  | "policy"
  | "packages"
  | "teachers"
  | "students"
  | "whatsapp"
  | "payments";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  connection?: ConnectionStatus;
}

/** Family-initiated change; the policy effect shown at submit time is snapshotted. */
export interface SessionRequest {
  id: string;
  sessionId: string;
  kind: "cancel" | "reschedule";
  reason: string;
  proposedStart?: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  createdAt: string;
  policy: { hoursNotice: number; late: boolean; deducts: boolean };
}

/** Teacher quick entries (mirrors LessonPreference.reusable_notes / remembered_selections). */
export interface LessonPreference {
  teacherId: string;
  reusableNotes: string[];
  remembered: {
    activity?: QuranProgress["activity"];
    rating?: QuranProgress["rating"];
    homework?: string;
    descending?: boolean;
  };
}

export interface MessageTemplate {
  id: string;
  name: string;
  /** Approved template id at the provider (HireAgents / WhatsApp Business). */
  providerTemplate: string;
  language: Lang;
  body: string;
  isActive: boolean;
}

export type AutomationEvent = "reminder" | "session_changed" | "low_balance" | "renewal";

export interface MessageAutomation {
  id: string;
  event: AutomationEvent;
  templateId: string;
  isEnabled: boolean;
}

export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "cancelled" | "action_required";

export interface OutboxMessage {
  id: string;
  familyId: string;
  studentId?: string;
  sessionId?: string;
  templateId: string;
  destination: string;
  variables: Record<string, string>;
  dueAt: string;
  status: MessageStatus;
  error?: string;
  sentAt?: string;
}

export interface WhatsAppConnection {
  provider: "HireAgents";
  channelId: string;
  sender: string;
  status: ConnectionStatus;
  since?: string;
  lastSuccessAt?: string;
  apiKeyConfigured: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: Role;
  isActive: boolean;
}

export interface ImportRow {
  [column: string]: string;
}
