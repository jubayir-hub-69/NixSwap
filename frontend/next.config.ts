import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

const baseAccountBrowser = path.join(
  frontendRoot,
  "node_modules/@base-org/account/dist/index.js",
);

// Turbopack deadlocks while tracing `@cofhe/sdk`. The npm scripts pass `--webpack`.
const nextConfig: NextConfig = {
  // The Hardhat app in the parent directory has its own lockfile. Keep
  // Turbopack rooted here so it does not treat that package as this app.
  turbopack: {
    root: frontendRoot,
    // SSR was resolving the Node export, which imports optional Coinbase
    // payment packages. Wallet connection only needs the browser SDK.
    resolveAlias: {
      "@base-org/account": "@base-org/account/browser",
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": baseAccountBrowser,
    };
    return config;
  },
};

export default nextConfig;
