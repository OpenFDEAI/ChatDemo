/**
 * Deterministic seed data generator (no faker, no deps).
 * Same seed -> same dataset, so server render, client render and
 * screenshots stay stable. Swap `DomainConfig` to re-skin the domain.
 */

export type Priority = "P0" | "P1" | "P2" | "P3";

export interface Ticket {
  id: string;
  title: string;
  priority: Priority;
  slaHours: number;
  owner: string;
  status: string;
  createdAt: number; // epoch ms
  dueAt: number; // epoch ms
  createdAtText: string;
  dueAtText: string;
  detail: string;
}

export interface DomainConfig {
  idPrefix: string;
  subjects: string[];
  issues: string[];
  owners: string[];
  /** Last entry is treated as the closed state. */
  statuses: string[];
}

export const ticketDomain: DomainConfig = {
  idPrefix: "GD",
  subjects: [
    "3 号线空压机",
    "包装线 PLC",
    "AGV 调度网关",
    "MES 车间终端",
    "视觉质检工位",
    "立体库堆垛机",
    "锅炉房 DCS",
    "厂区门禁系统",
  ],
  issues: [
    "通讯中断",
    "报警频发",
    "数据不同步",
    "固件升级请求",
    "参数漂移",
    "备件更换",
    "巡检异常",
    "接口超时",
  ],
  owners: ["赵一鸣", "钱建国", "孙丽华", "李慧敏", "周天成"],
  statuses: ["待处理", "处理中", "待验收", "已完成"],
};

/** mulberry32: tiny 32-bit PRNG, good enough for demo data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Fixed "now" so the dataset (and SLA math) is reproducible: 2026-07-24 09:30 UTC+8. */
export const DEFAULT_ANCHOR = Date.UTC(2026, 6, 24, 1, 30);

/** Format epoch ms as "MM-DD HH:mm" in fixed UTC+8, independent of host timezone. */
function fmt(ms: number): string {
  const d = new Date(ms + 8 * HOUR);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const SLA_BY_PRIORITY: Record<Priority, number> = { P0: 4, P1: 8, P2: 24, P3: 72 };

export function generateTickets(
  opts: { seed?: number; count?: number; domain?: DomainConfig; anchor?: number } = {}
): Ticket[] {
  const { seed = 42, count = 36, domain = ticketDomain, anchor = DEFAULT_ANCHOR } = opts;
  const rand = mulberry32(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  const tickets: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    const priority: Priority = r < 0.08 ? "P0" : r < 0.28 ? "P1" : r < 0.68 ? "P2" : "P3";
    const slaHours = SLA_BY_PRIORITY[priority];
    const ageDays = rand() * 14;
    const createdAt = anchor - Math.floor(ageDays * DAY);
    const dueAt = createdAt + slaHours * HOUR;
    // Older tickets are more likely to be closed already.
    const closed = rand() < Math.min(0.85, ageDays / 12 + 0.1);
    const status = closed
      ? domain.statuses[domain.statuses.length - 1]
      : domain.statuses[Math.floor(rand() * (domain.statuses.length - 1))];
    const subject = pick(domain.subjects);
    const issue = pick(domain.issues);
    const owner = pick(domain.owners);
    tickets.push({
      id: `${domain.idPrefix}-${String(10240 + i)}`,
      title: `${subject}${issue}`,
      priority,
      slaHours,
      owner,
      status,
      createdAt,
      dueAt,
      createdAtText: fmt(createdAt),
      dueAtText: fmt(dueAt),
      detail: `现场反馈：${subject}出现「${issue}」，已按 ${priority} 级建单，SLA 时限 ${slaHours} 小时。请${owner}在时限内处理并回填处理记录，完成后交由班组长验收。`,
    });
  }
  return tickets.sort((a, b) => b.createdAt - a.createdAt);
}
