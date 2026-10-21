"use client";

import React, { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/ds/Dialog";
import { Field, Input } from "@/components/ds/Field";
import { formatNumber } from "@/lib/format";
import { useAccess } from "../access";
import { academyApi } from "../api";

export function AdjustBalanceDialog({ open, onClose, enrollment, studentName, onAdjusted }: {
  open: boolean;
  onClose: () => void;
  enrollment: { id: string; packageName: string; balance: number };
  studentName: string;
  onAdjusted: () => void;
}) {
  const { t, tag } = useI18n();
  const { userName } = useAccess();
  const d = t.dialogs.adjust;
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const result = enrollment.balance + delta;
  const signed = delta > 0 ? `+${formatNumber(delta, tag)}` : `−${formatNumber(Math.abs(delta), tag)}`;
  const invalid = delta === 0 || result < 0;

  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        setDelta(1);
        setReason("");
        onClose();
      }}
      title={d.title}
      context={`${studentName} · ${enrollment.packageName}`}
      confirmLabel={d.confirm}
      canConfirm={!invalid && reason.trim().length > 0}
      onConfirm={async () => {
        await academyApi.adjustBalance(enrollment.id, delta, reason.trim(), userName);
        onAdjusted();
      }}
      effects={[
        { label: d.current, value: d.lessons(formatNumber(enrollment.balance, tag)) },
        { label: d.adjustment, value: signed, tone: delta < 0 ? "negative" : "positive" },
        { label: d.resulting, value: d.lessons(formatNumber(result, tag)) },
        { label: d.ledger, value: d.ledgerNote },
      ]}
    >
      <Field label={d.adjustment} required error={result < 0 ? d.belowZero : delta === 0 ? d.nonZero : undefined} hint={d.adjustmentHint}>
        {(props) => (
          <div className="flex items-center gap-2">
            <button type="button" aria-label={d.decrease} onClick={() => setDelta((v) => v - 1)} className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface"><Minus aria-hidden className="size-4" /></button>
            <Input {...props} type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(Number.parseInt(e.target.value || "0", 10))} className="w-24 text-center tabular" />
            <button type="button" aria-label={d.increase} onClick={() => setDelta((v) => v + 1)} className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface"><Plus aria-hidden className="size-4" /></button>
          </div>
        )}
      </Field>
      <Field label={d.reason} required hint={d.reasonHint}>
        {(props) => <Input {...props} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={d.reasonPlaceholder} />}
      </Field>
    </ConfirmDialog>
  );
}
