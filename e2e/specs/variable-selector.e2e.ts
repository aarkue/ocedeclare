import { $, browser, expect } from "@wdio/globals";
import { expectNoConsoleErrors } from "../helpers/console-errors.js";
import { addChildOf, addVariable, freshQuery, sectionPlus, selectTypes } from "../helpers/editor.js";

/**
 * Regression: the child's variable selector opening blank.
 *
 * A box only recomputes what is in scope when it re-renders, and a parent gaining a variable does
 * not re-render its children. On a child created *before* its parent had any variables, the "+"
 * handler therefore offered o1 from a stale free list, while opening the dialog re-rendered the box
 * and rebuilt the options without o1, leaving the combobox matching nothing.
 *
 * Ordering matters here: creating the child first is what makes the child's snapshot stale.
 */
describe("variable selector", () => {
  it("offers a free variable on a child whose parent gained one afterwards", async () => {
    const root = await freshQuery();
    const child = await addChildOf(root, 0);

    await addVariable(root, "Object Variables", ["orders"]);
    await (await $(sectionPlus(child, "Object Variables"))).click();
    await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });

    // o1 belongs to the root, so the child must be offered the next free one.
    const shown = await browser.execute(() =>
      (
        document.querySelector('[role="alertdialog"] button[role="combobox"]')?.textContent ?? ""
      ).trim(),
    );
    expect(shown).toBe("o2");

    await browser.keys(["Escape"]);
    await browser.pause(400);
  });

  it("opens with no type selected and the submit disabled", async () => {
    const root = await freshQuery();
    await (await $(sectionPlus(root, "Object Variables"))).click();
    await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });

    const state = await browser.execute(() => {
      const dlg = document.querySelector('[role="alertdialog"]');
      const rows = Array.from(dlg?.querySelectorAll('[role="option"]') ?? []);
      const add = Array.from(dlg?.querySelectorAll("button") ?? []).find(
        (b) => (b.textContent ?? "").trim() === "Add",
      ) as HTMLButtonElement | undefined;
      return {
        selected: rows.filter((r) => r.getAttribute("aria-selected") === "true").length,
        addDisabled: add?.disabled ?? null,
      };
    });
    expect(state.selected).toBe(0);
    expect(state.addDisabled).toBe(true);

    // Choosing a type enables it.
    await selectTypes(["orders"]);
    const enabled = await browser.execute(() => {
      const dlg = document.querySelector('[role="alertdialog"]');
      const add = Array.from(dlg?.querySelectorAll("button") ?? []).find(
        (b) => (b.textContent ?? "").trim() === "Add",
      ) as HTMLButtonElement | undefined;
      return add?.disabled ?? null;
    });
    expect(enabled).toBe(false);
    await browser.keys(["Escape"]);
    await browser.pause(400);
  });

  after(async () => {
    await expectNoConsoleErrors();
    await browser.execute(() => {
      localStorage.removeItem("oced-declare-data");
      localStorage.removeItem("oced-declare-meta");
    });
  });
});
