"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, Table, Td, Th, type BadgeVariant } from "@/components/ui";
import { ticketDomain, type Ticket } from "@/data/seed";

const CLOSED = ticketDomain.statuses[ticketDomain.statuses.length - 1];

function priorityVariant(p: Ticket["priority"]): BadgeVariant {
  return p === "P0" ? "solid" : p === "P1" ? "primary" : "neutral";
}

/** "26h" reads badly across days; switch to 天 above 48h. */
function fmtDur(ms: number): string {
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.max(1, Math.round(h))} 小时` : `${Math.round(h / 24)} 天`;
}

// Field roster with region/skills/load; swap to GET /engineers when the real API is wired.
const ENGINEERS = [
  { name: "周德旺", region: "华东区", skills: ["E117 伺服报警", "E204 主轴异响"], active: 2 },
  { name: "吴小军", region: "华东区", skills: ["E301 冷却液泄漏"], active: 1 },
  { name: "郑海涛", region: "华北区", skills: ["E009 系统死机", "E117 伺服报警"], active: 3 },
  { name: "马向东", region: "华南区", skills: ["E204 主轴异响", "E301 冷却液泄漏"], active: 4 },
];

/** 客户口诀「先看远近再看忙闲」: skill fit first, then the lightest active load. */
function suggestEngineers(ticket: Ticket) {
  const fault = ticket.title.split("·")[1]?.trim() ?? "";
  return [...ENGINEERS]
    .map((e) => ({ ...e, fit: e.skills.includes(fault) ? 1 : 0 }))
    .sort((a, b) => b.fit - a.fit || a.active - b.active)
    .slice(0, 3)
    .map((e) => ({
      name: e.name,
      reason: `${e.fit ? `擅长${fault}` : "可支援"} · ${e.region}常驻 · 在修 ${e.active} 单`,
    }));
}

function statusVariant(s: string): BadgeVariant {
  return s === CLOSED ? "accent" : s === "待处理" ? "neutral" : "primary";
}

/** Table + slide-out detail panel — the 80% pattern of enterprise systems. */
export function ListDetail({
  tickets,
  terms,
  anchor,
  scopeLabel,
}: {
  tickets: Ticket[];
  terms: Record<string, string>;
  anchor: number;
  scopeLabel: string;
}) {
  const [selected, setSelected] = useState<Ticket | null>(null);
  const overdue = selected && selected.status !== CLOSED && selected.dueAt < anchor;

  // Deep-link a ticket (?open=BX-10248) — lets the presenter jump straight to one.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setSelected(tickets.find((t) => t.id === id) ?? null);
  }, [tickets]);

  // Overdue open tickets pinned first (most overdue on top), closed sink to the bottom.
  const sorted = [...tickets].sort((a, b) => {
    const aClosed = a.status === CLOSED;
    const bClosed = b.status === CLOSED;
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    return a.dueAt - b.dueAt;
  });

  return (
    <section>
      <Card>
        <CardHeader
          title={`${terms.item ?? "工单"}列表`}
          extra={
            <span className="text-xs text-[var(--muted)]">
              {scopeLabel} {tickets.length} 条 · 点击行查看详情
            </span>
          }
        />
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>{terms.id ?? "编号"}</Th>
                <Th>{terms.title ?? "标题"}</Th>
                <Th>{terms.priority ?? "优先级"}</Th>
                <Th>{terms.dueAt ?? "SLA"}</Th>
                <Th>{terms.owner ?? "负责人"}</Th>
                <Th>{terms.status ?? "状态"}</Th>
                <Th>{terms.createdAt ?? "创建时间"}</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className={`cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--brand-primary)_6%,transparent)] ${
                    selected?.id === t.id
                      ? "bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]"
                      : t.status !== CLOSED && t.dueAt < anchor
                        ? "bg-red-500/5"
                        : ""
                  }`}
                >
                  <Td className="font-mono text-xs text-[var(--muted)]">{t.id}</Td>
                  <Td className="max-w-64 truncate font-medium">{t.title}</Td>
                  <Td>
                    <Badge variant={priorityVariant(t.priority)}>{t.priority}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {t.status === CLOSED ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : t.dueAt < anchor ? (
                      <span className="font-semibold text-red-600">已超时 {fmtDur(anchor - t.dueAt)}</span>
                    ) : (
                      <span>剩余 {fmtDur(t.dueAt - anchor)}</span>
                    )}
                  </Td>
                  <Td>{t.owner}</Td>
                  <Td>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums text-[var(--muted)]">
                    {t.createdAtText}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {/* Overlay */}
      <div
        className={`fixed inset-0 z-30 bg-black/25 transition-opacity duration-200 ${
          selected ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setSelected(null)}
      />

      {/* Slide-out detail panel */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-[400px] max-w-[90vw] border-l border-[var(--border)] bg-[var(--panel)] shadow-xl transition-transform duration-300 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <span className="font-mono text-sm text-[var(--muted)]">{selected.id}</span>
              <button
                onClick={() => setSelected(null)}
                className="rounded-[var(--brand-radius)] border border-[var(--border)] px-2 py-0.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <h2 className="text-base font-semibold leading-snug">{selected.title}</h2>
              <div className="flex flex-wrap gap-2">
                <Badge variant={priorityVariant(selected.priority)}>{selected.priority}</Badge>
                <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
                {overdue && <Badge variant="solid">SLA 已超时</Badge>}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {(
                  [
                    [terms.owner ?? "负责人", selected.owner],
                    [terms.sla ?? "SLA", `${selected.slaHours} 小时`],
                    [terms.createdAt ?? "创建时间", selected.createdAtText],
                    [terms.dueAt ?? "截止时间", selected.dueAtText],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-[var(--muted)]">{k}</dt>
                    <dd className="mt-0.5 tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>

              {selected.status === "待派工" && (
                <div>
                  <div className="mb-1 text-xs text-[var(--muted)]">
                    建议派工 <span className="text-[var(--muted)]">（先看远近，再看忙闲）</span>
                  </div>
                  <ul className="divide-y divide-[var(--border)] rounded-[var(--brand-radius)] border border-[var(--border)]">
                    {suggestEngineers(selected).map((s, i) => (
                      <li key={s.name} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-medium">{i + 1}. {s.name}</span>
                          <span className="ml-2 text-xs text-[var(--muted)]">{s.reason}</span>
                        </div>
                        <button className="shrink-0 rounded-[var(--brand-radius)] bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">
                          派工
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1 text-xs text-[var(--muted)]">处理说明</div>
                <p className="rounded-[var(--brand-radius)] border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed">
                  {selected.detail}
                </p>
              </div>
            </div>

            <div className="flex gap-2 border-t border-[var(--border)] px-5 py-4">
              <button className="flex-1 rounded-[var(--brand-radius)] bg-[var(--brand-primary)] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                标记完成
              </button>
              <button className="flex-1 rounded-[var(--brand-radius)] border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--bg)]">
                转派{terms.owner ?? "负责人"}
              </button>
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}
