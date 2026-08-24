import { tauriConfig } from "./wdio.shared.js";

/** Separate run for specs needing the p2p log, which is the only fixture with event attributes. */
export const config = tauriConfig({ ocel: "p2p.xml.gz", specs: "specs-p2p/**/*.e2e.ts" });
