import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { v4 } from "uuid";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import { EVENT_TYPE_LINK_TYPE, EVENT_TYPE_NODE_TYPE, GATE_NODE_TYPE } from "./const";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "./types";

const POS_SCALE = 0.333;

export function bindingBoxTreeToNodes(
	tree: BindingBoxTree,
	index: number,
	positionX: number,
	positionY: number,
	idPrefix: string,
): [Node<EventTypeNodeData | GateNodeData>[], Edge<EventTypeLinkData>[]] {
	function getNodeID(nodeIndex: number) {
		return `${idPrefix}-node-${nodeIndex}`;
	}
	function getEdgeID(fromIndex: number, toIndex: number) {
		return `${idPrefix}-edge-${fromIndex}-to-${toIndex}`;
	}

	function getEdgeData(fromIndex: number, toIndex: number): EventTypeLinkData {
		const edgeData = tree.edgeNames.find(([[a, b]]) => a === fromIndex && b === toIndex);
		return {
			color: "#969696",
			minCount: null,
			maxCount: null,
			name: edgeData != null ? edgeData[1] : undefined,
		};
	}
	const treeNode = tree.nodes[index];
	const nodes: Node<EventTypeNodeData | GateNodeData>[] = [];
	const edges: Edge<EventTypeLinkData>[] = [];
	if ("Box" in treeNode) {
		nodes.push({
			type: EVENT_TYPE_NODE_TYPE,
			data: { box: treeNode.Box[0] },
			id: getNodeID(index),
			position: { x: positionX, y: positionY },
		});
		const WIDTH_SPREAD = treeNode.Box[1].length > 1 ? 500 : 0;
		const childSpacing = WIDTH_SPREAD / treeNode.Box[1].length;
		let childPositionX = positionX - WIDTH_SPREAD / 2;
		for (const childIndex of treeNode.Box[1]) {
			const [n1, e1] = bindingBoxTreeToNodes(
				tree,
				childIndex,
				childPositionX,
				positionY + POS_SCALE * 600,
				idPrefix,
			);
			edges.push({
				id: getEdgeID(index, childIndex),
				source: getNodeID(index),
				target: getNodeID(childIndex),
				sourceHandle: `${getNodeID(index)}-source`,
				targetHandle: `${getNodeID(childIndex)}-target`,
				type: EVENT_TYPE_LINK_TYPE,
				markerEnd: {
					type: MarkerType.ArrowClosed,
					width: 15,
					height: 12,
					color: "#000000ff",
				},
				style: {
					strokeWidth: 2,
					stroke: "#969696",
				},
				data: getEdgeData(index, childIndex),
			});
			nodes.push(...n1);
			edges.push(...e1);
			childPositionX += childSpacing;
		}
	} else if ("OR" in treeNode) {
		nodes.push({
			id: getNodeID(index),
			position: { x: positionX, y: positionY },
			data: { type: "or" },
			type: GATE_NODE_TYPE,
		});
		edges.push({
			id: getEdgeID(index, treeNode.OR[0]),
			source: getNodeID(index),
			target: getNodeID(treeNode.OR[0]),
			sourceHandle: `${getNodeID(index)}-left-source`,
			targetHandle: `${getNodeID(treeNode.OR[0])}-target`,
			type: EVENT_TYPE_LINK_TYPE,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 15,
				height: 12,
				color: "#000000ff",
			},
			style: {
				strokeWidth: 2,
				stroke: "#969696",
			},
			data: getEdgeData(index, treeNode.OR[0]),
		});
		edges.push({
			id: getEdgeID(index, treeNode.OR[1]),
			source: getNodeID(index),
			target: getNodeID(treeNode.OR[1]),
			sourceHandle: `${getNodeID(index)}-right-source`,
			targetHandle: `${getNodeID(treeNode.OR[1])}-target`,
			type: EVENT_TYPE_LINK_TYPE,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 15,
				height: 12,
				color: "#000000ff",
			},
			style: {
				strokeWidth: 2,
				stroke: "#969696",
			},
			data: getEdgeData(index, treeNode.OR[1]),
		});

		const [n1, e1] = bindingBoxTreeToNodes(
			tree,
			treeNode.OR[0],
			positionX - POS_SCALE * 400,
			positionY + POS_SCALE * 500,
			idPrefix,
		);
		const [n2, e2] = bindingBoxTreeToNodes(
			tree,
			treeNode.OR[1],
			positionX + POS_SCALE * 400,
			positionY + POS_SCALE * 500,
			idPrefix,
		);
		nodes.push(...n1, ...n2);
		edges.push(...e1, ...e2);
	} else if ("AND" in treeNode) {
		nodes.push({
			id: getNodeID(index),
			position: { x: positionX, y: positionY },
			data: { type: "and" },
			type: GATE_NODE_TYPE,
		});
		edges.push({
			id: getEdgeID(index, treeNode.AND[0]),
			source: getNodeID(index),
			target: getNodeID(treeNode.AND[0]),
			sourceHandle: `${getNodeID(index)}-left-source`,
			targetHandle: `${getNodeID(treeNode.AND[0])}-target`,
			type: EVENT_TYPE_LINK_TYPE,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 15,
				height: 12,
				color: "#000000ff",
			},
			style: {
				strokeWidth: 2,
				stroke: "#969696",
			},
			data: getEdgeData(index, treeNode.AND[0]),
		});
		edges.push({
			id: getEdgeID(index, treeNode.AND[1]),
			source: getNodeID(index),
			target: getNodeID(treeNode.AND[1]),
			sourceHandle: `${getNodeID(index)}-right-source`,
			targetHandle: `${getNodeID(treeNode.AND[1])}-target`,
			type: EVENT_TYPE_LINK_TYPE,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 15,
				height: 12,
				color: "#000000ff",
			},
			style: {
				strokeWidth: 2,
				stroke: "#969696",
			},
			data: getEdgeData(index, treeNode.AND[1]),
		});

		const [n1, e1] = bindingBoxTreeToNodes(
			tree,
			treeNode.AND[0],
			positionX - POS_SCALE * 400,
			positionY + POS_SCALE * 500,
			idPrefix,
		);
		const [n2, e2] = bindingBoxTreeToNodes(
			tree,
			treeNode.AND[1],
			positionX + POS_SCALE * 400,
			positionY + POS_SCALE * 500,
			idPrefix,
		);
		nodes.push(...n1, ...n2);
		edges.push(...e1, ...e2);
	} else if ("NOT" in treeNode) {
		nodes.push({
			id: getNodeID(index),
			position: { x: positionX, y: positionY },
			data: { type: "not" },
			type: GATE_NODE_TYPE,
		});
		edges.push({
			id: getEdgeID(index, treeNode.NOT),
			source: getNodeID(index),
			target: getNodeID(treeNode.NOT),
			sourceHandle: `${getNodeID(index)}-source`,
			targetHandle: `${getNodeID(treeNode.NOT)}-target`,
			type: EVENT_TYPE_LINK_TYPE,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 15,
				height: 12,
				color: "#000000ff",
			},
			style: {
				strokeWidth: 2,
				stroke: "#969696",
			},
			data: getEdgeData(index, treeNode.NOT),
		});
		const [n1, e1] = bindingBoxTreeToNodes(
			tree,
			treeNode.NOT,
			positionX,
			positionY + POS_SCALE * 500,
			idPrefix,
		);
		nodes.push(...n1);
		edges.push(...e1);
	}
	return [nodes, edges];
}

/** An empty box at `position`, the shape both "Add Node" and a freshly created query start from. */
export function emptyBoxNode(position: { x: number; y: number }): Node<EventTypeNodeData> {
	return {
		id: v4(),
		type: EVENT_TYPE_NODE_TYPE,
		position,
		data: {
			box: {
				newEventVars: {},
				newObjectVars: {},
				filters: [],
				sizeFilters: [],
				constraints: [],
				evVarLabels: {},
				obVarLabels: {},
			},
		},
	};
}
