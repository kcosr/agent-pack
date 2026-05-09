import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

chmodSync(fileURLToPath(new URL("../dist/cli/main.js", import.meta.url)), 0o755);
