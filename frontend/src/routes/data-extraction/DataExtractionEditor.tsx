import {
	type BlueprintEditCallbacks,
	BlueprintGraph,
	type ConnectionKind,
	type EditorBlueprint,
} from "@r4pm/components/extraction-blueprint";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { useBackend, useInvalidateOcel } from "@/hooks";

/** The kinds whose availability depends on the build's connector features (never `custom`). */
const CONNECTOR_KINDS = ["csv", "parquet", "xlsx", "sqlite", "duckdb", "postgres"] as const;

/** OCPQ host for propel's `BlueprintGraph`. OCPQ's backend holds one OCEL at a time, so a run
 *  replaces it rather than minting a handle -- `onRun`'s `ocelHandle` is just a fixed label. */
export default function DataExtractionEditor({
	value,
	onChange,
	connections,
	onConnectionsChange,
}: {
	value: EditorBlueprint;
	onChange: (next: EditorBlueprint) => void;
	connections: Record<string, string>;
	onConnectionsChange: (next: Record<string, string>) => void;
}) {
	const backend = useBackend();
	const invalidateOcel = useInvalidateOcel();

	// Kinds the backend doesn't list are shown disabled rather than failing after the form is filled in.
	const kinds = useQuery({
		queryKey: ["data-extraction", "connection-kinds"],
		queryFn: () => backend["data-extraction/connection-kinds"](),
		staleTime: Number.POSITIVE_INFINITY,
	}).data;
	const connectionKindAvailability = useMemo(() => {
		if (!kinds) return undefined;
		const availability: Partial<Record<ConnectionKind, string>> = {};
		for (const k of CONNECTOR_KINDS) {
			if (!kinds.includes(k)) availability[k] = "not enabled in this build";
		}
		return availability;
	}, [kinds]);

	const callbacks = useMemo<BlueprintEditCallbacks>(
		() => ({
			connectionKindAvailability,
			onValidate: (blueprint, catalog) => backend["data-extraction/validate"](blueprint, catalog),
			onDiscoverCatalog: (conns) => backend["data-extraction/discover-catalog"](conns),
			onColumnDomain: (conns, sourceId, table, column) =>
				backend["data-extraction/column-domain"](conns, sourceId, table, column),
			// Native "Browse..." for file-backed sources (sqlite/csv/parquet/xlsx)
			onPickFile: backend["pick-file"]
				? async (extensions) => {
						const path = await backend["pick-file"]!(
							extensions.length ? [{ name: "Data source", extensions }] : undefined,
						);
						return path ?? undefined;
					}
				: undefined,
			onRun: async (blueprint, conns) => {
				const { report } = await backend["data-extraction/execute"](blueprint, conns);
				// The run replaced the backend's loaded OCEL; drop every cached view of the old one.
				await invalidateOcel();
				return { ocelHandle: "loaded OCEL", report };
			},
		}),
		[backend, invalidateOcel, connectionKindAvailability],
	);

	return (
		<R4pmIsland className="w-full h-full">
			<BlueprintGraph
				value={value}
				onChange={onChange}
				connections={connections}
				onConnectionsChange={onConnectionsChange}
				callbacks={callbacks}
			/>
		</R4pmIsland>
	);
}
