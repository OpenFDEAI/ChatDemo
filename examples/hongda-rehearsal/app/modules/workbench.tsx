"use client";

import { useEffect, useMemo, useState } from "react";
import type { Theme } from "@/lib/theme";
import type { Ticket } from "@/data/seed";
import { ROLES, TopBar, type Role } from "@/modules/topbar";
import { Dashboard } from "@/modules/dashboard";
import { ListDetail } from "@/modules/list-detail";

/** Client shell: holds the fake-login role and assembles the prefab modules. */
export default function Workbench({
  theme,
  tickets,
  anchor,
}: {
  theme: Theme;
  tickets: Ticket[];
  anchor: number;
}) {
  const [role, setRole] = useState<Role>("admin");

  // Deep-link the persona (?role=agent) so a rehearsal or projector can jump views.
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("role");
    if (r === "agent" || r === "admin") setRole(r);
  }, []);

  // Role switch produces a visible difference: agents only see their own items.
  const visible = useMemo(
    () => (role === "agent" ? tickets.filter((t) => t.owner === ROLES.agent.persona) : tickets),
    [role, tickets]
  );
  const scopeLabel = role === "agent" ? "我负责的" : "全部";

  return (
    <div className="min-h-screen">
      <TopBar
        brand={theme.brand}
        workspace={theme.terms.workspace ?? "演示环境"}
        role={role}
        onRoleChange={setRole}
      />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <Dashboard tickets={visible} terms={theme.terms} anchor={anchor} scopeLabel={scopeLabel} showAssessment={role !== "agent"} />
        <ListDetail tickets={visible} terms={theme.terms} anchor={anchor} scopeLabel={scopeLabel} />
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-[var(--muted)]">
        演示环境 · 数据由确定性种子生成，仅供现场演示
      </footer>
    </div>
  );
}
