"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function ArchitectureGuide() {
  const [activeTab, setActiveTab] = useState<"platform" | "commands" | "links">("platform");

  return (
    <Card
      title="Architecture & Platform Modules"
      subtitle="Modular separation between reusable platform layers and product modules"
    >
      <div className="space-y-4">
        {/* Tab Buttons */}
        <div className="flex border-b border-zinc-800 gap-2">
          <button
            onClick={() => setActiveTab("platform")}
            className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "platform"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Platform Structure
          </button>
          <button
            onClick={() => setActiveTab("commands")}
            className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "commands"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            CLI Commands
          </button>
          <button
            onClick={() => setActiveTab("links")}
            className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "links"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Quick Links
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === "platform" && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-emerald-400">apps.accounts</span>
                  <Badge variant="info" size="sm">Platform</Badge>
                </div>
                <p className="text-zinc-400">
                  Custom User model with UUID primary key, SimpleJWT auth endpoints, and user profile management.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-emerald-400">apps.organizations</span>
                  <Badge variant="info" size="sm">Platform</Badge>
                </div>
                <p className="text-zinc-400">
                  Multi-tenancy engine with Organization workspaces, memberships, and role hierarchies (Owner, Admin, Member).
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-emerald-400">apps.billing</span>
                  <Badge variant="info" size="sm">Platform</Badge>
                </div>
                <p className="text-zinc-400">
                  Customer mapping, subscription plan definitions, and multi-tenant billing status.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-emerald-400">apps.notifications</span>
                  <Badge variant="info" size="sm">Platform</Badge>
                </div>
                <p className="text-zinc-400">
                  In-app notifications and Celery-powered asynchronous messaging workers.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-emerald-400">apps.audit</span>
                  <Badge variant="info" size="sm">Platform</Badge>
                </div>
                <p className="text-zinc-400">
                  Immutable audit logging service recording actors, operations, IP addresses, and resource metadata.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-purple-400">product/</span>
                  <Badge variant="neutral" size="sm">Product</Badge>
                </div>
                <p className="text-zinc-400">
                  Reserved namespace for Mobser domain-specific business logic, kept decoupled from reusable SaaS infrastructure.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "commands" && (
          <div className="space-y-2 text-xs font-mono">
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 flex justify-between">
              <span className="text-zinc-300">make up</span>
              <span className="text-zinc-500"># Start full Docker development stack</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 flex justify-between">
              <span className="text-zinc-300">make migrate</span>
              <span className="text-zinc-500"># Apply database migrations across platform apps</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 flex justify-between">
              <span className="text-zinc-300">make seed</span>
              <span className="text-zinc-500"># Seed development database with sample user and org</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 flex justify-between">
              <span className="text-zinc-300">make prod-build && make prod-up</span>
              <span className="text-zinc-500"># Deploy multi-stage production stack</span>
            </div>
          </div>
        )}

        {activeTab === "links" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <a
              href="/api/docs/"
              target="_blank"
              rel="noreferrer"
              className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 block transition-colors"
            >
              <p className="font-semibold text-emerald-400">Swagger API Docs ↗</p>
              <p className="text-zinc-400 mt-1">Interactive OpenAPI 3.0 documentation generated via drf-spectacular</p>
            </a>
            <a
              href="/admin/"
              target="_blank"
              rel="noreferrer"
              className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 block transition-colors"
            >
              <p className="font-semibold text-emerald-400">Django Admin Console ↗</p>
              <p className="text-zinc-400 mt-1">Manage Users, Organizations, Plans, Subscriptions, and Audit Logs</p>
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
