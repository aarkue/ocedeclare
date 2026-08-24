import type {
	DeclareEdgeRoute,
	DeclareFlowModel,
	EdgeTemplate,
	ObjectTypeAssociation,
	OCDeclareArcLabel,
} from "@r4pm/components";
import { OCDeclareViz } from "@r4pm/components";
import type { Edge, Node, ReactFlowJsonObject, Viewport } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { useBackend, useOcelInfo, useOcelStats } from "@/hooks";
import { OCDeclareLayoutSettingsPopover, useOCDeclareLayoutSettings } from "./layout-settings";

type PersistedNodeData = { type: string; isObject?: "init" | "exit" };
type PersistedEdgeData = {
	type: EdgeTemplate;
	objectTypes: OCDeclareArcLabel;
	cardinality?: [number | null, number | null];
	violationInfo?: { violationPercentage: number };
	route?: DeclareEdgeRoute;
};
export type PersistedFlow = ReactFlowJsonObject<
	Node<PersistedNodeData, "activity">,
	Edge<PersistedEdgeData>
>;

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function flowToModel(flow: PersistedFlow | undefined): DeclareFlowModel {
	if (!flow || !Array.isArray(flow.nodes)) return { nodes: [], edges: [] };
	// Flows saved before layout output was synced back have every node at (0,0); treat those
	// positions as missing so the viz runs its initial layout instead of stacking all nodes.
	const positionsBroken =
		flow.nodes.length > 1 &&
		flow.nodes.every((n) => (n.position?.x ?? 0) === 0 && (n.position?.y ?? 0) === 0);
	return {
		nodes: flow.nodes.map((n) => ({
			id: n.id,
			type: n.data.type,
			kind: n.data.isObject ?? "activity",
			position: positionsBroken ? undefined : n.position,
		})),
		edges: flow.edges.flatMap((e) =>
			e.data
				? [
						{
							id: e.id,
							source: e.source,
							target: e.target,
							template: e.data.type,
							cardinality: e.data.cardinality,
							label: e.data.objectTypes,
							violation: e.data.violationInfo
								? e.data.violationInfo.violationPercentage / 100
								: undefined,
							route: e.data.route,
						},
					]
				: [],
		),
	};
}

function modelToFlow(model: DeclareFlowModel, viewport: Viewport): PersistedFlow {
	return {
		viewport,
		nodes: model.nodes.map((n) => ({
			id: n.id,
			type: "activity",
			position: n.position ?? { x: 0, y: 0 },
			data: { type: n.type, ...(n.kind === "activity" ? {} : { isObject: n.kind }) },
		})),
		edges: model.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			data: {
				type: e.template,
				objectTypes: e.label,
				cardinality: e.cardinality,
				...(e.violation != null
					? { violationInfo: { violationPercentage: e.violation * 100 } }
					: {}),
				...(e.route ? { route: e.route } : {}),
			},
		})),
	};
}

/** OCPQ host for propel's editable `OCDeclareViz`: maps the persisted flow-JSON <-> `DeclareFlowModel`
 *  and injects the OCEL palette + backend callbacks. */
