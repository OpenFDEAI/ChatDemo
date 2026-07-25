import type { ReactNode } from "react";

/** Hand-rolled shadcn-style primitives. Flat, bordered, CSS-variable driven. */

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-[var(--brand-radius)] border border-[var(--border)] bg-[var(--panel)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {extra}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export type BadgeVariant = "neutral" | "primary" | "solid" | "accent";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  neutral: "border-[var(--border)] text-[var(--muted)]",
  primary:
    "border-transparent text-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)]",
  solid: "border-transparent bg-[var(--brand-primary)] text-white",
  accent:
    "border-transparent text-[var(--brand-accent)] bg-[color-mix(in_srgb,var(--brand-accent)_12%,transparent)]",
};

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-[var(--brand-radius)] border px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[variant]}`}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight ? "text-[var(--brand-primary)]" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>}
    </Card>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-sm">{children}</table>;
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[var(--border)] px-4 py-2.5 text-left text-xs font-medium text-[var(--muted)] ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-[var(--border)] px-4 py-2.5 align-middle ${className}`}>
      {children}
    </td>
  );
}
