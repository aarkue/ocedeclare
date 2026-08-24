import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..");

/** Built by `pnpm build:app`, which passes --features wdio so the embedded WebDriver server exists. */
const APP_BINARY = path.join(REPO, "target", "release", "OCPQ");

export const fixture = (name: string) => path.join(REPO, "backend/ocpq-core/tests/data", name);

/**
 * One config per fixture log. The app holds a single OCEL for its whole lifetime and every spec in a
 * run shares that process. A spec needing a different log gets its own run; loading one mid-suite
 * would leave it there for everything after.
 */
export function tauriConfig(opts: { ocel: string; specs: string }): WebdriverIO.Config {
  return {
    runner: "local",
    specs: [path.join(HERE, opts.specs)],
    maxInstances: 1,
    capabilities: [
      {
        browserName: "wry",
        "wdio:tauriServiceOptions": {
          appBinaryPath: APP_BINARY,
          // On Linux the app turns non-flag argv into `initial_files` and imports the first one,
          // which is the only way in for WebDriver: the normal path is a native file dialog.
          appArgs: [fixture(opts.ocel)],
          driverProvider: "embedded",
          // GTK otherwise picks Wayland from the inherited WAYLAND_DISPLAY and never receives frame
          // callbacks, so WebKit parks its rendering loop: requestAnimationFrame and ResizeObserver
          // never fire, and React Flow leaves every node `visibility: hidden` because it cannot
          // measure them. `pnpm test` pairs this with Xvfb so the window is always unoccluded.
          env: { GDK_BACKEND: "x11" },
        },
      } as WebdriverIO.Capabilities,
    ],
    services: ["tauri"],
    framework: "mocha",
    reporters: ["spec"],
    logLevel: "warn",
    // The engine imports the log during startup, and each journey drives a real evaluation.
    waitforTimeout: 30_000,
    // Default is 500ms, which dominates everything here: evaluating 2000 orders takes the engine 4ms
    // and reaches the screen in ~145ms, which a default-interval poll turns into seconds of waiting.
    waitforInterval: 50,
    connectionRetryTimeout: 120_000,
    mochaOpts: { ui: "bdd", timeout: 180_000 },
  };
}
