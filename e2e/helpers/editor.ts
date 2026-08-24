import { $, $$, browser } from "@wdio/globals";
import { goto } from "./app.js";

/** Scoped to a node's `data-id`: every box renders the same section labels, and an unscoped lookup
 *  silently targets whichever one React Flow rendered first. */
export const sectionPlus = (nodeId: string, label: string) =>
  `//div[@data-id="${nodeId}"]//label[text()="${label}"]/following-sibling::button`;

export async function nodeIds(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".react-flow__node")).map((n) => n.getAttribute("data-id") ?? ""),
  );
}

export async function edgeCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll(".react-flow__edge").length);
}

/**
 * Waits until a box renders the given text, e.g., `o1.price ≥ 1000` after adding that filter.
 *
 * The attribute editors can drop a typed value (see `setNumberInput`), and a filter that lost its
 * bound still submits and matches everything. Waiting on the rendered bound turns that into a
 * failure here instead of a wrong count later.
 */
export async function waitForNodeText(nodeId: string, contains: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (id: string, needle: string) =>
          ((document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null)?.innerText ?? "")
            .includes(needle),
        nodeId,
        contains,
      ),
    { timeout: 20_000, timeoutMsg: `node ${nodeId} never showed ${JSON.stringify(contains)}` },
  );
}

/** Waits for React Flow to measure a node; until it does the node stays `visibility: hidden`. */
export async function waitForNodeVisible(nodeId: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((id: string) => {
        const n = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        return !!n && getComputedStyle(n as HTMLElement).visibility === "visible";
      }, nodeId),
    { timeout: 30_000, timeoutMsg: `node ${nodeId} never became visible` },
  );
}

/**
 * Waits until a node stops moving. Adding a variable resizes the box and the editor re-fits the
 * view; measuring during that animation reads coordinates from halfway through the transition.
 */
export async function waitForNodeSettled(nodeId: string): Promise<void> {
  const rectOf = () =>
    browser.execute((id: string) => {
      const n = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    }, nodeId);
  let last = await rectOf();
  let stable = 0;
  await browser.waitUntil(
    async () => {
      await browser.pause(200);
      const now = await rectOf();
      stable = now !== null && now === last ? stable + 1 : 0;
      last = now;
      return stable >= 3;
    },
    { timeout: 30_000, timeoutMsg: `node ${nodeId} never stopped moving` },
  );
}

/**
 * React Flow's own controls. As the tree grows, nodes drift outside the pane and their client
 * coordinates go negative, and a coordinate-based drag then misses. Fitting alone zooms a single
 * node right in and leaves no free canvas to drop a connection onto, hence the zoom-out steps.
 */
export async function fitView(zoomOutSteps = 2): Promise<void> {
  await (await $('button[title="Fit View"], .react-flow__controls-fitview')).click();
  await browser.pause(500);
  for (let i = 0; i < zoomOutSteps; i++) {
    await (await $('button[title="Zoom Out"], .react-flow__controls-zoomout')).click();
    await browser.pause(200);
  }
  await browser.pause(500);
}

/**
 * Drags from a node's source handle onto empty canvas. The editor reads a connection dropped on the
 * pane as "make me a child here", so one gesture creates the node and the edge. Returns the new id.
 */
