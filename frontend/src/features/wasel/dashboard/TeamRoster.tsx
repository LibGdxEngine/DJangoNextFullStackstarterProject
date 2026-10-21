"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { agentApi, type AgentRole } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";
import { useRoles } from "./useCatalog";
import { useWorkspace } from "./workspace";

function RoleCard({ role, onRemove }: { role: AgentRole; onRemove: (role: AgentRole) => void }) {
  const busy = (role.active_runs ?? 0) > 0;
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] overflow-hidden rounded-[28px] border border-line bg-white">
      <div style={{ background: role.tint }}>
        <Image src={role.avatar} alt={role.name} width={160} height={200} className="h-full w-full object-cover" />
      </div>
      <div className="flex flex-col gap-2.5 p-[22px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-violet">{role.title}</span>
          <span className="text-xs" style={{ color: busy ? "#16A34A" : "#6B6880" }}>
            ● {busy ? "تعمل الآن" : "متاح"}
          </span>
        </div>
        <div className="text-2xl font-bold">{role.name}</div>
        {role.summary ? <div className="text-sm leading-relaxed text-muted">{role.summary}</div> : null}
        {role.skills && role.skills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {role.skills.map((skill) => (
              <span key={skill} className="rounded-full bg-[#F2F0F8] px-2.5 py-1 text-xs">
                {skill}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-1.5">
          <Link
            href={`/dashboard?role=${encodeURIComponent(role.id)}`}
            className="whitespace-nowrap rounded-full bg-ink px-[18px] py-2.5 text-sm font-semibold text-white hover:bg-violet"
          >
            كلّف {role.name} ←
          </Link>
          {role.is_builtin ? null : (
            <button
              onClick={() => onRemove(role)}
              className="whitespace-nowrap rounded-full border border-line px-3.5 py-2 text-[13px] hover:border-[#B91C1C] hover:text-[#B91C1C]"
            >
              إزالة
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HireForm({ organization, onHired, onClose }: {
  organization: string;
  onHired: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await agentApi.createRole({
        organization,
        name: name.trim(),
        title: title.trim(),
        summary: instructions.trim().slice(0, 300),
        instructions: instructions.trim(),
      });
      onHired();
    } catch (err) {
      setError(describeApiError(err).message);
      setSaving(false);
    }
  }

  const input = "w-full rounded-2xl border border-line bg-white px-4 py-3 text-[15px] outline-none focus:border-violet";
  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3 rounded-[28px] border border-line bg-white p-7">
      <div className="text-xl font-bold">وظّف دورًا جديدًا</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="الاسم، مثل: منى" aria-label="اسم الموظف" className={input} />
        <input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="الدور، مثل: مصممة سوشيال ميديا" aria-label="الدور" className={input} />
      </div>
      <textarea required value={instructions} onChange={(e) => setInstructions(e.target.value)}
        placeholder="صِف ما يفعله هذا الموظف وكيف يعمل…" aria-label="وصف الدور"
        className={`${input} min-h-[96px] resize-none`} />
      {error ? (
        <div role="alert" className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">{error}</div>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="rounded-full bg-amber px-[22px] py-3 text-[15px] font-semibold disabled:opacity-50">
          {saving ? "…" : "وظّف"}
        </button>
        <button type="button" onClick={onClose} className="rounded-full border border-line px-[22px] py-3 text-[15px]">
          إلغاء
        </button>
      </div>
    </form>
  );
}

export function TeamRoster() {
  const workspace = useWorkspace();
  const roles = useRoles();
  const [hiring, setHiring] = useState(false);
  const [error, setError] = useState<string>();

  async function remove(role: AgentRole) {
    setError(undefined);
    try {
      await agentApi.deleteRole(role.id);
      roles.reload();
    } catch (err) {
      setError(describeApiError(err).message);
    }
  }

  const message = error ?? roles.error;
  return (
    <>
      {message ? (
        <div role="alert" className="mt-6 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">{message}</div>
      ) : null}
      {roles.data ? (
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {roles.data.map((role) => (
            <RoleCard key={role.id} role={role} onRemove={(r) => void remove(r)} />
          ))}
        </div>
      ) : roles.error ? null : (
        <div className="mt-8 text-sm text-muted">جارٍ التحميل…</div>
      )}

      {hiring && workspace.status === "ready" ? (
        <HireForm
          organization={workspace.organization.id}
          onHired={() => {
            setHiring(false);
            roles.reload();
          }}
          onClose={() => setHiring(false)}
        />
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-5 rounded-[28px] border-[1.5px] border-dashed border-[#CFC6EA] p-7">
          <div>
            <div className="text-xl font-bold">تحتاج دورًا غير موجود؟</div>
            <div className="mt-1.5 text-sm text-muted">
              مصمم، مدرّب، باحث، محاسب — صِف الدور وسيجهّز واصل موظفًا بهذه المهارات.
            </div>
          </div>
          <button
            onClick={() => setHiring(true)}
            disabled={workspace.status !== "ready"}
            className="whitespace-nowrap rounded-full bg-amber px-[22px] py-3 text-[15px] font-semibold disabled:opacity-50"
          >
            ＋ وظّف دور جديد
          </button>
        </div>
      )}
    </>
  );
}
