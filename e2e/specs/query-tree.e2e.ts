import { $, browser, expect } from "@wdio/globals";
import { goto } from "../helpers/app.js";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addChildOf,
  addVariable,
  clickInDialog,
  edgeCount,
  evaluate,
  freshQuery,
  nodeIds,
  openFilterDialog,
  setNumberInput,
  submitDialog,
} from "../helpers/editor.js";

/**
 * Builds a three-level query by dragging child boxes out of their parents, which is the only way to
 * create a child set, and therefore the only way the child-set filters (CBS, CBE, CBPS, CBPE) can be
 * exercised against anything real.
 *
 * The counts are pinned independently by `ocpq-core/tests/queries/om-orders-with-a-reminder.json`:
 * 443 of the 2,000 orders received a payment reminder.
 */
describe("query tree", () => {
  let root = "";
  let child = "";
  let grandchild = "";

  before(async () => {
    root = await freshQuery();
  });

  it("creates a child and a grandchild by dragging connections onto the canvas", async () => {
    await addVariable(root, "Object Variables", ["orders"]);

    child = await addChildOf(root, 0);
    await addVariable(child, "Event Variables", ["payment reminder"]);

    grandchild = await addChildOf(child, 0);
    await addVariable(grandchild, "Event Variables", ["pay order"]);

    expect(await nodeIds()).toHaveLength(3);
    expect(await edgeCount()).toBe(2);
  });

  it("evaluates the tree to the counts the corpus pins", async () => {
    // Tie each box to the order the root bound. Both variable pickers already default correctly.
    for (const node of [child, grandchild]) {
      await openFilterDialog(node);
      await clickInDialog("(E2O)");
      await submitDialog();
      await browser.pause(400);
    }

    // Child-set size filters: keep only parents that have a matching child binding.
    for (const node of [child, root]) {
      await openFilterDialog(node);
      await clickInDialog("(CBS)");
      await setNumberInput('input[placeholder^="Minimal Count"]', "1");
      await submitDialog();
      await browser.pause(400);
    }

    const { situations, violated } = await evaluate();
    expect(situations).toBe(443);
    expect(violated).toBe(0);
  });

  it("supports a second child of the same parent", async () => {
    await addChildOf(root, 1);
    expect(await nodeIds()).toHaveLength(4);
    expect(await edgeCount()).toBe(3);
  });

  after(async () => {
    await expectNoConsoleErrors();
    await browser.execute(() => {
      localStorage.removeItem("oced-declare-data");
      localStorage.removeItem("oced-declare-meta");
    });
  });
});