export async function addChildOf(nodeId: string, slot = 0): Promise<string> {
  const before = new Set(await nodeIds());
  await waitForNodeVisible(nodeId);
  await fitView();
  await waitForNodeSettled(nodeId);

  // The editor only creates a child when the connection is released over the bare pane. Search for
  // a point that hit-tests to it.

  const plan = await browser.execute(
    (id: string, s: number) => {
      const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)!;
      const src = node.getBoundingClientRect();
      const h = node.querySelector(".react-flow__handle-bottom")!.getBoundingClientRect();
      const from = { x: Math.round(h.x + h.width / 2), y: Math.round(h.y + h.height / 2) };
      const boxes = Array.from(document.querySelectorAll(".react-flow__node")).map((n) =>
        n.getBoundingClientRect(),
      );
      // A point that merely clears a node still lets the drag preview snap back onto it. Keep well
      // away, and prefer a long drop straight downwards.
      const CLEAR = 130;
      const usable = (x: number, y: number) =>
        x > pane.x + 30 &&
        x < pane.right - 30 &&
        y > pane.y + 30 &&
        y < pane.bottom - 15 &&
        ((document.elementFromPoint(x, y) as Element | null)?.classList.contains("react-flow__pane") ?? false) &&
        boxes.every((b) => x < b.x - CLEAR || x > b.right + CLEAR || y < b.y - CLEAR || y > b.bottom + CLEAR);

      // `slot` fans siblings sideways, keeping a second child off the first.
      const cx = src.x + src.width / 2 + s * 320;
      const debug = {
        pane: [Math.round(pane.x), Math.round(pane.y), Math.round(pane.width), Math.round(pane.height)],
        src: [Math.round(src.x), Math.round(src.y), Math.round(src.width), Math.round(src.height)],
        handle: [Math.round(h.x), Math.round(h.y), Math.round(h.width), Math.round(h.height)],
      };
      for (const dy of [180, 220, 150, 260, 300]) {
        for (const dx of [0, 140, -140, 280, -280]) {
          const x = Math.round(cx + dx);
          const y = Math.round(src.bottom + dy);
          if (usable(x, y)) return { from, to: { x, y }, debug };
        }
      }
      for (let y = Math.round(pane.bottom) - 30; y > pane.y + 30; y -= 25) {
        for (let x = Math.round(pane.x) + 40; x < pane.right - 30; x += 40) {
          if (usable(x, y)) return { from, to: { x, y }, debug };
        }
      }
      return null;
    },
    nodeId,
    slot,
  );
  if (!plan) throw new Error(`no free pane position below node ${nodeId}`);

  // Three `perform` calls, pointer held down between them. WebDriver dispatches a single batched
  // action faster than React Flow processes it, and the connection never starts.
  const { from, to } = plan;
  await browser
    .action("pointer")
    .move({ origin: "viewport", x: from.x, y: from.y })
    .pause(60)
    .down()
    .pause(60)
    .move({ origin: "viewport", x: from.x + 10, y: from.y + 30, duration: 100 })
    .perform();
  await browser
    .action("pointer")
    .move({ origin: "viewport", x: to.x, y: to.y, duration: 120 })
    .pause(80)
    .perform();
  await browser.action("pointer").up().perform();

  let created = "";
  await browser.waitUntil(
    async () => {
      created = (await nodeIds()).find((id) => !before.has(id)) ?? "";
      return created !== "";
    },
    {
      timeout: 15_000,
      timeoutMsg: `dragging from ${nodeId} created no child (from ${JSON.stringify(from)} to ${JSON.stringify(to)} debug ${JSON.stringify(plan.debug)})`,
    },
  );
  await waitForNodeVisible(created);
  return created;
}

/**
 * Sets exactly `wanted` in the open dialog's type list. The rows are toggles carrying the selection
 * in `aria-selected`, and one is preselected, so clicking blindly would leave the default in place
 * alongside the intended type (the editor reads multiple types as OR).
 */
export async function selectTypes(wanted: string[]): Promise<void> {
  const rows = await $$('[role="alertdialog"] [role="option"]');
  for (const row of rows) {
    const title = (await row.getAttribute("title")) ?? "";
    const name = title.replace(/\s*\(\d[\d,]*\)\s*$/, "");
    const selected = (await row.getAttribute("aria-selected")) === "true";
    if (wanted.includes(name) !== selected) await row.click();
  }
}

/** `types` is required: the dialog opens with nothing selected and its submit disabled. */
export async function addVariable(
  nodeId: string,
  section: "Object Variables" | "Event Variables",
  types: string[],
) {
  await (await $(sectionPlus(nodeId, section))).click();
  await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });
  // The dialog picks a free variable when it opens, but which ones are free can change before it
  // renders, and a stale pick matches no option and leaves the field blank. A blank name here means
  // the query would be saved against whatever the box falls back to, so fail loudly instead.
  const variable = await browser.waitUntil(
    async () => {
      const name = await browser.execute(() => {
        const dlg = document.querySelector('[role="alertdialog"]');
        const combo = dlg?.querySelector('button[role="combobox"]');
        return (combo?.textContent ?? "").trim();
      });
      return name === "" ? false : name;
    },
    { timeout: 10_000, timeoutMsg: `${section} dialog left its variable selector empty` },
  );
  if (!/^[oe]\d+$/.test(variable as string)) {
    throw new Error(`${section} dialog shows an unexpected variable ${JSON.stringify(variable)}`);
  }
  await selectTypes(types);
  await submitDialog();
  await browser.pause(200);
}

