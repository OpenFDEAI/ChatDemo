import { Card, CardBody, CardHeader, StatCard } from "@/components/ui";
import { ticketDomain, type Ticket } from "@/data/seed";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 4 KPI cards + a dependency-free SVG bar chart (new tickets, last 14 days). */
export function Dashboard({
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
  const closedStatus = ticketDomain.statuses[ticketDomain.statuses.length - 1];
  const open = tickets.filter((t) => t.status !== closedStatus);
  const highPriority = open.filter((t) => t.priority === "P0" || t.priority === "P1");
  const slaRisk = open.filter((t) => t.dueAt < anchor + 24 * HOUR);
  const recent = tickets.filter((t) => t.createdAt > anchor - 7 * DAY);

  // Daily buckets aligned to UTC+8 midnights.
  const dayStart = Math.floor((anchor + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
  const days = Array.from({ length: 14 }, (_, i) => dayStart - (13 - i) * DAY);
  const counts = days.map(
    (d) => tickets.filter((t) => t.createdAt >= d && t.createdAt < d + DAY).length
  );
  const max = Math.max(...counts, 1);
  const BW = 24; // slot width per bar

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={`未结${terms.item ?? "工单"}`}
          value={open.length}
          hint={`${scopeLabel}共 ${tickets.length} 条`}
        />
        <StatCard label="高优先级未结" value={highPriority.length} hint="P0 / P1" highlight />
        <StatCard
          label="SLA 风险"
          value={slaRisk.length}
          hint="24 小时内到期或已超时"
          highlight
        />
        <StatCard label="近 7 天新增" value={recent.length} hint={`含${closedStatus}`} />
      </div>

      <Card>
        <CardHeader
          title={`近 14 天新增${terms.item ?? "工单"}`}
          extra={<span className="text-xs text-[var(--muted)]">{scopeLabel}</span>}
        />
        <CardBody>
          <svg viewBox={`0 0 ${days.length * BW} 104`} className="h-28 w-full">
            {counts.map((c, i) => {
              const h = (c / max) * 72;
              return (
                <g key={days[i]}>
                  <rect
                    x={i * BW + 5}
                    y={86 - h}
                    width={BW - 10}
                    height={h + 2}
                    rx={2}
                    fill="var(--brand-primary)"
                    opacity={i === counts.length - 1 ? 1 : 0.55}
                  />
                  <text
                    x={i * BW + BW / 2}
                    y={100}
                    textAnchor="middle"
                    fontSize={7}
                    fill="var(--muted)"
                  >
                    {new Date(days[i] + 8 * HOUR).getUTCDate()}
                  </text>
                </g>
              );
            })}
            <line
              x1={0}
              y1={88.5}
              x2={days.length * BW}
              y2={88.5}
              stroke="var(--border)"
              strokeWidth={1}
            />
          </svg>
        </CardBody>
      </Card>
    </section>
  );
}
