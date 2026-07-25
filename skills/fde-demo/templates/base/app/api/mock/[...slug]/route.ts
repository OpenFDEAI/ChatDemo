import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

/**
 * Generic mock endpoint. Convention: data/mock-data.json maps
 * "<METHOD> /<path>" (e.g. "GET /orders") to a sample response. Keys may
 * contain OpenAPI-style path params ("GET /orders/{id}"), matched against
 * any concrete segment — this is what ingest-api.ts generates.
 * Unmatched requests get a JSON 404 so the demo fails loudly but gracefully.
 */
function matchTemplate(key: string, method: string, segments: string[]): boolean {
  const [keyMethod, keyPath] = key.split(" ", 2);
  if (keyMethod !== method || !keyPath) return false;
  const keySegments = keyPath.split("/").filter(Boolean);
  if (keySegments.length !== segments.length) return false;
  return keySegments.every((seg, i) => seg.startsWith("{") || seg === segments[i]);
}

async function handle(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const key = `${req.method} /${slug.join("/")}`;
  const file = path.join(process.cwd(), "data", "mock-data.json");
  if (fs.existsSync(file)) {
    const map = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (key in map) return NextResponse.json(map[key]);
    const template = Object.keys(map).find((k) => matchTemplate(k, req.method, slug));
    if (template) return NextResponse.json(map[template]);
  }
  return NextResponse.json({ error: "mock not found", key }, { status: 404 });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
