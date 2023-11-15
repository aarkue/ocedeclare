import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from "reactflow";

import { OcelInfoContext } from "@/App";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { LuLayoutDashboard } from "react-icons/lu";
import { RxReset } from "react-icons/rx";
import { TbBinaryTree, TbRestore } from "react-icons/tb";
import "reactflow/dist/style.css";
import type { EventTypeQualifiers, OCELInfo } from "../../types/ocel";
import { constructTree, getDependencyType } from "./evaluation/construct-tree";
import ConnectionLine from "./helper/ConnectionLine";
import EventTypeLink, {
  EVENT_TYPE_LINK_TYPE,
  type EventTypeLinkData,
} from "./helper/EventTypeLink";
import EventTypeNode, { type EventTypeNodeData } from "./helper/EventTypeNode";
import { useLayoutedElements } from "./helper/LayoutFlow";
import { VisualEditorContext } from "./helper/visual-editor-context";
import { extractFromHandleID } from "./helper/visual-editor-utils";

interface VisualEditorProps {
  ocelInfo: OCELInfo;
  eventTypeQualifiers: EventTypeQualifiers;
}
const COLORS = [
  "#1f78b4", // Blue
  "#33a02c", // Green
  "#e31a1c", // Red
  "#ff7f00", // Orange
  "#6a3d9a", // Purple
  "#b2df8a", // Light Green
  "#fb9a99", // Light Red
  "#fdbf6f", // Light Orange
  "#cab2d6", // Light Purple
  "#ffff99", // Yellow
];
const nodeTypes = { eventType: EventTypeNode };
const edgeTypes = { [EVENT_TYPE_LINK_TYPE]: EventTypeLink };

