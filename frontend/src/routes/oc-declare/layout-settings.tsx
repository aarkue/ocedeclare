import {
	ACT_NODE_HEIGHT,
	ACT_NODE_WIDTH,
	type ConstraintEdgeData,
	type DeclareLayoutFn,
	roundedPointsToSvgPath,
	snapEndpointsToNodeBorders,
} from "@r4pm/components";
import { wasmDeclareLayout } from "@r4pm/components/rust-layout/wasm";
import type { Edge } from "@xyflow/react";
import { useMemo } from "react";
import { LuSettings2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useLocalStorageState } from "@/hooks";

export type OCDeclareLayoutSettings = {
	/** Straight arcs between node borders instead of the engine's routed polylines. */
	straightEdges: boolean;
	/** Let the graph re-lay-out by itself: after a drop, and when a display toggle or a paste changes
	 *  what the arcs need. The Layout button runs regardless. */
	relayoutOnChange: boolean;
	/** Plain activities: near-white fill with a dark border, instead of per-activity colours. */
	oldschoolColors: boolean;
};

const STORAGE_KEY = "oced-ocdeclare-layout-settings";
const DEFAULTS: OCDeclareLayoutSettings = {
	straightEdges: false,
	relayoutOnChange: true,
	oldschoolColors: false,
};

/**
 * Plain boxes. The fill is resolved separately from the border, which makes this a real white and
 * not a tint of the border colour. `Canvas`/`CanvasText` follow the light/dark theme. The border
 * needs a hex, because the node appends an alpha suffix to it.
 */
type ActivityColor = (name: string, mode?: "normal" | "foreground" | "light" | "surface") => string;
const oldschoolActivityColor: ActivityColor = (_name, mode) => {
	if (mode === "surface") return "Canvas";
	if (mode === "foreground") return "CanvasText";
	return "#374151";
};

const HALF_W = ACT_NODE_WIDTH / 2;
const HALF_H = ACT_NODE_HEIGHT / 2;
/** Perpendicular spread between arcs sharing a source/target pair, so straight mode doesn't stack them. */
const BUNDLE_SPREAD = 18;

type Point = { x: number; y: number };

function straightenEdge(edge: Edge, topLeftById: Map<string, Point>): Edge {
	const s = topLeftById.get(edge.source);
	const t = topLeftById.get(edge.target);
	// Self-loops have no straight form; keep the engine's loop route.
	if (!s || !t || edge.source === edge.target) return edge;
	const sc = { x: s.x + HALF_W, y: s.y + HALF_H };
	const tc = { x: t.x + HALF_W, y: t.y + HALF_H };
	const data = edge.data as ConstraintEdgeData | undefined;
	const total = data?.bundleTotal ?? 1;
	const index = data?.bundleIndex ?? 0;

	let points: Point[];
	if (total > 1) {
		const dx = tc.x - sc.x;
		const dy = tc.y - sc.y;
		const len = Math.hypot(dx, dy) || 1;
		const offset = (index - (total - 1) / 2) * BUNDLE_SPREAD;
		const via = {
			x: (sc.x + tc.x) / 2 + (-dy / len) * offset,
			y: (sc.y + tc.y) / 2 + (dx / len) * offset,
		};
		points = snapEndpointsToNodeBorders([sc, via, tc], sc, tc, HALF_W, HALF_H);
	} else {
		points = snapEndpointsToNodeBorders([sc, tc], sc, tc, HALF_W, HALF_H);
	}

	return {
		...edge,
		data: {
			...edge.data,
			routedPoints: points,
			routedPath: roundedPointsToSvgPath(points, 16),
			layoutSourcePos: s,
			layoutTargetPos: t,
		},
	};
}

export function useOCDeclareLayoutSettings() {
	const [settings, setSettings] = useLocalStorageState<OCDeclareLayoutSettings>(
		STORAGE_KEY,
		DEFAULTS,
	);
	const { straightEdges, relayoutOnChange, oldschoolColors } = { ...DEFAULTS, ...settings };

	const layout = useMemo<DeclareLayoutFn>(
		// Only the arc shape is decided here. Whether a layout runs at all is the viz's call, via the
		// `relayoutOnChange` prop; declining from inside this function still lets it rebuild the
		// graph and settle back, which shows as a flash.
		() => async (nodes, edges, options) => {
			const laid = await wasmDeclareLayout(nodes, edges, options);
			if (!straightEdges) return laid;
			const topLeftById = new Map(laid.nodes.map((n) => [n.id, n.position]));
			return { nodes: laid.nodes, edges: laid.edges.map((e) => straightenEdge(e, topLeftById)) };
		},
		[straightEdges],
	);

	return {
		settings: { straightEdges, relayoutOnChange, oldschoolColors },
		setSettings,
		layout,
		activityColor: oldschoolColors ? oldschoolActivityColor : undefined,
	};
}

export function OCDeclareLayoutSettingsPopover({
	settings,
	setSettings,
}: {
	settings: OCDeclareLayoutSettings;
	setSettings: (update: (prev: OCDeclareLayoutSettings) => OCDeclareLayoutSettings) => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="icon" variant="outline" title="Layout settings" className="bg-white">
					<LuSettings2 />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 flex flex-col gap-y-3">
				<h3 className="font-semibold text-sm">Layout</h3>
				<div className="flex items-start justify-between gap-x-3">
					<div>
						<Label htmlFor="oc-declare-straight-edges">Straight arcs</Label>
						<p className="text-xs text-muted-foreground">
							Draw direct lines instead of routed polylines.
						</p>
					</div>
					<Switch
						id="oc-declare-straight-edges"
						checked={settings.straightEdges}
						onCheckedChange={(v) => setSettings((p) => ({ ...p, straightEdges: v }))}
					/>
				</div>
				<div className="flex items-start justify-between gap-x-3">
					<div>
						<Label htmlFor="oc-declare-oldschool">Plain activities</Label>
						<p className="text-xs text-muted-foreground">
							White boxes with dark borders instead of per-activity colours.
						</p>
					</div>
					<Switch
						id="oc-declare-oldschool"
						checked={settings.oldschoolColors}
						onCheckedChange={(v) => setSettings((p) => ({ ...p, oldschoolColors: v }))}
					/>
				</div>
				<div className="flex items-start justify-between gap-x-3">
					<div>
						<Label htmlFor="oc-declare-relayout-on-change">Automatic re-layout</Label>
						<p className="text-xs text-muted-foreground">
							Runs after moving nodes and changing settings. The Layout button always works.
						</p>
					</div>
					<Switch
						id="oc-declare-relayout-on-change"
						checked={settings.relayoutOnChange}
						onCheckedChange={(v) => setSettings((p) => ({ ...p, relayoutOnChange: v }))}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
