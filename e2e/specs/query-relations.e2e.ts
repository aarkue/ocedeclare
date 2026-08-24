import { $, browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addVariable,
  clickInDialog,
  evaluate,
  freshQuery,
  openFilterDialog,
  submitDialog,
} from "../helpers/editor.js";

/**
 * A single box binding two object variables joined by an object-to-object relation, which is the one
 * filter shape that never touches events. Pinned by
 * `ocpq-core/tests/queries/om-order-item-pairs.json`: 7,659 order/item pairs.
 */
describe("object-to-object filter", () => {
  it("counts related order/item pairs", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["orders"]);
    await addVariable(root, "Object Variables", ["items"]);

    await openFilterDialog(root);
    await clickInDialog("(O2O)");
    await submitDialog();

    const { situations, violated } = await evaluate();
    expect(situations).toBe(7659);
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
