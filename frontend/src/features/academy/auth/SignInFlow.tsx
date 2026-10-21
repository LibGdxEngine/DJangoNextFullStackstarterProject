"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, GraduationCap, Home } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { COUNTRY_CODES, Field, Input, PhoneInput } from "@/components/ds/Field";
import { InfoNote } from "@/components/ds/Panels";
import { LanguageSwitch, LogoMark, useAcademyName } from "@/components/shells/ShellParts";
import { academyApi } from "../api";
import type { Workspace } from "../types";

type Stage = "phone" | "code" | "workspace";
const MAX_ATTEMPTS = 5;

export function SignInFlow() {
  const { t, tag } = useI18n();
  const s = t.signIn;
  const router = useRouter();
  const academyName = useAcademyName();
  const [stage, setStage] = useState<Stage>("phone");
  const [countryCode, setCountryCode] = useState("+20");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (stage === "code") codeRef.current?.focus();
  }, [stage]);

  const digits = COUNTRY_CODES.find((c) => c.code === countryCode)?.digits ?? 10;
  const locked = attempts >= MAX_ATTEMPTS;

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    const clean = phone.replace(/\s/g, "");
    if (clean.length !== digits) {
      setPhoneError(s.phoneInvalid(digits));
      return;
    }
    setPhoneError(null);
    setBusy(true);
    const result = await academyApi.requestCode(`${countryCode}${clean}`);
    setBusy(false);
    setCode("");
    setCodeError(null);
    setResendIn(result.resendAfterSeconds);
    setStage("code");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (locked) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError(s.codeFormat);
      return;
    }
    setBusy(true);
    try {
      const result = await academyApi.verifyCode(code);
      setWorkspaces(result.workspaces);
      if (result.workspaces.length === 1) router.push(pathFor(result.workspaces[0]));
      else setStage("workspace");
    } catch (err) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      const reason = err instanceof Error ? err.message : "invalid";
      setCodeError(reason === "expired" ? s.codeExpired : nextAttempts >= MAX_ATTEMPTS ? s.tooMany : s.codeWrong(MAX_ATTEMPTS - nextAttempts));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const minutes = Math.floor(resendIn / 60);
  const seconds = String(resendIn % 60).padStart(2, "0");

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[15px] font-semibold">{academyName}</span>
        </div>
        <LanguageSwitch />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <Card className="flex w-full max-w-[420px] flex-col gap-5 p-6 sm:p-8">
          {stage === "phone" && (
            <form onSubmit={sendCode} noValidate className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold">{s.title}</h1>
                <p className="text-[13px] text-muted">{s.subtitle}</p>
              </div>
              <Field label={s.phone} required error={phoneError} hint={s.phoneHint}>
                {(p) => <PhoneInput countryCode={countryCode} onCountryCodeChange={setCountryCode} value={phone} onChange={(v) => { setPhone(v); setPhoneError(null); }} countryLabel={t.addStudent.countryCode} fieldProps={p} autoFocus />}
              </Field>
              <Button type="submit" variant="primary" size="md" disabled={busy} className="w-full">{busy ? t.common.working : s.sendCode}</Button>
              <p className="text-xs leading-relaxed text-muted">{s.privacy}</p>
            </form>
          )}

          {stage === "code" && (
            <form onSubmit={verify} noValidate className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold">{s.codeTitle}</h1>
                <p className="text-[13px] text-muted">
                  {s.codeSent} <span dir="ltr" className="font-medium text-ink tabular">{countryCode} {phone}</span>{" "}
                  <button type="button" className="font-medium text-brand-700 underline-offset-2 hover:underline" onClick={() => { setStage("phone"); setAttempts(0); }}>{s.changeNumber}</button>
                </p>
              </div>
              <Field label={s.code} required error={codeError}>
                {(p) => (
                  <Input
                    {...p}
                    ref={codeRef}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    disabled={locked}
                    value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setCodeError(null); }}
                    className="h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" disabled={busy || locked || code.length !== 6} className="w-full">{busy ? t.common.working : s.verify}</Button>
              <div className="flex items-center justify-center text-[13px]" aria-live="polite">
                {resendIn > 0 ? (
                  <span className="text-muted tabular">{s.resendIn(`${formatNumber(minutes, tag)}:${seconds.split("").map((d) => formatNumber(Number(d), tag)).join("")}`)}</span>
                ) : (
                  <Button variant="tertiary" size="sm" onClick={() => { setAttempts(0); void sendCode(); }}>{s.resend}</Button>
                )}
              </div>
              <InfoNote>{s.demoHint}</InfoNote>
            </form>
          )}

          {stage === "workspace" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold">{s.workspaceTitle}</h1>
                <p className="text-[13px] text-muted">{s.workspaceSubtitle}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {workspaces.map((w) => {
                  const Icon = w === "management" ? Briefcase : w === "teacher" ? GraduationCap : Home;
                  return (
                    <li key={w}>
                      <button type="button" onClick={() => router.push(pathFor(w))} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3.5 text-start hover:border-brand-300 hover:bg-brand-50">
                        <span className="flex size-10 items-center justify-center rounded-[10px] bg-brand-100 text-brand-800"><Icon aria-hidden className="size-5" /></span>
                        <span className="flex flex-1 flex-col">
                          <span className="text-sm font-semibold">{t.workspaces[w]}</span>
                          <span className="text-xs text-muted">{s.workspaceHint[w]}</span>
                        </span>
                        <ArrowRight aria-hidden className="size-4 text-muted rtl:-scale-x-100" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted">{s.switchLater}</p>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function pathFor(workspace: Workspace): string {
  return workspace === "management" ? "/manage" : `/${workspace}`;
}