export default function OCDeclareEditor({
	initialFlowJson,
	onChange,
}: {
	initialFlowJson?: PersistedFlow;
	onChange: (flowJson: PersistedFlow) => void;
}) {
	const backend = useBackend();
	const ocelInfo = useOcelInfo();
	const ocelStats = useOcelStats();
	const [model, setModel] = useState<DeclareFlowModel>(() => flowToModel(initialFlowJson));
	const modelRef = useRef(model);
	modelRef.current = model;
	const viewportRef = useRef<Viewport>(initialFlowJson?.viewport ?? DEFAULT_VIEWPORT);
	const { settings, setSettings, layout, activityColor } = useOCDeclareLayoutSettings();

	// Stable identities: the viz rebuilds its edit context (and every node/edge with it) whenever a prop changes.
	const eventTypes = useMemo(() => ocelInfo?.event_types.map((t) => t.name) ?? [], [ocelInfo]);
	const objectTypes = useMemo(() => ocelInfo?.object_types.map((t) => t.name) ?? [], [ocelInfo]);

	const activityInvolvements = useMemo(() => {
		if (!ocelInfo?.activity_involvements) return undefined;
		const out: Record<string, Record<string, { min: number; max: number }>> = {};
		for (const [activity, perOt] of Object.entries(ocelInfo.activity_involvements)) {
			out[activity] = {};
			for (const [ot, [min, max]] of Object.entries(perOt)) out[activity][ot] = { min, max };
		}
		return out;
	}, [ocelInfo]);

	const relatedTypes = useCallback(
		(activity: string): Record<string, number> => {
			const out: Record<string, number> = {};
			for (const [ot, v] of Object.entries(ocelInfo?.e2o_types?.[activity] ?? {})) out[ot] = v[0];
			return out;
		},
		[ocelInfo],
	);

	const getSupport = useCallback(
		(
			assoc: ObjectTypeAssociation,
			ctx: { source: { type: string; kind: string }; target: { type: string; kind: string } },
		) => {
			if (!ocelInfo) return undefined;
			const e2o = (a: string, b: string) => ocelInfo.e2o_types?.[a]?.[b]?.[0] ?? 0;
			const o2o = (a: string, b: string) => ocelInfo.o2o_types?.[a]?.[b]?.[0] ?? 0;
			if (assoc.type === "Simple") {
				const s = ctx.source.kind === "activity" ? e2o(ctx.source.type, assoc.object_type) : 1;
				const t = ctx.target.kind === "activity" ? e2o(ctx.target.type, assoc.object_type) : 1;
				return Math.min(s, t);
			}
			const [a, b] = assoc.reversed ? [assoc.second, assoc.first] : [assoc.first, assoc.second];
			return o2o(a, b);
		},
		[ocelInfo],
	);

	const handleChange = useCallback(
		(next: DeclareFlowModel) => {
			setModel(next);
			onChange(modelToFlow(next, viewportRef.current));
		},
		[onChange],
	);
	const handleViewportChange = useCallback(
		(viewport: Viewport) => {
			viewportRef.current = viewport;
			onChange(modelToFlow(modelRef.current, viewport));
		},
		[onChange],
	);

	const onProjectActivities = useCallback<(typeof backend)["ocel/project-oc-declare-arcs"]>(
		(arcs, activities) => backend["ocel/project-oc-declare-arcs"](arcs, activities),
		[backend],
	);
	const onDiscover = useCallback(
		(o: unknown) =>
			backend["ocel/discover-oc-declare"](
				o as Parameters<(typeof backend)["ocel/discover-oc-declare"]>[0],
			),
		[backend],
	);
	const onEvaluate = useCallback<(typeof backend)["ocel/evaluate-oc-declare-arcs"]>(
		(arcs) => backend["ocel/evaluate-oc-declare-arcs"](arcs),
		[backend],
	);
	const onActivityStatistics = useCallback<(typeof backend)["ocel/get-activity-statistics"]>(
		(activity) => backend["ocel/get-activity-statistics"](activity),
		[backend],
	);
	const onEdgeStatistics = useCallback<(typeof backend)["ocel/get-oc-declare-edge-statistics"]>(
		(arc) => backend["ocel/get-oc-declare-edge-statistics"](arc),
		[backend],
	);
	const onTemplateString = useCallback<(typeof backend)["oc-declare/template-string"]>(
		(arcs) => backend["oc-declare/template-string"](arcs),
		[backend],
	);

	return (
		<div className="relative w-full h-full">
			<R4pmIsland className="w-full h-full">
				<OCDeclareViz
					editable
					value={model}
					onChange={handleChange}
					defaultViewport={initialFlowJson?.viewport}
					onViewportChange={handleViewportChange}
					eventTypes={eventTypes}
					objectTypes={objectTypes}
					relatedTypes={relatedTypes}
					activityInvolvements={activityInvolvements}
					eventTypeCounts={ocelStats?.event_type_counts}
					getSupport={getSupport}
					onProjectActivities={onProjectActivities}
					layoutOverride={layout}
					activityColor={activityColor}
					relayoutOnChange={settings.relayoutOnChange}
					onDiscover={onDiscover}
					onEvaluate={onEvaluate}
					onActivityStatistics={onActivityStatistics}
					onEdgeStatistics={onEdgeStatistics}
					onTemplateString={onTemplateString}
				/>
			</R4pmIsland>
			<div className="absolute top-2 right-2 z-10">
				<OCDeclareLayoutSettingsPopover settings={settings} setSettings={setSettings} />
			</div>
		</div>
	);
}
