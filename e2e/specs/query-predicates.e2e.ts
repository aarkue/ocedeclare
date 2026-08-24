import { $, browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addVariable,
  clickInDialog,
  evaluate,
  freshQuery,
  openConstraintDialog,
  openFilterDialog,
  setCelExpression,
  setNumberInput,
  waitForNodeText,
  submitDialog,
} from "../helpers/editor.js";

/**
 * Predicate shapes the other specs do not reach, each pinned by a case in
 * `ocpq-core/tests/queries`. Every test builds its own query, because queries persist in
 * localStorage and would accumulate across tests.
 */
describe("predicates", () => {
  it("reports violations when the predicate is a constraint, not a filter", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["orders"]);

    await openConstraintDialog(root);
    await clickInDialog("Object Attribute");
    await clickInDialog("Attribute Name");
    await (await $('[role="option"]*=price')).click();
    await setNumberInput('input[placeholder="min"]', "1000");
    await submitDialog();
    await waitForNodeText(root, "1000");

    // The same `price >= 1000` predicate that om-orders-price-at-least-1000 uses as a filter. As a
    // constraint every order stays a situation and the 538 below the threshold are violations, so
    // the two cases agree: 2000 - 1462 = 538.
    const { situations, violated } = await evaluate();
    expect(situations).toBe(2000);
    expect(violated).toBe(538);
  });

  it("counts distinct pairs with a Not Equal constraint", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["customers"]);
    await addVariable(root, "Object Variables", ["customers"]);

    await openConstraintDialog(root);
    await clickInDialog("(NEQ)");
    await submitDialog();

    // 15 customers, so 225 ordered pairs, of which the 15 on the diagonal violate.
    const { situations, violated } = await evaluate();
    expect(situations).toBe(225);
    expect(violated).toBe(15);
  });

  it("filters through a CEL expression", async () => {
    const root = await freshQuery();
    await addVariable(root, "Object Variables", ["orders"]);

    await openFilterDialog(root);
    await clickInDialog("CEL Expression");
    // `o1` is how CEL names object variable 0.
    await setCelExpression("o1.attr('price')>5000.0");
    await submitDialog();

    const { situations, violated } = await evaluate();
    expect(situations).toBe(170);
    expect(violated).toBe(0);
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
