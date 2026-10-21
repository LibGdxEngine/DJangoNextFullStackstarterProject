"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { SystemDiagnostics } from "@/features/system/components/SystemDiagnostics";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { UserSessionCard } from "@/features/auth/components/UserSessionCard";
import { ArchitectureGuide } from "@/features/overview/components/ArchitectureGuide";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500 selection:text-white p-6 sm:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-900">
          <div>
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-500/10">
                M
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mobser</h1>
              <Badge variant="success" size="sm">v1.0 Modular</Badge>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Decoupled SaaS Architecture: Reusable Platform Foundation + Dedicated Product Modules
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/docs/"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900 transition-colors"
            >
              OpenAPI Docs ↗
            </a>
            <a
              href="/admin/"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-100 hover:bg-zinc-700 transition-colors"
            >
              Django Admin ↗
            </a>
          </div>
        </div>

        {/* Main 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left / Primary Column (2 cols) */}
          <div className="lg:col-span-2 space-y-8">
            <SystemDiagnostics />
            <ArchitectureGuide />
          </div>

          {/* Right Column (1 col): Auth & Identity */}
          <div className="space-y-6">
            <Card
              title="Identity & Access"
              subtitle="NextAuth.js session mapped to Django SimpleJWT"
            >
              {sessionStatus === "loading" ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  Checking active authentication session...
                </div>
              ) : session?.accessToken ? (
                <UserSessionCard />
              ) : (
                <>
                  {session?.sessionExpired && (
                    <p role="alert" className="mb-4 text-sm text-amber-300">
                      Your session has expired. Please sign in again.
                    </p>
                  )}
                  <LoginForm />
                </>
              )}
            </Card>

            {/* Quick Architecture Summary */}
            <div className="p-4 rounded-xl border border-zinc-900 bg-zinc-950/40 text-xs space-y-2 text-zinc-400">
              <p className="font-semibold text-zinc-200">Architecture Structure</p>
              <p>
                Platform services run under <code className="text-emerald-400">backend/apps/</code> and feature components live in <code className="text-emerald-400">frontend/src/features/</code>.
              </p>
              <p>
                Domain features belong in <code className="text-purple-400">backend/product/</code> to keep cross-cutting SaaS code clean and reusable.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
