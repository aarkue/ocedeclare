import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";

import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import { ImageIcon } from "@radix-ui/react-icons";
import { toPng } from "html-to-image";
import toast from "react-hot-toast";
import { LuLayoutDashboard } from "react-icons/lu";
import { MdClear } from "react-icons/md";
import { PiPlayFill } from "react-icons/pi";
import { TbLogicAnd, TbSquarePlus } from "react-icons/tb";
import "reactflow/dist/style.css";
import type { EventTypeQualifiers, OCELInfo } from "../../types/ocel";
import { FlowContext } from "./helper/FlowContext";
import { useLayoutedElements } from "./helper/LayoutFlow";
import { VisualEditorContext } from "./helper/VisualEditorContext";
import { EvVarName, ObVarName } from "./helper/box/variable-names";
import {
  EVENT_TYPE_LINK_TYPE,
  EVENT_TYPE_NODE_TYPE,
  GATE_NODE_TYPE,
  edgeTypes,
  nodeTypes,
} from "./helper/const";
import {
  evaluateConstraints,
  getParentNodeID,
  getParentsNodeIDs,
} from "./helper/evaluation/evaluate-constraints";
import {
  ALL_GATE_TYPES,
  type EvaluationRes,
  type EvaluationResPerNodes,
  type EventTypeLinkData,
  type EventTypeNodeData,
  type GateNodeData,
} from "./helper/types";
import clsx from "clsx";

interface VisualEditorProps {
  ocelInfo: OCELInfo;
  eventTypeQualifiers: EventTypeQualifiers;
  children?: ReactNode;
}