export async function openFilterDialog(nodeId: string) {
  await (await $(sectionPlus(nodeId, "Filters"))).click();
  await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });
}

/**
 * Puts an expression into the CEL editor, which is Monaco, not an input.
 *
 * Three constraints shape this. Session-level `browser.keys` arrives faster than Monaco re-renders
 * and interleaves with the existing text. Element `addValue` types cleanly but refuses special keys,
 * which rules out select-all. `setValue` clears the textarea without clearing Monaco's model and
 * leaves the tail of the default expression behind. Hence: type, then delete one character at a time
 * until the rendered text matches.
 */
export async function setCelExpression(text: string): Promise<void> {
  const editor = await $(".monaco-editor");
  await editor.waitForExist({ timeout: 30_000 });
  await browser.pause(1500);
  const area = await $(".monaco-editor textarea");
  await area.setValue(text);

  const rendered = () =>
    browser.execute(
      () => (document.querySelector(".monaco-editor .view-lines") as HTMLElement)?.innerText ?? "",
    );
  for (let i = 0; i < 40 && (await rendered()) !== text; i++) {
    await browser.keys(["Delete"]);
    await browser.pause(80);
  }
  const final = await rendered();
  if (final !== text) throw new Error(`CEL editor holds ${JSON.stringify(final)}, wanted ${JSON.stringify(text)}`);
}

/**
 * Types into a number field and waits for the value to stick. The editors commit on change, and
 * submitting in the same tick as the keystrokes can register the field as empty, which produces an
 * unbounded filter and no error.
 */
