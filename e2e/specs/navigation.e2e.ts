import { $, browser } from "@wdio/globals";
import { goto } from "../helpers/app.js";
import { collectedErrors } from "../helpers/console-errors.js";

/**
 * Visits every main route against a real log and reports which ones logged an error. Selector-light
 * on purpose: it asserts each page mounts and stays quiet. A unit test cannot see that class of
 * regression, because the failure only happens once React renders the component.
 *
 * Clicks the sidebar instead of reloading per route. A reload re-parses the whole bundle and takes
 * ~20s, which is most of a mocha timeout across six routes.
 */
const ROUTES = ["/graph", "/path-schemas", "/constraints", "/oc-declare", "/data-extraction", "/ocel-info"];

describe("navigation", () => {
  before(async () => {
    await goto("/ocel-info");
  });

  it("renders every route without logging an error", async () => {
    const failures: string[] = [];
    for (const route of ROUTES) {
      const link = await $(`a[href="${route}"]`);
      await link.waitForClickable({ timeout: 30_000 });
      await link.click();
      // Routes fetch and render asynchronously; a throw during that lands after the initial paint,
      // so wait for the page to put something on screen and then give it a moment more.
      await browser.waitUntil(
        async () => (await browser.execute(() => document.body.innerText.length)) > 200,
        { timeout: 30_000, timeoutMsg: `${route} rendered nothing` },
      );
      await browser.pause(900);
      const errors = await collectedErrors();
      if (errors.length > 0) failures.push(`${route}:\n    ${errors.join("\n    ")}`);
      // Reset between routes so one noisy page does not get attributed to the next.
      await browser.execute(() => {
        window.__e2eErrors = [];
      });
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} route(s) logged errors:\n  ${failures.join("\n  ")}`);
    }
  });
});
