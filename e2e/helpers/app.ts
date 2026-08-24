import { $, browser } from "@wdio/globals";
import { trackConsoleErrors } from "./console-errors.js";

const ORIGIN = "tauri://localhost";

/**
 * Claim the single window once per session.
 *
 * The service probes window focus before every `$`, `$$` and click, through an IPC bridge that only
 * exists if the app imports the optional `@wdio/tauri-plugin`. Each probe then waits out a 5s
 * timeout: measured, five `$` calls take 100s. An explicit `switchWindow` marks the session as
 * user-switched and the service skips the probe, which brings those five calls to 25ms.
 */
let windowClaimed = false;
async function claimWindow(): Promise<void> {
  if (windowClaimed) return;
  windowClaimed = true;
  // The service reaches Tauri through `window.__wdio_original_core__`, which the optional
  // `@wdio/tauri-plugin` frontend import installs. `withGlobalTauri` already exposes the real thing,
  // and pointing the service at it keeps the test dependency out of the app's entry point.
  await browser.execute(() => {
    const w = window as unknown as { __wdio_original_core__?: unknown; __TAURI__?: { core?: unknown } };
    if (!w.__wdio_original_core__ && w.__TAURI__?.core) w.__wdio_original_core__ = w.__TAURI__.core;
  });
  try {
    await browser.tauri.switchWindow("main");
  } catch {
    // Speed only: a service version without switchWindow should still run.
  }
}

/**
 * Puts the app on a known route. Specs share one process, so without this each would inherit
 * wherever the previous one finished. Reloading keeps the loaded OCEL, which lives in the Rust
 * registry; only `initial_files` is drained, and nothing reads it again.
 */
export async function goto(path: string): Promise<void> {
  await claimWindow();
  await browser.url(`${ORIGIN}${path}`);
  await $("a[href='/ocel-info']").waitForExist({ timeout: 60_000 });
  await trackConsoleErrors();
}
