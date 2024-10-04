import AlertHelper from "@/components/AlertHelper";
import clsx from "clsx";
import { memo, useContext, useState } from "react";
import { TbTrash } from "react-icons/tb";
import { Handle, Position, type NodeProps } from "reactflow";
import { VisualEditorContext } from "../VisualEditorContext";
import FilterChooser from "../box/FilterChooser";
import NewVariableChooser from "../box/NewVariablesChooser";
import type { EventTypeNodeData } from "../types";
import MiscNodeConstraints from "./MiscNodeConstraints";
import ViolationIndicator from "./ViolationIndicator";
import { getViolationStyles } from "../violation-styles";
import SituationIndicator from "./SituationIndicator";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
} from "@/components/ui/context-menu";
import { LuTrash } from "react-icons/lu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
export default memo(EventTypeNode);
function EventTypeNode({ data, id, selected }: NodeProps<EventTypeNodeData>) {
  const { violationsPerNode, onNodeDataChange } =
    useContext(VisualEditorContext);

  const violations =
    violationsPerNode === undefined || data.hideViolations === true
      ? undefined
      : violationsPerNode.evalRes[id];

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={clsx(
            "border-2 shadow-lg z-10 flex flex-col py-1 pb-2 px-0.5 rounded-md relative min-h-[5rem] w-[15rem]",
            getViolationStyles(violations, data.box.constraints.length === 0),
            selected && "border-dashed",
          )}
        >
          {/* <Toggle
        className="flex w-6 h-6 p-0 absolute right-11"
        variant="outline"
        title={
          data.hideViolations === true
            ? "Hide violations (just filter)"
            : "Show violations"
        }
        pressed={data.hideViolations === true}
        onPressedChange={(pressed) => {
          onNodeDataChange(id, { ...data, hideViolations: pressed });
        }}
      >
        {data.hideViolations !== true && (
          <PiSirenDuotone className="text-blue-500" />
        )}
        {data.hideViolations === true && (
          <PiSirenThin className="text-gray-400" />
        )}
      </Toggle> */}
          {violations !== undefined && (
            <SituationIndicator
              violationsPerNode={violations}
              hasNoConstraints={data.box.constraints.length === 0}
              nodeID={id}
            />
          )}
          {violations !== undefined &&
            (violations.situationViolatedCount > 0 ||
              data.box.constraints.length >= 1) && (
              <ViolationIndicator violationsPerNode={violations} nodeID={id} />
            )}
          <div className="text-large font-semibold mx-4 flex flex-col justify-center items-center">
            <MiscNodeConstraints
              id={id}
              data={data}
              onNodeDataChange={onNodeDataChange}
            />
            <NewVariableChooser
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
            <FilterChooser
              type="filter"
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
            <FilterChooser
              type="constraint"
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
          </div>
          <div>
            <Handle
              className="!w-3 !h-3"
              position={Position.Top}
              type="target"
              id={id + "-target"}
            />

            <Handle
              className="!w-3 !h-3"
              position={Position.Bottom}
              type="source"
              id={id + "-source"}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <AlertDialog
        open={deleteAlertOpen}
        onOpenChange={(op) => setDeleteAlertOpen(op)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This node and all contained variables, filters, and constraints
              will be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onNodeDataChange(id, undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem>Cancel</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setDeleteAlertOpen(true);
            }}
            className="font-semibold text-red-400 focus:text-red-500"
          >
            <LuTrash className="mr-1" /> Delete Node
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
