import { $, browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import {
  addVariable,
  clickInDialog,
  evaluate,
  freshQuery,
  openConstraintDialog,
  openFilterDialog,
  submitDialog,
} from "../helpers/editor.js";

/**
 * Event-attribute filters, which need the p2p log: no event type in order-management declares an
 * attribute at all.
 *
 * `resource` is a pure function of event type here, one value each, so it only discriminates across
 * a variable bound to several types. Purchase orders (1598) and quotation requests (927) come from
 * Procurement, invoice receipts (1941) from Finance. Pinned by
 * `ocpq-core/tests/queries/p2p-procurement-events-{filter,constraint}.json`.
 */
const EVENT_TYPES = ["Create Purchase Order", "Create Request for Quotation", "Create Invoice Receipt"];

async function pickResourceAttribute(): Promise<void> {
  await clickInDialog("Attribute Name");
  await (await $('[role="option"]*=resource')).click();
  await browser.pause(500);
  // The string filter is a list built by typing a value and confirming it.
  const value = await $('input[placeholder^="Type a value"]');
  await value.waitForExist({ timeout: 30_000 });
  await value.setValue("Procurement Department");
  await browser.keys(["Enter"]);
  await browser.pause(600);
}

describe("event attributes", () => {
  it("keeps only the Procurement events when used as a filter", async () => {
    const root = await freshQuery();
    await addVariable(root, "Event Variables", EVENT_TYPES);

    await openFilterDialog(root);
    await clickInDialog("(EAE/EAR)");
    await pickResourceAttribute();
    await submitDialog();

    const { situations, violated } = await evaluate();
    expect(situations).toBe(2525);
    expect(violated).toBe(0);
  });

  it("reports the Finance events as violations when used as a constraint", async () => {
    const root = await freshQuery();
    await addVariable(root, "Event Variables", EVENT_TYPES);

    await openConstraintDialog(root);
    await clickInDialog("(EAE/EAR)");
    await pickResourceAttribute();
    await submitDialog();

    const { situations, violated } = await evaluate();
    expect(situations).toBe(4466);
    expect(violated).toBe(1941);
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
