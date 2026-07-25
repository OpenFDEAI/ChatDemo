"use client";

import type { Theme } from "@/lib/theme";

export type Role = "admin" | "agent";

export const ROLES: Record<Role, { label: string; persona: string }> = {
  admin: { label: "管理员", persona: "王明远" },
  // Persona must match an owner in data/seed.ts for role-based filtering.
  agent: { label: "一线员工", persona: "赵一鸣" },
};

export function TopBar({
  brand,
  workspace,
  role,
  onRoleChange,
}: {
  brand: Theme["brand"];
  workspace: string;
  role: Role;
  onRoleChange: (r: Role) => void;
}) {
  const persona = ROLES[role].persona;
  return (
    <header className="sticky top-0 z-20 bg-[var(--panel-dark)] text-[#f4f3f0]">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
        <span className="flex h-7 min-w-7 items-center justify-center rounded-[var(--brand-radius)] bg-[var(--brand-primary)] px-1 text-xs font-bold text-white">
          {brand.logoText}
        </span>
        <span className="text-sm font-semibold tracking-wide">{brand.name}</span>
        <span className="text-white/25">/</span>
        <span className="text-sm text-white/70">{workspace}</span>

        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs text-white/50">当前视角</label>
          <select
            value={role}
            onChange={(e) => onRoleChange(e.target.value as Role)}
            className="h-8 rounded-[var(--brand-radius)] border border-white/20 bg-transparent px-2 text-sm text-white outline-none [&>option]:text-black"
          >
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-2 rounded-[var(--brand-radius)] border border-white/15 px-2.5 py-1 text-xs text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]" />
            {persona} · 已登录
          </span>
        </div>
      </div>
    </header>
  );
}
