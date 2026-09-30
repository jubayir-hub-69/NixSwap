import { writeFrontendConfig } from "./frontend-config";

async function main() {
  await writeFrontendConfig({});
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
