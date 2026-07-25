import fs from "node:fs";
import path from "node:path";

/**
 * Brand + terminology tokens. Edit theme.json (never components) to rebrand:
 * the root layout injects brand values as CSS variables, and modules read
 * all domain wording from `terms`.
 */
export interface Theme {
  brand: {
    name: string;
    logoText: string;
    primary: string;
    accent: string;
    radius: string;
  };
  terms: Record<string, string>;
}

export function loadTheme(): Theme {
  const file = path.join(process.cwd(), "theme.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Theme;
}