export async function setNumberInput(selector: string, value: string): Promise<void> {
  const field = await $(selector);
  await field.waitForExist({ timeout: 30_000 });
  // Two widgets share `placeholder="min"`. Once the attribute stats resolve the range comes from
  // propel's AttributeValueStats, which redraws its Plotly histogram on every keystroke; React
  // commits lag the typing and characters get dropped. Before the stats land it is OCPQ's own
  // NumberRangeInput. An earlier spec can warm the query cache and decide which one appears, so a
  // spec can pass alone and fail in the suite. Two matching reads rule out a half-committed render.
  for (let attempt = 0; attempt < 5; attempt++) {
    await field.setValue(value);
    await browser.pause(600);
    if ((await field.getValue()) !== value) continue;
    await browser.pause(600);
    if ((await field.getValue()) === value) {
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`${selector} never held ${value} (last: ${await field.getValue()})`);
}

/** Switches one of a dialog's variable pickers: a button showing the current variable (`o1`, `e2`,
 *  ...) that opens a list of the ones in scope. */
export async function pickVariable(current: string, wanted: string): Promise<void> {
  if (current === wanted) return;
  // Partial match, because the button renders an icon beside the name.
  await (await $('[role="alertdialog"]')).$(`button*=${current}`).click();
  await browser.pause(400);
  await (await $(`[role="option"]*=${wanted}`)).click();
  await browser.pause(400);
}


/**
 * Picks the `index`-th variable combobox in the dialog by position.
 *
 * When no combination of the box's variables has any relation in the log, the editor suggests
 * nothing and the pickers render blank, leaving no label to match on. Submit stays disabled until
 * both are chosen.
 */
export async function pickVariableAt(index: number, wanted: string): Promise<void> {
  const combos = await $$('[role="alertdialog"] button[role="combobox"]');
  const target = combos[index];
  if (!target) throw new Error(`no variable picker at index ${index} (found ${combos.length})`);
  await target.click();
  await browser.pause(400);
  await (await $(`[role="option"]*=${wanted}`)).click();
  await browser.pause(400);
}

/** Same chooser as the filter one. The result restricts nothing and reports violations. */
export async function openConstraintDialog(nodeId: string) {
  await (await $(sectionPlus(nodeId, "Constraints"))).click();
  await (await $('[role="alertdialog"]')).waitForExist({ timeout: 30_000 });
}

export async function clickInDialog(text: string) {
  await (await $('[role="alertdialog"]')).$(`button*=${text}`).click();
}

/**
 * Confirms the dialog. Editors that build a list (CBE, CBPE) carry their own "Add" for appending a
 * row, first in the DOM, and a text match grows the list instead of submitting. Submit is last.
 */
export async function submitDialog(): Promise<void> {
  await browser.execute(() => {
    const dlg = document.querySelector('[role="alertdialog"]');
    const adds = Array.from(dlg?.querySelectorAll("button") ?? []).filter(
      (b) => (b.textContent || "").trim() === "Add",
    );
    (adds[adds.length - 1] as HTMLButtonElement | undefined)?.click();
  });
  await browser.waitUntil(
    async () => (await browser.execute(() => document.querySelectorAll('[role="alertdialog"]').length)) === 0,
    { timeout: 15_000, timeoutMsg: "dialog did not close after submitting" },
  );
}

/** Evaluates, and reads the editor's `(<violated> of <situations>)` summary. */
export async function evaluate(): Promise<{ violated: number; situations: number }> {
  const summary = () =>
    browser.execute(() => /\((\d[\d,]*) of (\d[\d,]*)\)/.exec(document.body.innerText)?.[0] ?? null);

  // A dialog still animating closed swallows the click. Wait it out, then confirm the click landed:
  // a swallowed one burns the full timeout, or reads the previous evaluation's numbers straight
  // back.
  await browser.waitUntil(
    async () => (await browser.execute(() => document.querySelectorAll('[role="alertdialog"]').length)) === 0,
    { timeout: 15_000, timeoutMsg: "a dialog stayed open before evaluating" },
  );
  const before = await summary();
  const button = await $('button[title^="Evaluate"]');
  await button.waitForClickable({ timeout: 15_000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await button.click();
    const landed = await browser
      .waitUntil(async () => (await summary()) !== before, { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) break;
    if (attempt === 2) {
      throw new Error(`evaluation never changed the summary (still ${before ?? "absent"})`);
    }
  }
  let out: { violated: number; situations: number } | null = null;
  await browser.waitUntil(
    async () => {
      const m = await browser.execute(() => /\((\d[\d,]*) of (\d[\d,]*)\)/.exec(document.body.innerText));
      if (!m) return false;
      out = { violated: Number(m[1].replace(/,/g, "")), situations: Number(m[2].replace(/,/g, "")) };
      return true;
    },
    { timeout: 120_000, timeoutMsg: "evaluation produced no violation summary" },
  );
  return out as unknown as { violated: number; situations: number };
}

/**
 * Wipes the saved queries and starts a new empty one. Queries persist in localStorage across route
 * changes and app restarts, and a spec would inherit whatever the previous one built.
 */
export async function freshQuery(): Promise<string> {
  // localStorage is origin-wide, so clearing it from the current page is enough and one reload
  // picks it up. That reload is the slow step: the bundle is ~11MB.
  await browser.execute(() => {
    localStorage.removeItem("oced-declare-data");
    localStorage.removeItem("oced-declare-meta");
    localStorage.removeItem("oced-declare-open-index");
  });
  await goto("/constraints");
  await (await $("button*=Create your first query")).click();
  await $(".react-flow__pane").waitForExist({ timeout: 60_000 });

  // A new query starts with one box, ready to drag a child out of. Returning it also makes every
  // spec assert that the seeding happened.
  await browser.waitUntil(async () => (await nodeIds()).length === 1, {
    timeout: 30_000,
    timeoutMsg: "a new query did not start with exactly one box",
  });
  const [root] = await nodeIds();
  await waitForNodeVisible(root);
  return root;
}

export async function addRootNode(): Promise<string> {
  const before = new Set(await nodeIds());
  await (await $('button[title^="Add Node"]')).click();
  let created = "";
  await browser.waitUntil(
    async () => {
      created = (await nodeIds()).find((id) => !before.has(id)) ?? "";
      return created !== "";
    },
    { timeout: 30_000, timeoutMsg: "Add Node created nothing" },
  );
  await waitForNodeVisible(created);
  return created;
}
