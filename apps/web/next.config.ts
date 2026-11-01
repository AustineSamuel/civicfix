import type { NextConfig } from "next";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const config: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@civicfix/shared"],
  poweredByHeader: false
};

export default config;
