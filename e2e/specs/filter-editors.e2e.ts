import { $, browser } from "@wdio/globals";
import { goto } from "../helpers/app.js";
import { collectedErrors } from "../helpers/console-errors.js";
import { freshQuery, selectTypes, submitDialog } from "../helpers/editor.js";

const plusFor = (label: string) => `//label[text()="${label}"]/following-sibling::button`;

/**
 * Every entry in the filter chooser, by its short code, which is unique across the list. The engine
 * side of each of these is pinned by the Rust corpus; what is only reachable here is whether the
 * editor panel actually renders, since a component that throws on mount is invisible to a unit test.
 */
const FILTER_TYPES = [
  "(OAE/OAR)",
  "(CEL)",
  "(CEL+)",
  "(E2O)",
  "(O2O)",
  "(TBE)",
  "(EAE/EAR)",
  "(NEQ)",
  "(CBS)",
  "(CBE)",
  "(CBPS)",
  "(CBPE)",
];

/** The dialog opens with no type selected and its submit disabled, so pick one first. */
async function addVariable(section: "Object Variables" | "Event Variables", type: string): Promise<void> {
  await (await $(plusFor(section))).click();
  await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });
  await selectTypes([type]);
  await submitDialog();
  await browser.pause(300);
}

describe("filter editors", () => {
  before(async () => {
    // The box a new query starts with is the only one here, so the unscoped selectors above are
    // unambiguous.
    await freshQuery();

    // Two of each, so the relational editors (E2O, O2O, TBE, NEQ) have something to bind to.
    await addVariable("Object Variables", "orders");
    await addVariable("Object Variables", "items");
    await addVariable("Event Variables", "place order");
    await addVariable("Event Variables", "pay order");
  });

  it("renders every filter editor without throwing", async () => {
    await (await $(plusFor("Filters"))).click();
    const dialog = await $('[role="alertdialog"]');
    await dialog.waitForExist({ timeout: 30_000 });

    const failures: string[] = [];
    for (const code of FILTER_TYPES) {
      await browser.execute(() => {
        window.__e2eErrors = [];
      });
      await dialog.$(`button*=${code}`).click();
      const config = async () =>
        await browser.execute(() => {
          const dlg = document.querySelector('[role="alertdialog"]') as HTMLElement | null;
          return (dlg?.innerText ?? "").split("Configuration")[1]?.trim().length ?? 0;
        });
      // Waits on the panel instead of sleeping. A throw during render leaves it empty, which the
      // check below reports; a healthy one is ready within a frame or two.
      await browser.waitUntil(async () => (await config()) > 0, { timeout: 8_000 }).catch(() => undefined);
      const rendered = await config();
      const errors = await collectedErrors();
      if (errors.length > 0) failures.push(`${code}: ${errors.join(" | ")}`);
      else if (rendered === 0) failures.push(`${code}: config panel rendered nothing`);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} filter editor(s) failed:\n  ${failures.join("\n  ")}`);
    }
  });

  after(async () => {
    await browser.keys("Escape");
    await browser.execute(() => {
      localStorage.removeItem("oced-declare-data");
      localStorage.removeItem("oced-declare-meta");
    });
  });
});
