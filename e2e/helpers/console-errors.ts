import { browser } from "@wdio/globals";

/** Noise, not regressions. Keep this list short and justified. */
const IGNORED = [
  // rust4pm reports the p2p log's own dangling O2O references on import.
  "dropping O2O reference to unknown object id",
];

declare global {
  interface Window {
    __e2eErrors?: string[];
  }
}

/**
 * Collects errors in the page, because WebKitWebDriver has no `getLogs('browser')`. Installed after
 * navigation, so it sees what interaction triggers. A boot failure shows up as the page not
 * rendering at all.
 */
export async function trackConsoleErrors(): Promise<void> {
  await browser.execute(() => {
    if (window.__e2eErrors) return;
    const errors: string[] = [];
    window.__e2eErrors = errors;
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      errors.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" "));
      original(...args);
    };
    window.addEventListener("error", (e) => errors.push(`uncaught: ${e.message}`));
    window.addEventListener("unhandledrejection", (e) =>
      errors.push(`unhandled rejection: ${String(e.reason)}`),
    );
  });
}

export async function collectedErrors(): Promise<string[]> {
  const errors = (await browser.execute(() => window.__e2eErrors ?? [])) as string[];
  return errors.filter((e) => !IGNORED.some((i) => e.includes(i)));
}

/** Reports the messages themselves, not a count. */
export async function expectNoConsoleErrors(): Promise<void> {
  const errors = await collectedErrors();
  if (errors.length > 0) {
    throw new Error(`${errors.length} console error(s):\n  ${errors.join("\n  ")}`);
  }
}