function VisualEditor(props: VisualEditorProps) {
  const [mode, setMode] = useState<"normal" | "view-tree" | "readonly">(
    "normal",
  );

  const objectTypeToColor: Record<string, string> = useMemo(() => {
    const ret: Record<string, string> = {};
    props.ocelInfo.object_types.forEach((type, i) => {
      ret[type.name] = COLORS[i % COLORS.length];
    });
    return ret;
  }, [props.eventTypeQualifiers]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  const [nodes, _setNodes, onNodesChange] = useNodesState<EventTypeNodeData>(
    Object.keys(props.eventTypeQualifiers).map((eventType) => {
      return {
        id: eventType,
        type: "eventType",
        position: { x: 0, y: 0 },
        data: {
          label: eventType,
          eventTypeQualifier: props.eventTypeQualifiers[eventType],
          objectTypeToColor,
        },
      };
    }),
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState<EventTypeLinkData>([]);

  const onConnect = useCallback(
    ({ source, sourceHandle, target, targetHandle }: Edge | Connection) => {
      setEdges((eds) => {
        if (
          source === null ||
          target == null ||
          sourceHandle == null ||
          targetHandle == null
        ) {
          return eds;
        } else {
          const sourceHandleInfo = extractFromHandleID(sourceHandle);
          const targetHandleInfo = extractFromHandleID(targetHandle);
          // objectType is the same for source/target (connecting non-matching types is prevented by the Handle)
          const objectType = sourceHandleInfo.objectType;
          const color = objectTypeToColor[objectType];
          const dependencyType = getDependencyType(
            props.eventTypeQualifiers[source][sourceHandleInfo.qualifier]
              .multiple,
            props.eventTypeQualifiers[target][targetHandleInfo.qualifier]
              .multiple,
          );
          const newEdge: Edge<EventTypeLinkData> = {
            id: sourceHandle + "|||" + targetHandle,
            type: EVENT_TYPE_LINK_TYPE,
            source,
            sourceHandle,
            target,
            targetHandle,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 15,
              height: 12,
              color,
            },
            style: {
              strokeWidth: dependencyType === "all" ? 4 : 2,
              stroke: color,
            },
            data: {
              color,
              dependencyType,
              variable:
                (dependencyType === "all"
                  ? objectType.substring(0, 1).toUpperCase()
                  : objectType.substring(0, 1)) + "1",
              onVariableChange: (change) => {
                setEdges((es) => {
                  const newEdges = [...es];
                  const changedEdge = newEdges.find(
                    (e) => e.id === change.linkID,
                  );
                  if (changedEdge?.data !== undefined) {
                    changedEdge.data.variable = change.newValue;
                  } else {
                    console.warn("Did not find changed edge data");
                  }
                  return es;
                });
              },
              onDelete: (id: string) => {
                setEdges((edges) => {
                  const newEdges = edges.filter((e) => e.id !== id);
                  return newEdges;
                });
              },
            },
          };
          return addEdge(newEdge, eds);
        }
      });
    },
    [setEdges],
  );

  const { getLayoutedElements } = useLayoutedElements();

  return (
    <VisualEditorContext.Provider value={{ mode }}>
      <ReactFlow
        onInit={(flow) => {
          getLayoutedElements(
            {
              "elk.algorithm": "layered",
              "elk.direction": "RIGHT",
            },
            false,
          );
          setTimeout(() => {
            flow.fitView({ duration: 300 });
          }, 200);
        }}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        nodesConnectable={mode === "normal"}
        nodesDraggable={mode === "normal" || mode === "view-tree"}
        elementsSelectable={mode === "normal"}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        connectionLineComponent={(props) => (
          <ConnectionLine {...props} objectTypeToColor={objectTypeToColor} />
        )}
      >
        <Controls
          onInteractiveChange={(status) => {
            if (status) {
              setMode("normal");
            } else {
              setMode("readonly");
            }
          }}
        />
        <Panel position="top-right" className="flex gap-x-2">
          <Button
            disabled={edges.length === 0 || mode !== "normal"}
            variant="outline"
            size="icon"
            title="Reset edges"
            className="text-red-600 bg-white hover:bg-red-400"
            onClick={() => {
              setEdges([]);
            }}
          >
            <RxReset />
          </Button>

          <Button
            variant="outline"
            size="icon"
            title={mode !== "view-tree" ? "Construct tree" : "Edit"}
            className="bg-white"
            onClick={() => {
              constructTree(props.eventTypeQualifiers, edges);
            }}
          >
            {mode !== "view-tree" && <TbBinaryTree />}
            {mode === "view-tree" && <TbRestore />}
          </Button>

          <Button
            disabled={mode !== "normal"}
            variant="outline"
            size="icon"
            title="Apply automatic layout"
            className="bg-white"
            onClick={() => {
              getLayoutedElements(
                {
                  "elk.algorithm": "layered",
                  "elk.direction": "RIGHT",
                },
                true,
              );
            }}
          >
            <LuLayoutDashboard />
          </Button>
        </Panel>
        <Background />
      </ReactFlow>
    </VisualEditorContext.Provider>
  );
}

export default function VisualEditorOuter() {
  const [qualifiers, setQualifiers] = useState<EventTypeQualifiers>();
  const ocelInfo = useContext(OcelInfoContext);
  useEffect(() => {
    toast
      .promise(
        fetch("http://localhost:3000/ocel/qualifiers", { method: "get" }),
        {
          loading: "Fetching qualifier info...",
          success: "Loaded qualifier info",
          error: "Failed to fetch qualifier info",
        },
        { id: "fetch-qualifiers" },
      )
      .then(async (res) => {
        const json: EventTypeQualifiers = await res.json();
        setQualifiers(json);
      })
      .catch((e) => {
        console.error(e);
      });
  }, []);

  return (
    <div className="max-h-[80vh] border mx-auto w-[calc(100%-4rem)] h-full">
      <ReactFlowProvider>
        {qualifiers !== undefined && ocelInfo !== undefined && (
          <>
            <VisualEditor
              eventTypeQualifiers={qualifiers}
              ocelInfo={ocelInfo}
            />
          </>
        )}
      </ReactFlowProvider>
    </div>
  );
}
