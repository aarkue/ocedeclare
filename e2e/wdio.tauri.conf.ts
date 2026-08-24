import { tauriConfig } from "./wdio.shared.js";

/** The default run: everything that works against the order-management log. */
export const config = tauriConfig({ ocel: "order-management.xml.gz", specs: "specs/**/*.e2e.ts" });