export default function VisualEditor(props: VisualEditorProps) {
  const { setInstance, registerOtherDataGetter, otherData, flushData } =
    useContext(FlowContext);

  const [nodes, setNodes, onNodesChange] = useNodesState<
    EventTypeNodeData | GateNodeData
  >(otherData?.nodes ?? []);

  const [edges, setEdges, onEdgesChange] = useEdgesState<EventTypeLinkData>(
    otherData?.edges ?? [],
  );
  const instance = useReactFlow();

  useEffect(() => {
    instance.setNodes(otherData?.nodes ?? nodes);
  }, [otherData?.nodes, otherData?.edges, instance]);

  const backend = useContext(BackendProviderContext);

  const [isEvaluationLoading, setEvaluationLoading] = useState(false);

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
          const parents = getParentsNodeIDs(source, eds);
          if (parents.includes(target)) {
            toast("Invalid connection: Loops are forbidden!", {
              position: "bottom-center",
            });
            console.warn("Loop connection attempted!");
            return eds;
          }
          console.log({ parents, source, target });
          const color = "#969696";
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
              color: "#000000ff",
            },
            style: {
              strokeWidth: 2,
              stroke: color,
            },
            data: {
              color,
              minCount: null,
              maxCount: null,
            },
          };
          return addEdge(newEdge, eds);
        }
      });
    },
    [setEdges],
  );

  const { getLayoutedElements } = useLayoutedElements();

  const [violationDetails, setViolationDetails] = useState<EvaluationRes>();

  const [violationInfo, setViolationInfo] = useState<{
    violationsPerNode?: EvaluationResPerNodes;
    showViolationsFor?: (data: EvaluationRes) => unknown;
  }>({
    showViolationsFor: (d) => {
      console.log({ d });
      setViolationDetails(d);
    },
    violationsPerNode: otherData?.violations,
  });

  useEffect(() => {
    registerOtherDataGetter(() => ({
      violations: violationInfo.violationsPerNode,
    }));
  }, [violationInfo]);
  const initialized = useRef<boolean>(false);

  function getAvailableVars(
    nodeID: string | undefined,
    type: "event" | "object",
  ): (EventVariable | ObjectVariable)[] {
    if (nodeID === undefined) {
      return [];
    }
    const node = instance.getNode(nodeID) as Node<
      EventTypeNodeData | GateNodeData
    > | null;
    let ret: (EventVariable | ObjectVariable)[] = [];
    if (node == null) {
      console.warn("getAvailableVars for unknown id: " + nodeID, instance);
      return ret;
    }
    if ("box" in node.data) {
      ret = [
        ...Object.keys(
          type === "event"
            ? node.data.box.newEventVars
            : node.data.box.newObjectVars,
        ).map((n) => parseInt(n)),
        ...getAvailableVars(getParentNodeID(nodeID, edges), type),
      ];
    } else {
      ret = getAvailableVars(getParentNodeID(nodeID, edges), type);
    }
    ret.sort((a, b) => a - b);
    return ret;
  }

  const COLORS = {
    // https://colordesigner.io/color-scheme-builder?mode=lch#0067A6-FA9805-CE2727-00851D-A90A76-E0F20D-e9488f-0481cc-16cc9d-080999
    object: [
      "#0067A6",
      "#FA9805",
      "#CE2727",
      "#00851D",
      "#A90A76",
      "#E0F20D",
      "#e9488f",
      "#0481cc",
      "#16cc9d",
      "#080999",
    ],
    event: [
      "#01425e",
      "#53077f",
      "#db11c3",
      "#b76b00",
      "#506b01",
      "#aa082b",
      "#006289",
      "#758406",
    ],
  } as const;
  return (
    <VisualEditorContext.Provider
      value={{
        ocelInfo: props.ocelInfo,
        violationsPerNode: violationInfo.violationsPerNode,
        showViolationsFor: violationInfo.showViolationsFor,
        getAvailableVars,
        getVarName: (variable, type) => {
          return {
            name: type.substring(0, 2) + "_" + variable,
            color: COLORS[type][variable % COLORS[type].length],
          };
        },
        onNodeDataChange: (id, newData) => {
          setNodes((ns) => {
            const newNodes = [...ns];
            const changedNodeIndex = newNodes.findIndex((n) => n.id === id);
            if (newData === undefined) {
              newNodes.splice(changedNodeIndex, 1);
              setEdges((edges) =>
                [...edges].filter((e) => e.source !== id && e.target !== id),
              );
              return newNodes;
            }
            const changedNode = newNodes[changedNodeIndex];
            if (changedNode?.data !== undefined) {
              changedNode.data = {
                ...changedNode.data,
                ...newData,
              };
            } else {
              console.warn("Did not find changed node data");
            }
            return newNodes;
          });
          if (newData === undefined) {
            setEdges((edges) =>
              edges.filter((e) => e.source !== id && e.target !== id),
            );
          }
        },
        onEdgeDataChange: (id, newData) => {
          if (newData !== undefined) {
            setEdges((es) => {
              const newEdges = [...es];
              const changedEdge = newEdges.find((e) => e.id === id);
              if (changedEdge?.data !== undefined) {
                changedEdge.data = { ...changedEdge.data, ...newData };
              } else {
                console.warn("Did not find changed edge data");
              }
              return newEdges;
            });
          } else {
            setEdges((edges) => {
              const newEdges = edges.filter((e) => e.id !== id);
              return newEdges;
            });
          }
        },
      }}
    >
      <ReactFlow
        onInit={(flow) => {
          initialized.current = true;
          if (initialized.current) {
            setInstance(flow);
          }
        }}
        defaultViewport={otherData?.viewport}
        maxZoom={10}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
      >
        <Controls onInteractiveChange={() => {}} />
        <Panel position="top-right" className="flex gap-x-2">
          <Button
            variant="outline"
            size="icon"
            title="Apply automatic layout"
            className="bg-white"
            onClick={() => {
              instance?.fitView();
              getLayoutedElements({}, true);
              setTimeout(() => {
                instance?.fitView();
              }, 200);
            }}
          >
            <LuLayoutDashboard />
          </Button>

          <Button
            variant="outline"
            size="icon"
            title="Save PNG"
            className="bg-white"
            onClick={(ev) => {
              const button = ev.currentTarget;
              button.disabled = true;
              const scaleFactor = 2.0;
              const viewPort = document.querySelector(
                ".react-flow__viewport",
              ) as HTMLElement;
              setTimeout(() => {
                void toPng(viewPort, {
                  canvasHeight: viewPort.clientHeight * scaleFactor,
                  canvasWidth: viewPort.clientWidth * scaleFactor,
                })
                  .then((dataURL) => {
                    const a = document.createElement("a");
                    a.setAttribute("download", "oced-declare-export.png");
                    a.setAttribute("href", dataURL);
                    a.click();
                  })
                  .finally(() => {
                    button.disabled = false;
                  });
              }, 50);
            }}
          >
            <ImageIcon />
          </Button>
          {props.children}
          <AlertHelper
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            initialData={{ type: "not" } as GateNodeData}
            trigger={
              <Button
                variant="outline"
                title="Add Gate"
                className="bg-white"
                onClick={() => {}}
              >
                <TbLogicAnd size={20} />
              </Button>
            }
            title={"Add Gate"}
            submitAction={"Submit"}
            onSubmit={(data) => {
              setNodes((nodes) => {
                const center =
                  instance != null
                    ? instance.screenToFlowPosition({
                        x: window.innerWidth / 2,
                        y: window.innerHeight / 2,
                      })
                    : { x: 0, y: 0 };
                return [
                  ...nodes,
                  {
                    id: "gate" + Date.now(),
                    type: GATE_NODE_TYPE,
                    position: center,
                    data: {
                      type: data.type,
                    },
                  },
                ];
              });
            }}
            content={({ data, setData }) => {
              const sortedOcelEventTypes = [...props.ocelInfo.event_types];
              sortedOcelEventTypes.sort((a, b) => a.name.localeCompare(b.name));
              return (
                <>
                  <p className="mb-2">
                    Please select the type of gate to add below.
                  </p>
                  <Combobox
                    value={data.type}
                    onChange={(v) => {
                      setData({ ...data, type: v as GateNodeData["type"] });
                    }}
                    name="Gate Type"
                    options={ALL_GATE_TYPES.map((t) => ({
                      label: t,
                      value: t,
                    }))}
                  ></Combobox>
                </>
              );
            }}
          />
          <Button
            variant="outline"
            title="Add Event Node"
            className="bg-white"
            onClick={() => {
              setNodes((nodes) => {
                const center =
                  instance != null
                    ? instance.screenToFlowPosition({
                        x: window.innerWidth / 2,
                        y: window.innerHeight / 1.5,
                      })
                    : { x: 0, y: 0 };
                return [
                  ...nodes,
                  {
                    id: Math.random() + "-" + Date.now(),
                    type: EVENT_TYPE_NODE_TYPE,
                    position: center,
                    data: {
                      box: {
                        newEventVars: {},
                        newObjectVars: {},
                        filterConstraint: [],
                      },
                    },
                  },
                ];
              });
            }}
          >
            <TbSquarePlus size={20} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            title={"Clear evaluation"}
            className=""
            onClick={async () => {
              setViolationInfo({});
              flushData({ violations: undefined });
            }}
          >
            <MdClear size={20} className="text-red-400" />
          </Button>
          <Button
            disabled={isEvaluationLoading}
            variant="outline"
            title="Evaluate"
            className="relative bg-fuchsia-100 disabled:bg-fuchsia-200 border-fuchsia-300 hover:bg-fuchsia-200 hover:border-fuchsia-300"
            onClick={async () => {
              setEvaluationLoading(true);
              const { tree, nodesOrder } = evaluateConstraints(nodes, edges);
              console.log({ tree });
              try {
                const res = await toast.promise(
                  backend["ocel/check-constraints-box"](tree),
                  {
                    loading: "Evaluating...",
                    success: (res) => (
                      <span>
                        <b>Evaluation finished</b>
                        <br />
                        <span>
                          Situations per step:
                          <br />
                          <span className="font-mono">
                            {res.evaluationResults
                              .map((r) => r.situationCount)
                              .join(", ")}
                          </span>
                          <br />
                          Violations per step:
                          <br />
                          <span className="font-mono">
                            {res.evaluationResults
                              .map((r) => r.situationViolatedCount)
                              .join(", ")}
                          </span>
                        </span>
                      </span>
                    ),
                    error: "Evaluation failed",
                  },
                );
                const evalRes: Record<string, EvaluationRes> =
                  Object.fromEntries(
                    res.evaluationResults.map((res, i) => [
                      nodesOrder[i].id,
                      res,
                    ]),
                  );
                setViolationInfo((vi) => ({
                  ...vi,
                  violationsPerNode: {
                    evalRes,
                    objectIds: res.objectIds,
                    eventIds: res.eventIds,
                  },
                }));
                flushData({
                  violations: {
                    evalRes,
                    objectIds: res.objectIds,
                    eventIds: res.eventIds,
                  },
                });
              } catch (e) {
              } finally {
                setEvaluationLoading(false);
              }
            }}
          >
            {isEvaluationLoading && (
              <div className="w-7 h-7 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <Spinner className="w-7 h-7 text-purple-600" />
              </div>
            )}
            <PiPlayFill
              size={20}
              className={clsx(
                !isEvaluationLoading && "text-fuchsia-700",
                isEvaluationLoading && "text-gray-600",
              )}
            />
          </Button>
        </Panel>
        <Background />
      </ReactFlow>
      {violationDetails !== undefined &&
        violationInfo.violationsPerNode !== undefined && (
          <ViolationDetailsSheet
            violationDetails={violationDetails}
            setViolationDetails={setViolationDetails}
            violationResPerNodes={violationInfo.violationsPerNode}
          />
        )}
    </VisualEditorContext.Provider>
  );
}

