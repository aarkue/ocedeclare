import {
	OcelTypeGraph,
	type OcelTypeGraphEdge,
	type OcelTypeGraphNode,
	TypeScopeSelector,
	ViewerExportFrame,
} from "@r4pm/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { LuExternalLink, LuSettings2 } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBackend, useOcelInfo } from "@/hooks";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { PathSchemaRow } from "@/types/generated/PathSchemaRow";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import type { SelectionMode } from "@/types/generated/SelectionMode";
import type { TemporalMode } from "@/types/generated/TemporalMode";
import DetailsPanel from "./DetailsPanel";
import KindBadge from "./KindBadge";
import {
	blendHexColors,
	connectedTopK,
	eqLabel,
	formatDuration,
	heatStyle,
	normalizeLog,
	schemaColorAt,
	typeKey,
	typeRefEq,
} from "./lib";
import RadarChart from "./RadarChart";
import SchemaPathDiagram from "./SchemaPathDiagram";
import { openSchemasAsCombinedQuery } from "./toQuery";

type SortKey =
	| "schema"
	| "length"
	| "support"
	| "coverage"
	| "selectivity"
	| "reach"
	| "exclusivity";

function SortHeader({
	label,
	field,
	sortKey,
	sortDir,
	onToggle,
	align,
}: {
	label: string;
	field: SortKey;
	sortKey: SortKey;
	sortDir: "asc" | "desc";
	onToggle: (k: SortKey) => void;
	align?: "right";
}) {
	return (
		<th
			onClick={() => onToggle(field)}
			className={`px-3 py-2 font-semibold text-gray-500 cursor-pointer hover:text-gray-800 select-none whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
		>
			{label}
			{sortKey === field && (
				<span className="ml-0.5 text-indigo-600">{sortDir === "asc" ? "↑" : "↓"}</span>
			)}
		</th>
	);
}

const edgeKey = (source: PathTypeRef, qualifier: string, target: PathTypeRef) =>
	`${typeKey(source)}|${qualifier}|${typeKey(target)}`;

export default function PathSchemasViewer() {
	const ocelInfo = useOcelInfo();
	const backend = useBackend();
	const navigate = useNavigate();

	const { data: typeGraph } = useQuery({
		queryKey: ["ocel", "path-schemas", "type-graph"],
		queryFn: () => backend["ocel/path-schemas/type-graph"](),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
		enabled: ocelInfo !== undefined,
	});

	// The r4pm export frame reports failures via this event instead of throwing.
	useEffect(() => {
		const onError = (e: Event) =>
			toast.error(`Image export failed: ${(e as CustomEvent<string>).detail}`);
		window.addEventListener("propel:export-error", onError);
		return () => window.removeEventListener("propel:export-error", onError);
	}, []);

	const [shownTypes, setShownTypes] = useState<PathTypeRef[]>([]);
	const [source, setSource] = useState<PathTypeRef | null>(null);
	const [target, setTarget] = useState<PathTypeRef | null>(null);
	const [maxLength, setMaxLength] = useState(3);
	const [temporal, setTemporal] = useState<TemporalMode>("None");
	const [selection, setSelection] = useState<SelectionMode>("All");
	const [boundedSeconds, setBoundedSeconds] = useState(86400);
	const [selThreshold, setSelThreshold] = useState(0.01);

	const [schemas, setSchemas] = useState<PathSchemaInfo[]>([]);
	const [metricsByIndex, setMetricsByIndex] = useState<Map<number, PathSchemaRow>>(new Map());
	const [eqCount, setEqCount] = useState(0);
	const [totalSources, setTotalSources] = useState(0);
	const [selected, setSelected] = useState<number[]>([]);
	const [detailIndex, setDetailIndex] = useState<number | null>(null);
	const [dockMode, setDockMode] = useState<"radar" | "details">("radar");
	const [enumerating, setEnumerating] = useState(false);
	const [computing, setComputing] = useState(false);
	const [sortKey, setSortKey] = useState<SortKey>("selectivity");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
	const [hideDead, setHideDead] = useState(false);

	const sortedTypes = useMemo(
		() => (typeGraph ? [...typeGraph.nodes].sort((a, b) => b.count - a.count) : []),
		[typeGraph],
	);
	const typeOptions = useMemo(
		() =>
			sortedTypes.map((n) => ({
				value: typeKey(n),
				label: () => (
					<span className="flex items-center gap-1.5">
						<KindBadge isEvent={n.is_event} />
						{n.name} <span className="text-gray-400">({n.count})</span>
					</span>
				),
			})),
		[sortedTypes],
	);
	const refByKey = useMemo(() => {
		const map = new Map<string, PathTypeRef>();
		for (const n of sortedTypes) map.set(typeKey(n), { name: n.name, is_event: n.is_event });
		return map;
	}, [sortedTypes]);

	// Default ("auto") scope: every type for small logs, connected top-k for large ones.
	const autoScope = useMemo<PathTypeRef[]>(
		() => (typeGraph ? connectedTopK(typeGraph.nodes, typeGraph.edges) : []),
		[typeGraph],
	);
	const isAutoScope = useMemo(() => {
		if (shownTypes.length !== autoScope.length) return false;
		const shown = new Set(shownTypes.map(typeKey));
		return autoScope.every((r) => shown.has(typeKey(r)));
	}, [shownTypes, autoScope]);

	// Reset type-dependent selection whenever the loaded dataset changes: a new OCEL
	// yields a different node set, so refs from a prior log must not linger (otherwise
	// they surface as stale picker chips and raw-key nodes in the graph).
	const typeSig = useMemo(() => sortedTypes.map(typeKey).join("|"), [sortedTypes]);
	const lastTypeSig = useRef<string | null>(null);
	useEffect(() => {
		if (sortedTypes.length === 0 || lastTypeSig.current === typeSig) return;
		lastTypeSig.current = typeSig;
		setShownTypes(autoScope);
		setSource(null);
		setTarget(null);
		setSchemas([]);
		setMetricsByIndex(new Map());
		setSelected([]);
		setDetailIndex(null);
	}, [typeSig, autoScope, sortedTypes.length]);

	// Scope always bounds enumeration and metrics. Send null when every type is in scope
	// (small logs) so no restriction is applied; otherwise the scope plus the chosen
	// source/target, which must always remain reachable.
	const allowedTypes = useMemo<PathTypeRef[] | null>(() => {
		if (!typeGraph || shownTypes.length >= typeGraph.nodes.length) return null;
		const refs = [...shownTypes];
		if (source) refs.push(source);
		if (target) refs.push(target);
		const seen = new Set<string>();
		return refs.filter((r) => {
			const k = typeKey(r);
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	}, [typeGraph, shownTypes, source, target]);

	const resetScopeToAuto = () => setShownTypes(autoScope);

	// Auto-enumerate (fast, type-level) once both source and target are chosen.
	useEffect(() => {
		if (!source || !target) {
			setSchemas([]);
			setMetricsByIndex(new Map());
			setSelected([]);
			setDetailIndex(null);
			return;
		}
		let cancelled = false;
		setEnumerating(true);
		setMetricsByIndex(new Map());
		setSelected([]);
		setDetailIndex(null);
		backend["ocel/path-schemas/enumerate"]({
			source,
			target,
			max_length: maxLength,
			allowed_types: allowedTypes,
		})
			.then((res) => {
				if (!cancelled) setSchemas(res);
			})
			.catch(() => {
				if (!cancelled) toast.error("Enumeration failed");
			})
			.finally(() => {
				if (!cancelled) setEnumerating(false);
			});
		return () => {
			cancelled = true;
		};
	}, [backend, source, target, maxLength, allowedTypes]);

	async function computeMetrics() {
		if (!source) {
			toast.error("Select a source type first");
			return;
		}
		setComputing(true);
		try {
			const res = await toast.promise(
				backend["ocel/path-schemas/discover"]({
					source,
					target,
					max_length: maxLength,
					temporal,
					selection,
					bounded_seconds: temporal === "Bounded" ? boundedSeconds : null,
					max_connections: null,
					selectivity_threshold: selThreshold > 0 ? selThreshold : null,
					max_schemas: null,
					allowed_types: allowedTypes,
				}),
				{ loading: "Computing metrics...", success: "Done!", error: "Failed" },
			);
			if (res.rows.length > 0 && schemas.length === 0) {
				setSchemas(
					res.rows.map((r) => ({
						index: r.index,
						schema: r.schema,
						source: r.source,
						target: r.target,
						length: r.length,
						steps: [],
					})),
				);
			}
			setMetricsByIndex(new Map(res.rows.map((r) => [r.index, r])));
			setEqCount(res.equivalence_class_count);
			setTotalSources(res.total_sources);
		} finally {
			setComputing(false);
		}
	}

	const hasMetrics = metricsByIndex.size > 0;
	const supportMax = useMemo(() => {
		let m = 1;
		for (const r of metricsByIndex.values()) if (r.support > m) m = r.support;
		return m;
	}, [metricsByIndex]);

	const sortedSchemas = useMemo(() => {
		const arr = schemas.filter((s) => !(hideDead && metricsByIndex.get(s.index)?.is_dead));
		const dir = sortDir === "asc" ? 1 : -1;
		arr.sort((a, b) => {
			if (sortKey === "schema") return dir * a.schema.localeCompare(b.schema);
			if (sortKey === "length") return dir * (a.length - b.length);
			const ma = metricsByIndex.get(a.index);
			const mb = metricsByIndex.get(b.index);
			const va = ma ? (ma[sortKey] as number) : -1;
			const vb = mb ? (mb[sortKey] as number) : -1;
			if (va === vb) return 0;
			return dir * (va - vb);
		});
		return arr;
	}, [schemas, sortKey, sortDir, metricsByIndex, hideDead]);

	function toggleSort(k: SortKey) {
		if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		else {
			setSortKey(k);
			setSortDir(k === "schema" ? "asc" : "desc");
		}
	}

	function onRowClick(idx: number) {
		const has = selected.includes(idx);
		const next = has ? selected.filter((i) => i !== idx) : [...selected, idx];
		setSelected(next);
		if (has) {
			if (detailIndex === idx) {
				const nd = next.length ? next[next.length - 1] : null;
				setDetailIndex(nd);
				if (nd === null) setDockMode("radar");
			}
		} else {
			setDetailIndex(idx);
			setDockMode("details");
		}
	}

	const colorOf = (idx: number) => {
		const pos = selected.indexOf(idx);
		return pos >= 0 ? schemaColorAt(pos) : undefined;
	};

	const allRows = useMemo(() => [...metricsByIndex.values()], [metricsByIndex]);
	const schemaByIndex = useMemo(() => new Map(schemas.map((s) => [s.index, s])), [schemas]);
	const highlightedSchemas = useMemo(
		() =>
			selected
				.map((idx, i) => {
					const info = schemaByIndex.get(idx);
					return info ? { source: info.source, steps: info.steps, color: schemaColorAt(i) } : null;
				})
				.filter(
					(x): x is { source: PathTypeRef; steps: PathSchemaInfo["steps"]; color: string } =>
						x !== null,
				),
		[selected, schemaByIndex],
	);

	const selectedSchemaInfos = useMemo(
		() => selected.map((idx) => schemaByIndex.get(idx)).filter((s): s is PathSchemaInfo => !!s),
		[selected, schemaByIndex],
	);
	const canOpenSelection = useMemo(() => {
		if (selectedSchemaInfos.length < 2) return false;
		const { source, target } = selectedSchemaInfos[0];
		return selectedSchemaInfos.every(
			(s) =>
				s.source.name === source.name &&
				s.source.is_event === source.is_event &&
				s.target.name === target.name &&
				s.target.is_event === target.is_event,
		);
	}, [selectedSchemaInfos]);

	async function openSelectionAsQuery() {
		try {
			await openSchemasAsCombinedQuery(selectedSchemaInfos, temporal, boundedSeconds);
			navigate("/constraints");
		} catch {
			toast.error("Failed to create query");
		}
	}

	const selectedInfo = useMemo(
		() => (detailIndex === null ? undefined : schemaByIndex.get(detailIndex)),
		[schemaByIndex, detailIndex],
	);

	const focusedRow: PathSchemaRow | undefined = useMemo(() => {
		if (detailIndex === null) return undefined;
		const m = metricsByIndex.get(detailIndex);
		if (m) return m;
		const info = schemaByIndex.get(detailIndex);
		if (!info) return undefined;
		return {
			index: info.index,
			schema: info.schema,
			source: info.source,
			target: info.target,
			length: info.length,
			support: 0,
			coverage: 0,
			selectivity: 0,
			reach: 0,
			exclusivity: 0,
			path_count: 0,
			is_dead: false,
			selectivity_pruned: false,
			limit_reached: false,
			equivalence_class: 0,
			throughput: null,
		};
	}, [detailIndex, metricsByIndex, schemaByIndex]);

	function onGraphNodeClick(ref: PathTypeRef) {
		if (!source || (source && target)) {
			setSource(ref);
			setTarget(null);
		} else if (!typeRefEq(ref, source)) {
			setTarget(ref);
		}
	}

	// Map PathTypeGraph -> generic OcelTypeGraph nodes/edges. Node id is the composite
	// typeKey ("e:"/"o:" + name); edge id is the (source|qualifier|target) composite so
	// schema steps (which carry the same endpoints) can key straight into it.
	const graphNodes = useMemo<OcelTypeGraphNode[]>(
		() =>
			typeGraph
				? typeGraph.nodes.map((n) => ({
						id: typeKey(n),
						label: n.name,
						kind: n.is_event ? "event" : "object",
						count: n.count,
					}))
				: [],
		[typeGraph],
	);
	const graphEdges = useMemo<OcelTypeGraphEdge[]>(
		() =>
			typeGraph
				? typeGraph.edges.map((e) => ({
						id: edgeKey(e.source, e.qualifier, e.target),
						source: typeKey(e.source),
						target: typeKey(e.target),
						qualifier: e.qualifier,
						kind: e.source.is_event ? "e2o" : "o2o",
					}))
				: [],
		[typeGraph],
	);

	// Scope for the TypeScopeSelector: the shown set as node ids. `onChange` maps ids back to refs.
	const shownKeys = useMemo(() => new Set(shownTypes.map(typeKey)), [shownTypes]);
	const onScopeChange = (ids: Set<string>) =>
		setShownTypes([...ids].map((id) => refByKey.get(id)).filter((r): r is PathTypeRef => !!r));

	const sourceKey = source ? typeKey(source) : null;
	const targetKey = target ? typeKey(target) : null;

	// Visible scope: the shown set, plus source/target, plus every node on a highlighted
	// schema (so an off-scope schema path is never clipped). Only keys present in the current
	// graph survive, so refs from a prior dataset never surface as raw composite-key nodes.
	const visibleNodeIds = useMemo(() => {
		const inGraph = new Set(graphNodes.map((n) => n.id));
		const set = new Set<string>();
		const add = (k: string) => {
			if (inGraph.has(k)) set.add(k);
		};
		for (const t of shownTypes) add(typeKey(t));
		if (sourceKey) add(sourceKey);
		if (targetKey) add(targetKey);
		for (const { source: s, steps } of highlightedSchemas) {
			add(typeKey(s));
			for (const step of steps) add(typeKey(step.reverse ? step.source : step.target));
		}
		return set;
	}, [graphNodes, shownTypes, sourceKey, targetKey, highlightedSchemas]);

	// Schema-highlight structures, keyed to match the generic node/edge ids above.
	const { schemaNodeKeys, edgeHighlightColors } = useMemo(() => {
		const nodeKeys = new Set<string>();
		const colors = new Map<string, string[]>();
		for (const { source: s, steps, color } of highlightedSchemas) {
			nodeKeys.add(typeKey(s));
			for (const step of steps) {
				nodeKeys.add(typeKey(step.reverse ? step.source : step.target));
				const key = edgeKey(step.source, step.qualifier, step.target);
				const ex = colors.get(key);
				if (ex) {
					if (!ex.includes(color)) ex.push(color);
				} else {
					colors.set(key, [color]);
				}
			}
		}
		return { schemaNodeKeys: nodeKeys, edgeHighlightColors: colors };
	}, [highlightedSchemas]);
	const hasActiveSchema = highlightedSchemas.length > 0;

	const nodeRingColor = (id: string) =>
		id === sourceKey ? "#10b98180" : id === targetKey ? "#f43f5e80" : undefined;
	const nodeDimmed = (id: string) =>
		hasActiveSchema && !schemaNodeKeys.has(id) && id !== sourceKey && id !== targetKey;
	const edgeStyle = (id: string) => {
		const colors = edgeHighlightColors.get(id);
		if (colors) return { color: blendHexColors(colors), width: 3 };
		if (hasActiveSchema) return { color: "#cbd5e1", width: 1, dimmed: true };
		return { color: "#94a3b8", width: 1.4 };
	};
	const handleGraphNodeClick = (id: string) => {
		const ref = refByKey.get(id);
		if (ref) onGraphNodeClick(ref);
	};

	if (ocelInfo === undefined) {
		return <div className="p-4 text-lg">Load an OCEL to discover path schemas.</div>;
	}

	return (
		<div className="flex flex-col h-full w-full text-left gap-2">
			{/* Toolbar */}
			<div className="flex items-end gap-3 flex-wrap rounded-xl border bg-white px-3 py-2 shadow-sm shrink-0">
				<div className="flex items-end gap-2">
					<div className="flex flex-col gap-0.5">
						<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
							Source
						</Label>
						<Combobox
							name="Select source"
							value={source ? typeKey(source) : ""}
							options={typeOptions}
							onChange={(k) => setSource(refByKey.get(k) ?? null)}
						/>
					</div>
					<span className="text-xl text-indigo-500 font-extrabold pb-1.5">→</span>
					<div className="flex flex-col gap-0.5">
						<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
							Target
						</Label>
						<Combobox
							name="Select target"
							value={target ? typeKey(target) : ""}
							options={typeOptions}
							onChange={(k) => setTarget(refByKey.get(k) ?? null)}
						/>
					</div>
				</div>

				<div className="w-px self-stretch bg-gray-200 my-1" />

				<div className="flex items-end gap-2">
					<div className="flex flex-col gap-0.5">
						<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
							Max k
						</Label>
						<Input
							type="number"
							min={1}
							max={6}
							className="w-[7ch] h-9"
							value={maxLength}
							onChange={(e) => setMaxLength(e.currentTarget.valueAsNumber || 1)}
						/>
					</div>
					<div className="flex flex-col gap-0.5">
						<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
							Temporal
						</Label>
						<Select value={temporal} onValueChange={(v) => setTemporal(v as TemporalMode)}>
							<SelectTrigger className="w-[13ch] h-9">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="None">None</SelectItem>
								<SelectItem value="Forward">Forward</SelectItem>
								<SelectItem value="Bounded">Bounded</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{temporal === "Bounded" && (
						<div className="flex flex-col gap-0.5">
							<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
								Window s
							</Label>
							<Input
								type="number"
								min={0}
								className="w-[11ch] h-9"
								value={boundedSeconds}
								onChange={(e) => setBoundedSeconds(e.currentTarget.valueAsNumber || 0)}
							/>
						</div>
					)}
					<div className="flex flex-col gap-0.5">
						<Label className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">
							Selection
						</Label>
						<Select value={selection} onValueChange={(v) => setSelection(v as SelectionMode)}>
							<SelectTrigger className="w-[12ch] h-9">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="All">All</SelectItem>
								<SelectItem value="First">First</SelectItem>
								<SelectItem value="Last">Last</SelectItem>
								<SelectItem value="Closest">Closest</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Popover>
						<PopoverTrigger asChild>
							<Button variant="outline" size="icon" className="h-9 w-9" title="Advanced options">
								<LuSettings2 size={16} />
							</Button>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-64">
							<div className="flex flex-col gap-2">
								<div className="flex flex-col gap-1">
									<Label className="text-xs font-semibold">Pruning (selectivity threshold)</Label>
									<Input
										type="number"
										min={0}
										max={1}
										step={0.01}
										value={selThreshold}
										onChange={(e) => setSelThreshold(e.currentTarget.valueAsNumber || 0)}
									/>
									<p className="text-[11px] text-gray-500">
										Schemas provably below the threshold are pruned early (faster; marked "pruned").
										0 disables. Default 0.01.
									</p>
								</div>
							</div>
						</PopoverContent>
					</Popover>
				</div>

				<Button
					className="h-9 px-5 font-semibold"
					disabled={computing || schemas.length === 0}
					onClick={() => void computeMetrics()}
				>
					{computing ? "Computing..." : "Compute metrics ▶"}
				</Button>

				<div className="flex-1" />
				<div className="text-xs text-gray-500 pb-1.5 text-right">
					{enumerating
						? "Enumerating..."
						: schemas.length > 0
							? hasMetrics
								? `${schemas.length} schemas · ${eqCount} eq. classes · ${totalSources} sources`
								: `${schemas.length} schemas · Compute to rank`
							: "Pick a source and target to enumerate"}
				</div>
			</div>

			{/* Main: left (graph + table) | right dock */}
			<div className="flex flex-1 min-h-0 gap-2">
				<div className="flex flex-col flex-1 min-w-0 gap-2">
					<div className="border rounded-lg relative h-[42%] min-h-56 overflow-hidden bg-white">
						{/* Top-right: the ViewerExportFrame menu sits at the very corner, the scope
						    selector left of it. OcelTypeGraph's own Fit button is at top-left. */}
						<div className="absolute top-2 right-16 z-30">
							{typeGraph && (
								<R4pmIsland>
									<TypeScopeSelector
										items={graphNodes}
										value={shownKeys}
										onChange={onScopeChange}
										onResetAuto={resetScopeToAuto}
										isAuto={isAutoScope}
									/>
								</R4pmIsland>
							)}
						</div>
						{typeGraph && (
							<R4pmIsland className="w-full h-full">
								<ViewerExportFrame filename="type-graph" style={{ width: "100%", height: "100%" }}>
									<OcelTypeGraph
										nodes={graphNodes}
										edges={graphEdges}
										visibleNodeIds={visibleNodeIds}
										nodeRingColor={nodeRingColor}
										nodeDimmed={nodeDimmed}
										edgeStyle={edgeStyle}
										onNodeClick={handleGraphNodeClick}
									/>
								</ViewerExportFrame>
							</R4pmIsland>
						)}
					</div>

					<div className="flex-1 min-h-0 overflow-auto border rounded-lg bg-white">
						{schemas.length === 0 ? (
							<div className="p-6 text-gray-500 text-sm">
								Pick a source and target type above. Path schemas are then enumerated automatically.
							</div>
						) : (
							<table className="w-full text-sm border-collapse">
								<thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e5e7eb] z-10">
									<tr>
										<SortHeader
											label="Schema"
											field="schema"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
										/>
										<SortHeader
											label="Len"
											field="length"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<SortHeader
											label="Support"
											field="support"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<SortHeader
											label="Coverage"
											field="coverage"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<SortHeader
											label="Selectivity"
											field="selectivity"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<SortHeader
											label="Reach"
											field="reach"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<SortHeader
											label="Exclusivity"
											field="exclusivity"
											sortKey={sortKey}
											sortDir={sortDir}
											onToggle={toggleSort}
											align="right"
										/>
										<th
											className="px-3 py-2 text-right font-semibold text-gray-500"
											title="Mean throughput"
										>
											Throughput
										</th>
										<th
											className="px-3 py-2 text-right font-semibold text-gray-500"
											title="Connection-equivalence class"
										>
											Eq
										</th>
									</tr>
								</thead>
								<tbody>
									{sortedSchemas.map((s) => {
										const m = metricsByIndex.get(s.index);
										const col = colorOf(s.index);
										return (
											<tr
												key={s.index}
												onClick={() => onRowClick(s.index)}
												className={`border-t cursor-pointer hover:bg-gray-50 ${m?.is_dead ? "opacity-50" : ""}`}
												style={
													col
														? { backgroundColor: `${col}14`, boxShadow: `inset 3px 0 0 0 ${col}` }
														: undefined
												}
											>
												<td className="px-3 py-1.5 max-w-[440px]">
													<div className="flex items-center gap-1.5 overflow-hidden">
														<span
															className="w-2.5 h-2.5 rounded-full shrink-0"
															style={{
																backgroundColor: col ?? "transparent",
																outline: col ? "1px solid #fff" : "none",
															}}
														/>
														<div
															className="min-w-0 flex-1 overflow-hidden"
															style={{
																maskImage:
																	"linear-gradient(to right, #000 0, #000 calc(100% - 22px), transparent)",
																WebkitMaskImage:
																	"linear-gradient(to right, #000 0, #000 calc(100% - 22px), transparent)",
															}}
														>
															<SchemaPathDiagram source={s.source} steps={s.steps} compact />
														</div>
														{m?.is_dead && (
															<span className="text-[9px] bg-gray-200 text-gray-500 rounded px-1 shrink-0">
																dead
															</span>
														)}
														{m?.selectivity_pruned && (
															<span className="text-[9px] bg-purple-200 text-purple-800 rounded px-1 shrink-0">
																pruned
															</span>
														)}
													</div>
												</td>
												<td className="px-3 py-1.5 text-right tabular-nums">{s.length}</td>
												{m ? (
													<>
														<td
															className="px-3 py-1.5 text-right tabular-nums"
															style={heatStyle(normalizeLog(m.support, 0, supportMax))}
														>
															{m.support}
														</td>
														<td
															className="px-3 py-1.5 text-right tabular-nums"
															style={heatStyle(m.coverage)}
														>
															{m.coverage.toFixed(2)}
														</td>
														<td
															className="px-3 py-1.5 text-right tabular-nums"
															style={heatStyle(m.selectivity)}
														>
															{m.selectivity.toFixed(2)}
														</td>
														<td
															className="px-3 py-1.5 text-right tabular-nums"
															style={heatStyle(m.reach)}
														>
															{m.reach.toFixed(2)}
														</td>
														<td
															className="px-3 py-1.5 text-right tabular-nums"
															style={heatStyle(m.exclusivity)}
														>
															{m.exclusivity.toFixed(2)}
														</td>
														<td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
															{m.throughput ? formatDuration(m.throughput.mean) : "-"}
														</td>
														<td className="px-3 py-1.5 text-right text-gray-500">
															{eqLabel(m.equivalence_class)}
														</td>
													</>
												) : (
													<td className="px-3 py-1.5 text-center text-gray-300" colSpan={7}>
														not computed
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>
					{hasMetrics && (
						<label className="text-xs text-gray-600 inline-flex items-center gap-1.5 px-1 shrink-0">
							<input
								type="checkbox"
								checked={hideDead}
								onChange={(e) => setHideDead(e.currentTarget.checked)}
							/>
							Hide dead schemas
						</label>
					)}
				</div>

				{/* Right dock: Radar | Details */}
				<div className="w-[470px] shrink-0 flex flex-col border rounded-lg bg-white overflow-hidden">
					<div className="flex items-center gap-1 border-b shrink-0 px-2 py-1.5">
						<button
							type="button"
							onClick={() => setDockMode("radar")}
							className={`px-3 py-1 text-sm rounded ${dockMode === "radar" ? "bg-indigo-100 text-indigo-800 font-semibold" : "text-gray-500 hover:bg-gray-100"}`}
						>
							Radar
						</button>
						<button
							type="button"
							onClick={() => setDockMode("details")}
							disabled={!focusedRow}
							className={`px-3 py-1 text-sm rounded disabled:opacity-40 ${dockMode === "details" ? "bg-orange-100 text-orange-800 font-semibold" : "text-gray-500 hover:bg-gray-100"}`}
						>
							Details
						</button>
						{selected.length > 1 && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 ml-2 gap-1.5"
								onClick={() => void openSelectionAsQuery()}
								disabled={!canOpenSelection}
								title={
									canOpenSelection
										? "Create an OCPQ query requiring all selected paths at once"
										: "Selected schemas must share the same source and target types"
								}
							>
								<LuExternalLink size={13} /> Open selection as query
							</Button>
						)}
						{selected.length > 0 && (
							<div className="ml-auto flex items-center gap-1.5 pr-0.5">
								<span className="text-[11px] text-gray-400">focus</span>
								{selected.map((idx, i) => (
									<button
										key={idx}
										type="button"
										title={schemaByIndex.get(idx)?.schema}
										onClick={() => {
											setDetailIndex(idx);
											setDockMode("details");
										}}
										className="w-4 h-4 rounded-full shrink-0"
										style={{
											backgroundColor: schemaColorAt(i),
											boxShadow: idx === detailIndex ? "0 0 0 2px #1f2937" : "0 0 0 1px #cbd5e1",
										}}
									/>
								))}
							</div>
						)}
					</div>
					<div className="flex-1 min-h-0 overflow-auto">
						{dockMode === "radar" ? (
							<div className="h-full p-1">
								<RadarChart rows={allRows} selected={selected} onSelect={onRowClick} />
							</div>
						) : focusedRow && selectedInfo && source ? (
							<DetailsPanel
								source={source}
								target={target}
								maxLength={maxLength}
								allowedTypes={allowedTypes}
								focusedRow={focusedRow}
								schemaInfo={selectedInfo}
								defaultBoundedSeconds={boundedSeconds}
							/>
						) : (
							<p className="text-sm text-gray-400 p-4">Click a schema row to inspect it here.</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
