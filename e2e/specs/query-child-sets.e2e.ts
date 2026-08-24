import { browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addChildOf,
  addVariable,
  clickInDialog,
  evaluate,
  freshQuery,
  openConstraintDialog,
  openFilterDialog,
  pickVariable,
  pickVariableAt,
  setNumberInput,
  submitDialog,
} from "../helpers/editor.js";

/**
 * The child-set filters that need more than one child box or a projection, which is everything
 * beyond the Child Count that `query-tree` already covers. Each count is pinned by a case in
 * `ocpq-core/tests/queries`.
 */
describe("child-set filters", () => {
  it("counts distinct projected bindings (CBPS)", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["orders"]);
    const child = await addChildOf(root, 0);
    await addVariable(child, "Object Variables", ["items"]);

    await openFilterDialog(child);
    await clickInDialog("(O2O)");
    await submitDialog();

    await openFilterDialog(root);
    await clickInDialog("(CBPS)");
    // Project onto the child's own variable, not the order the picker defaults to.
    await pickVariable("o1", "o2");
    await setNumberInput('input[placeholder^="Minimal count"]', "1");
    await setNumberInput('input[placeholder^="Maximal count"]', "3");
    await submitDialog();

    const { situations, violated } = await evaluate();
    expect(situations).toBe(1008);
    expect(violated).toBe(0);
  });

  it("compares two children's binding sets (CBE)", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["orders"]);

    for (const [slot, type, prefilled] of [
      [0, "payment reminder", true],
      [1, "item out of stock", false],
    ] as const) {
      const child = await addChildOf(root, slot);
      await addVariable(child, "Event Variables", [type]);
      await openFilterDialog(child);
      await clickInDialog("(E2O)");
      // Out-of-stock events have no relation to an order, which is the whole point of this query,
      // so the editor has no pair to suggest and opens with both pickers blank and submit disabled.
      if (!prefilled) {
        await pickVariableAt(0, "e1");
        await pickVariableAt(1, "o1");
      }
      await submitDialog();
      await browser.pause(300);
    }

    // Defaults to comparing both child sets, which is exactly what this needs.
    await openConstraintDialog(root);
    await clickInDialog("(CBE)");
    await submitDialog();

    // Out-of-stock events never attach to an order, so that child is always empty; the sets agree
    // only for orders that were never reminded either, leaving the 443 reminded ones as violations.
    const { situations, violated } = await evaluate();
    expect(situations).toBe(2000);
    expect(violated).toBe(443);
  });

  afterEach(async () => {
    await expectNoConsoleErrors();
  });

  after(async () => {
    await browser.execute(() => {
      localStorage.removeItem("oced-declare-data");
      localStorage.removeItem("oced-declare-meta");
    });
  });
});
