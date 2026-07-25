import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { loadTheme } from "@/lib/theme";
import "./globals.css";

export function generateMetadata(): Metadata {
  const t = loadTheme();
  return { title: `${t.brand.name} · ${t.terms.workspace ?? "演示环境"}` };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const t = loadTheme();
  // theme.json -> CSS variables. This is the whole branding mechanism:
  // components only ever reference var(--brand-*).
  const brandVars = {
    "--brand-primary": t.brand.primary,
    "--brand-accent": t.brand.accent,
    "--brand-radius": t.brand.radius,
  } as CSSProperties;

  return (
    <html lang="zh-CN" style={brandVars}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
