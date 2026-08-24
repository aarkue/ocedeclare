import { describe, expect, it } from "vitest";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { OCELInfo } from "@/types/ocel";
import { getPossibleE2OVariables, getPossibleO2OVariables } from "./variable-hints";

/** Orders relate to `pay order` events and to items; nothing else relates to anything. */
const ocelInfo = {
	e2o_types: { "pay order": { orders: [2000, []] } },
	o2o_types: { orders: { items: [7659, []] } },
} as unknown as OCELInfo;

const typesFor = (_node: string, _variable: number, scope: "object" | "event") =>
	scope === "event" ? [{ name: "pay order" }] : [{ name: "orders" }];
const objectTypesFor = (_node: string, variable: number, _scope: "object" | "event") => [
	{ name: variable === 0 ? "orders" : "items" },
];

const boxWith = (filters: BindingBox["filters"]) => ({ filters }) as BindingBox;

describe("getPossibleE2OVariables", () => {
	it("suggests a supported pair", () => {
		expect(getPossibleE2OVariables(ocelInfo, typesFor as never, "n", [0], [0])).toEqual({
			object: 0,
			event: 0,
		});
	});

	it("still suggests a pair when an identical filter exists elsewhere in the tree", () => {
		// A sibling box scopes its own variables, so it needs the same pair the first box already uses.
		// Returning nothing here left the editor with unset variables and a disabled submit.
		const existing = [boxWith([{ type: "O2E", object: 0, event: 0, qualifier: null }])];
		expect(getPossibleE2OVariables(ocelInfo, typesFor as never, "n", [0], [0], existing)).toEqual({
			object: 0,
			event: 0,
		});
	});

	it("gives nothing when no pair is supported at all", () => {
		const unrelated = { e2o_types: {}, o2o_types: {} } as unknown as OCELInfo;
		expect(getPossibleE2OVariables(unrelated, typesFor as never, "n", [0], [0])).toEqual({});
	});
});

describe("getPossibleO2OVariables", () => {
	it("still suggests a pair when an identical filter exists elsewhere in the tree", () => {
		const existing = [boxWith([{ type: "O2O", object: 0, other_object: 1, qualifier: null }])];
		expect(
			getPossibleO2OVariables(ocelInfo, objectTypesFor as never, "n", [0, 1], existing),
		).toEqual({ object: 0, other_object: 1 });
	});
});
