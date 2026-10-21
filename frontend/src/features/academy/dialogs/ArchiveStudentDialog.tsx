"use client";

import React, { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { ChoiceCard, Field, Input } from "@/components/ds/Field";
import { formatNumber } from "@/lib/format";
import { academyApi } from "../api";

export function ArchiveStudentDialog({ open, onClose, student, futureSessions, remainingBalance, onArchived }: {
  open: boolean;
  onClose: () => void;
  student: { id: string; name: string };
  futureSessions: number;
  remainingBalance: number;
  onArchived: () => void;
}) {
  const { t, tag } = useI18n();
  const d = t.dialogs.archive;
  const [handling, setHandling] = useState<"cancel" | "keep">("cancel");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const reasonError = touched && !reason.trim() ? d.reasonRequired : undefined;

  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        setReason("");
        setTouched(false);
        onClose();
      }}
      title={d.title(student.name)}
      context={d.context}
      tone="danger"
      confirmLabel={d.confirm}
      canConfirm={reason.trim().length > 0}
      onConfirm={async () => {
        await academyApi.setStudentStatus(student.id, "archived", handling);
        onArchived();
      }}
      effects={[
        { label: d.futureSessions, value: handling === "cancel" ? d.cancelledCount(futureSessions) : d.keptCount(futureSessions), tone: handling === "cancel" ? "negative" : "plain" },
        { label: d.balance, value: d.balanceKept(formatNumber(remainingBalance, tag)) },
        { label: d.notification, value: handling === "cancel" && futureSessions > 0 ? d.notifyFamily : d.noNotification },
      ]}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-medium text-secondary">{d.futureLegend(futureSessions)}</legend>
        <ChoiceCard name="future" value="cancel" checked={handling === "cancel"} onChange={() => setHandling("cancel")} title={d.cancelAll} description={d.cancelAllHint} />
        <ChoiceCard name="future" value="keep" checked={handling === "keep"} onChange={() => setHandling("keep")} title={d.keepAll} description={d.keepAllHint} />
      </fieldset>
      <Field label={d.reason} required error={reasonError}>
        {(props) => <Input {...props} value={reason} onBlur={() => setTouched(true)} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </ConfirmDialog>
  );
}
