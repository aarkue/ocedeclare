import type { VisualEditorContextValue } from "@/routes/visual-editor/helper/VisualEditorContext";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import type { OCELInfo } from "@/types/ocel";

export function deDupe<T>(values: T[]): T[] {
	return [...new Set(values).values()];
}

export function getNodeRelationshipSupport(
	ocelInfo: OCELInfo,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	var1: ObjectVariable | EventVariable,
	var2: ObjectVariable,
	isE2O: boolean,
): number {
	const types1 = getTypesForVariable(nodeID, var1, isE2O ? "event" : "object");
	const types2 = getTypesForVariable(nodeID, var2, "object");
	return getTypesRelationshipSupport(
		ocelInfo,
		types1.map((t) => t.name),
		types2.map((t) => t.name),
		isE2O,
	);
}

export function getTypesRelationshipSupport(
	ocelInfo: OCELInfo,
	firstTypes: string[],
	secondTypes: string[],
	isE2O: boolean,
): number {
	let support = 0;
	for (const type1 of firstTypes) {
		for (const type2 of secondTypes) {
			const types = isE2O ? ocelInfo?.e2o_types : ocelInfo?.o2o_types;
			support += types?.[type1]?.[type2]?.[0] ?? 0;
		}
	}
	return support;
}

export function getPossibleE2OVariables(
	ocelInfo: OCELInfo | undefined,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	objectVariables: ObjectVariable[],
	eventVariables: EventVariable[],
	allBoxes: BindingBox[] | undefined = undefined,
): { object: ObjectVariable; event: EventVariable } | Record<string, never> {
	if (ocelInfo === undefined) {
		return {};
	}
	let backup: { object: ObjectVariable; event: EventVariable } | undefined;
	for (const evVar of eventVariables) {
		for (const obVar of objectVariables) {
			const support = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				evVar,
				obVar,
				true,
			);
			if (support > 0) {
				if (allBoxes !== undefined) {
					const existingE2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2E" && f.event === evVar && f.object === obVar);
					if (existingE2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar, event: evVar };
						}
						continue;
					}
				}
				return { object: obVar, event: evVar };
			}
		}
	}
	// Every supported pair is already filtered on somewhere in the tree. Reuse one anyway: a sibling
	// box scopes its own variables and needs the same pair. Returning nothing leaves the editor with
	// unset variables and a disabled submit, with nothing saying why.
	return backup ?? {};
}

export function getPossibleO2OVariables(
	ocelInfo: OCELInfo | undefined,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	objectVariables: ObjectVariable[],
	allBoxes: BindingBox[] | undefined = undefined,
): { object: ObjectVariable; other_object: ObjectVariable } | Record<string, never> {
	if (ocelInfo === undefined) {
		return {};
	}
	let backup: { object: ObjectVariable; other_object: ObjectVariable } | undefined;
	for (const obVar1 of objectVariables) {
		for (const obVar2 of objectVariables) {
			if (obVar1 === obVar2) {
				continue;
			}
			const support = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				obVar1,
				obVar2,
				false,
			);
			if (support > 0) {
				if (allBoxes !== undefined) {
					const existingO2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2O" && f.object === obVar1 && f.other_object === obVar2);
					if (existingO2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar1, other_object: obVar2 };
						}
						continue;
					}
				}
				return { object: obVar1, other_object: obVar2 };
			}
			const reverseSupport = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				obVar2,
				obVar1,
				false,
			);
			if (reverseSupport > 0) {
				if (allBoxes !== undefined) {
					// TODO: Also check parent nodes?!
					const existingO2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2O" && f.object === obVar2 && f.other_object === obVar1);
					if (existingO2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar2, other_object: obVar1 };
						}
						continue;
					}
				}
				return { object: obVar2, other_object: obVar1 };
			}
		}
	}
	// Same fallback as the E2O case: an already-used pair beats leaving the editor unusable.
	return backup ?? {};
}
