"use client";

import React, { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function UserSessionCard() {
  const { data: session } = useSession();
  const [error, setError] = useState(false);

  if (!session?.user) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-teal-100 border border-teal-300 flex items-center justify-center font-bold text-teal-800 uppercase">
            {session.user.name?.[0] || "م"}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{session.user.name}</p>
            <p className="text-xs text-slate-600">{session.sessionUnavailable ? "تعذر التحقق من حالة الجلسة" : "تم تسجيل الدخول بأمان"}</p>
          </div>
        </div>
        <Badge variant={session.sessionUnavailable ? "warning" : "success"} size="sm" className={session.sessionUnavailable ? "border-amber-300 bg-amber-50 text-amber-800" : "border-teal-300 bg-teal-50 text-teal-800"}>
          {session.sessionUnavailable ? "تعذر فحص الجلسة" : "جلسة نشطة"}
        </Badge>
      </div>

      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-slate-600">اسم الحساب:</span>
          <span className="text-slate-900">{session.user.name}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-600">حالة الحساب:</span>
          <span className="text-slate-900">{session.sessionUnavailable ? "غير متاحة مؤقتًا" : "موثّق"}</span>
        </div>

      </div>

      {session.sessionUnavailable && <p role="alert" className="text-sm text-amber-700">تعذر التحقق من جلستك الآن. حاول مرة أخرى بعد قليل.</p>}
      {error && <p role="alert" className="text-sm text-amber-700">تعذر تسجيل الخروج. حاول مرة أخرى.</p>}
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={async () => {
          setError(false);
          try {
            const result = await signOut({ redirect: false });
            if (!result?.url) setError(true);
          } catch { setError(true); }
        }}
      >
        تسجيل الخروج
      </Button>
    </div>
  );
}
