/**
 * Package version, derived at load time from package.json so the MCP server
 * handshake and the outgoing User-Agent header can never drift from the
 * published version (`npm version` rewrites package.json only). Both `src/` and
 * the compiled `dist/` sit one directory below the package root, so package.json
 * is always one level up — and it is present in every npm install.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const pkgPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

export const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(pkgPath, "utf8"),
).version;
