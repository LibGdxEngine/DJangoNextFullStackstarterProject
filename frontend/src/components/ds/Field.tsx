"use client";

import React, { useId } from "react";
import { AlertCircle, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const control = "h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:border-line-soft disabled:bg-page disabled:text-muted aria-[invalid=true]:border-[1.5px] aria-[invalid=true]:border-danger";

interface FieldRenderProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

/**
 * Label + control + hint/error/success. The render prop receives the ids and
 * aria attributes so inline validation is announced with the control.
 */
export function Field({ label, required, optionalLabel, hint, error, success, className, labelAddon, children }: {
  label: React.ReactNode;
  required?: boolean;
  optionalLabel?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  success?: React.ReactNode;
  className?: string;
  labelAddon?: React.ReactNode;
  children: (props: FieldRenderProps) => React.ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-msg`;
  const message = error ?? success ?? hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
        {label}
        {required && <span aria-hidden className="text-danger">*</span>}
        {optionalLabel && <span className="font-normal text-muted">({optionalLabel})</span>}
        {labelAddon}
      </label>
      {children({
        id,
        "aria-describedby": message ? messageId : undefined,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}
      {message && (
        <div
          id={messageId}
          className={cn("flex items-center gap-1.5 text-xs", error ? "text-danger" : success ? "text-success" : "text-muted")}
          role={error ? "alert" : undefined}
        >
          {error && <AlertCircle aria-hidden className="size-3.5 shrink-0" />}
          {!error && success && <Check aria-hidden className="size-3.5 shrink-0" />}
          {message}
        </div>
      )}
    </div>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "h-auto min-h-20 resize-y py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "appearance-none pe-9")} {...props}>{children}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex items-center gap-2 text-[13px] text-secondary", className)}>
      <input type="checkbox" className="size-4 accent-brand-800" {...props} />
      {label}
    </label>
  );
}

export const COUNTRY_CODES = [
  { code: "+20", label: "EG +20", digits: 10 },
  { code: "+966", label: "SA +966", digits: 9 },
  { code: "+971", label: "AE +971", digits: 9 },
  { code: "+90", label: "TR +90", digits: 10 },
  { code: "+44", label: "UK +44", digits: 10 },
  { code: "+1", label: "US/CA +1", digits: 10 },
] as const;

/** Country code + number. Numbers stay LTR inside RTL layouts. */
export function PhoneInput({ countryCode, onCountryCodeChange, value, onChange, countryLabel, fieldProps, autoFocus }: {
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  value: string;
  onChange: (value: string) => void;
  countryLabel: string;
  fieldProps: FieldRenderProps;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex gap-2" dir="ltr">
      <Select aria-label={countryLabel} value={countryCode} onChange={(e) => onCountryCodeChange(e.target.value)} className="w-32 shrink-0">
        {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
      </Select>
      <Input
        {...fieldProps}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s]/g, ""))}
        className="tabular flex-1"
      />
    </div>
  );
}

export function SearchInput({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("relative flex items-center", className)}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute start-3 size-4 text-muted" />
      <input type="search" className={cn(control, "ps-9")} {...props} />
    </label>
  );
}

/** Large selectable option (radio semantics) for choices like "link existing family". */
export function ChoiceCard({ name, value, checked, onChange, title, description, icon }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <label className={cn(
      "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info",
      checked ? "border-brand-800 bg-brand-50" : "border-line bg-surface hover:bg-page",
    )}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      {icon && <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px]", checked ? "bg-brand-800 text-white" : "bg-subtle text-secondary")}>{icon}</span>}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        {description && <span className="text-xs leading-normal text-muted">{description}</span>}
      </span>
    </label>
  );
}
