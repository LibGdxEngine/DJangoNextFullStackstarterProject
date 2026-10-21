"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "./Button";
import { Input } from "./Field";

/** Modal on the native <dialog>: focus trap, Esc to close, focus returns to the opener. */
export function Dialog({ open, onClose, title, context, children, footer, size = "md" }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  context?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-32px)] rounded-card bg-surface p-0 text-ink shadow-dialog",
        size === "md" ? "max-w-[480px]" : "max-w-[640px]",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-48px)] flex-col">
          <div className="flex items-start justify-between gap-3 px-5 pt-[18px]">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
              {context && <div className="text-[13px] text-muted tabular">{context}</div>}
            </div>
            <button type="button" aria-label={t.common.close} onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-page">
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px]">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-subtle px-5 pb-[18px] pt-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export interface Effect {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "plain" | "negative" | "positive";
}

/** The "What will happen" block every confirmation shows before the user commits. */
export function EffectsPreview({ effects, title }: { effects: Effect[]; title?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent-border bg-accent-50 px-3.5 py-3" aria-live="polite">
      <div className="text-xs font-semibold uppercase tracking-[0.05em] text-accent-ink">{title ?? t.common.whatWillHappen}</div>
      {effects.map((effect, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-secondary">{effect.label}</span>
          <span className={cn(
            "text-end font-semibold tabular",
            effect.tone === "negative" && "text-accent-ink",
            effect.tone === "positive" && "text-success",
          )}>{effect.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One frame for every confirmation: title + context → inputs → effects → actions.
 * Destructive confirms are red; irreversible ones require typing a word.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, context, children, effects, confirmLabel, cancelLabel, tone = "primary", typedConfirmation, canConfirm = true }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: React.ReactNode;
  context?: React.ReactNode;
  children?: React.ReactNode;
  effects?: Effect[];
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  tone?: "primary" | "danger";
  typedConfirmation?: string;
  canConfirm?: boolean;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation;

  function close() {
    setTyped("");
    setError(null);
    onClose();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setTyped("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.errorTitle);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      context={context}
      footer={(
        <>
          <Button onClick={close}>{cancelLabel ?? t.common.cancel}</Button>
          <Button variant={tone === "danger" ? "danger-solid" : "primary"} disabled={!canConfirm || !typedOk || busy} onClick={confirm}>
            {busy ? t.common.working : confirmLabel}
          </Button>
        </>
      )}
    >
      {children}
      {effects && effects.length > 0 && <EffectsPreview effects={effects} />}
      {typedConfirmation && (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-secondary">{t.common.typeToConfirm(typedConfirmation)}</span>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      )}
      {error && <div role="alert" className="text-danger">{error}</div>}
    </Dialog>
  );
}