const ViolationDetailsSheet = memo(function ViolationDetailsSheet({
  violationDetails,
  violationResPerNodes,
  setViolationDetails,
}: {
  violationDetails: EvaluationRes;
  violationResPerNodes: EvaluationResPerNodes;
  setViolationDetails: React.Dispatch<
    React.SetStateAction<EvaluationRes | undefined>
  >;
}) {
  const SITUATIONS_TO_SHOW = 100;
  const [mode, setMode] = useState<"violations" | "situations">("violations");

  console.log({ violationDetails, violationResPerNodes });
  return (
    <Sheet
      modal={false}
      open={violationDetails !== undefined}
      onOpenChange={(o) => {
        if (!o) {
          setViolationDetails(undefined);
        }
      }}
    >
      {violationDetails !== undefined && (
        <SheetContent
          side="left"
          className="h-screen flex flex-col"
          overlay={false}
          onInteractOutside={(ev) => {
            ev.preventDefault();
          }}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between pr-4">
              {mode === "situations" ? "Situations" : "Violations"}{" "}
              <Button
                variant="outline"
                onClick={() =>
                  setMode(mode === "violations" ? "situations" : "violations")
                }
              >
                Show{" "}
                {mode !== "situations" ? "All Situations" : "Only Violations"}
              </Button>
            </SheetTitle>
            <SheetDescription>
              {mode === "violations"
                ? violationDetails.situationViolatedCount
                : violationDetails.situationCount}{" "}
              {mode === "situations" ? "Situations" : "Violations"}
              {(mode === "violations"
                ? violationDetails.situationViolatedCount
                : violationDetails.situationCount) > SITUATIONS_TO_SHOW && (
                <>
                  <br />
                  {
                    <span className="text-xs">
                      Showing only the first {SITUATIONS_TO_SHOW}{" "}
                      {mode === "situations" ? "Situations" : "Violations"}
                    </span>
                  }
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          <ul className="overflow-auto h-full bg-slate-50 border rounded-sm mt-2 px-2 py-0.5 text-xs">
            {(mode === "violations"
              ? violationDetails.situations.filter(
                  ([_binding, reason]) => reason !== null,
                )
              : violationDetails.situations
            )
              .slice(0, SITUATIONS_TO_SHOW)
              .map(([binding, reason], i) => (
                <li
                  key={i}
                  className="border mx-1 my-2 px-1 py-1 rounded-sm bg-blue-50 text-lg"
                >
                  <div>
                    <p className="text-orange-600">{reason}</p>
                    <span className="text-emerald-700 font-bold">
                      Events:
                    </span>{" "}
                    <ul className="flex flex-col ml-6 list-disc">
                      {Object.entries(binding.eventMap).map(
                        ([evVarName, evIndex]) => (
                          <li key={evVarName}>
                            <EvVarName eventVar={parseInt(evVarName)} />:{" "}
                            {violationResPerNodes.eventIds[evIndex]}
                          </li>
                        ),
                      )}
                    </ul>
                    <h3 className="text-blue-700 font-bold">Objects:</h3>
                    <ul className="flex flex-col ml-6 list-disc">
                      {Object.entries(binding.objectMap).map(
                        ([obVarName, obIndex]) => (
                          <li key={obVarName}>
                            <ObVarName obVar={parseInt(obVarName)} />:{" "}
                            {violationResPerNodes.objectIds[obIndex]}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                </li>
              ))}
          </ul>
        </SheetContent>
      )}
    </Sheet>
  );
});
