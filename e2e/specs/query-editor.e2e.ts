import { $, browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addVariable,
  clickInDialog,
  evaluate,
  freshQuery,
  openFilterDialog,
  setNumberInput,
  waitForNodeText,
  submitDialog,
} from "../helpers/editor.js";

/**
 * Builds a query by hand in the visual editor, adds a filter predicate, and evaluates it against the
 * real engine. The situation counts are pinned independently by the Rust corpus
 * (`om-orders-price-at-least-1000.json`). A divergence here means the frontend serialised the query
 * differently or the IPC layer mangled it, not that the engine changed.
 */
describe("query editor", () => {
  let root = "";

  before(async () => {
    root = await freshQuery();
  });

  it("opens a new query with its box framed, not in a corner", async () => {
    const placement = await browser.execute(() => {
      const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
      const node = document.querySelector(".react-flow__node")!.getBoundingClientRect();
      return {
        // Where the box's centre sits within the pane, as a fraction of each axis.
        x: (node.x + node.width / 2 - pane.x) / pane.width,
        y: (node.y + node.height / 2 - pane.y) / pane.height,
        widthFraction: node.width / pane.width,
      };
    });
    expect(placement.x).toBeGreaterThan(0.2);
    expect(placement.x).toBeLessThan(0.8);
    expect(placement.y).toBeGreaterThan(0.2);
    expect(placement.y).toBeLessThan(0.8);
    // Also big enough to read. Uncapped the fit would blow one box up to the whole canvas; at the
    // natural scale it reads as a stamp in an empty pane. The cap lands it around 40% of the width.
    expect(placement.widthFraction).toBeGreaterThan(0.25);
    expect(placement.widthFraction).toBeLessThan(0.7);
  });

  it("binds every order when the box has no filter", async () => {
    await addVariable(root, "Object Variables", ["orders"]);

    const { violated, situations } = await evaluate();
    expect(situations).toBe(2000);
    expect(violated).toBe(0);
  });

  it("shows the attribute distribution while configuring a filter predicate", async () => {
    await openFilterDialog(root);
    await clickInDialog("Object Attribute");
    await clickInDialog("Attribute Name");
    await (await $('[role="option"]*=price')).click();

    // Picking a numeric attribute renders AttributeValueStats, i.e. a Plotly chart, inside the
    // filter editor. This is the exact surface that broke when the built package's CJS interop
    // handed React a module object instead of the Plot component.
    const plot = await $(".js-plotly-plot");
    await plot.waitForExist({ timeout: 30_000 });
    await expect(plot).toBeDisplayed();
  });

  it("narrows the bindings once the predicate is applied", async () => {
    await setNumberInput('input[placeholder="min"]', "1000");
    await submitDialog();
    await waitForNodeText(root, "1000");

    const { violated, situations } = await evaluate();
    // Pinned by the corpus: 1462 of the 2000 orders reach a price of 1000.
    expect(situations).toBe(1462);
    expect(violated).toBe(0);
  });

  after(async () => {
    await expectNoConsoleErrors();
    await browser.execute(() => {
      localStorage.removeItem("oced-declare-data");
      localStorage.removeItem("oced-declare-meta");
    });
  });
});
