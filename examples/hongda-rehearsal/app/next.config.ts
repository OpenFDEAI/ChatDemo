import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root so lockfiles in parent directories (e.g. when this
  // template lives inside a bigger repo) don't confuse Next's root inference.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
