import { $, expect } from "@wdio/globals";
import { goto } from "../helpers/app.js";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";

/**
 * The app is launched with `order-management.xml.gz` as an argv path, so the engine imports it
 * before the window is up. The counts asserted here are the same ones `tests/fixtures.rs` pins, so
 * a mismatch is the frontend or the binding layer, not the log.
 */
describe("OCEL info", () => {
  before(async () => {
    await goto("/ocel-info");
    await $("h2*=OCEL Info").waitForExist({ timeout: 60_000 });
  });

  it("reports the fixture's counts", async () => {
    const body = await $("body");
    await expect(body).toHaveText(expect.stringContaining("11 Event Types"));
    await expect(body).toHaveText(expect.stringContaining("6 Object Types"));
    await expect(body).toHaveText(expect.stringContaining("21,008"));
    await expect(body).toHaveText(expect.stringContaining("10,840"));
  });

  it("renders an attribute distribution chart", async () => {
    // `orders` declares exactly one attribute, so selecting the type auto-expands its stats. That
    // renders AttributeValueStats -> ThemedPlot, the path that broke when the built package's CJS
    // interop handed React a module object instead of the Plot component.
    const ordersRow = await $('button[title*="orders"]');
    await ordersRow.waitForClickable({ timeout: 30_000 });
    await ordersRow.click();

    const plot = await $(".js-plotly-plot");
    await plot.waitForExist({ timeout: 60_000 });
    await expect(plot).toBeDisplayed();
  });

  after(async () => {
    await expectNoConsoleErrors();
  });
});
