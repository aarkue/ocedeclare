import AlertHelper from "@/components/AlertHelper";
import { Combobox } from "@/components/ui/combobox";
import { Toggle } from "@/components/ui/toggle";
import type { EventTypeQualifierInfo } from "@/types/ocel";
import {
  CheckCircledIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";
import { useContext, useEffect } from "react";
import { LuLink, LuUnlink, LuX } from "react-icons/lu";
import { PiSirenDuotone, PiSirenThin } from "react-icons/pi";
import { TbTrash } from "react-icons/tb";
import { Handle, Position, type NodeProps } from "reactflow";
import { ConstraintInfoContext } from "../ConstraintInfoContext";
import { VisualEditorContext } from "../VisualEditorContext";
import { parseIntAllowInfinity } from "../infinity-input";
import type {
  CountConstraint,
  EventTypeNodeData,
  ObjectVariable,
} from "../types";
import MiscNodeConstraints from "./MiscNodeConstraints";
function getObjectType(qualInfo: EventTypeQualifierInfo) {
  if (qualInfo.object_types.length > 1) {
    console.warn(
      "Warning: Encountered multiple object types. This is currently not supported",
    );
  }
  return qualInfo.object_types[0];
}

export default function EventTypeNode({
  data,
  id,
}: NodeProps<EventTypeNodeData>) {
  // Sort by object type
  const qualifiers = Object.keys(data.eventTypeQualifier).sort((a, b) =>
    getObjectType(data.eventTypeQualifier[a]).localeCompare(
      getObjectType(data.eventTypeQualifier[b]),
    ),
  );
  const qualifierPerObjectType: Record<string, string[]> = {};
  for (const ot of Object.keys(data.objectTypeToColor)) {
    qualifierPerObjectType[ot] = qualifiers.filter((q) =>
      data.eventTypeQualifier[q].object_types.includes(ot),
    );
  }

  const { violationsPerNode, showViolationsFor, onNodeDataChange } =
    useContext(VisualEditorContext);
  const violations =
    data.hideViolations === true
      ? undefined
      : violationsPerNode?.find((v) => v.nodeID === id);

  const { objectVariables } = useContext(ConstraintInfoContext);
  const hasAssociatedObjects = data.selectedVariables.length > 0;

  function getCountConstraint(): CountConstraint {
    return data.countConstraint;
  }

  useEffect(() => {
    const newSelectedVariables = data.selectedVariables.filter((v) =>
      objectVariables.find(
        (ov) => ov.name === v.variable.name && ov.type === v.variable.type,
      ),
    );
    if (newSelectedVariables.length !== data.selectedVariables.length) {
      onNodeDataChange(id, {
        selectedVariables: newSelectedVariables,
      });
    }
  }, [objectVariables]);

  function handleCountInput(
    type: "min" | "max",
    ev:
      | React.FocusEvent<HTMLInputElement>
      | React.KeyboardEvent<HTMLInputElement>,
  ) {
    let value = parseIntAllowInfinity(ev.currentTarget.value);
    if (value === undefined) {
      return;
    }
    value = Math.max(0, value);
    if (!isNaN(value)) {
      ev.currentTarget.value = value === Infinity ? "∞" : value.toString();
    }
    const newCountConstraint = getCountConstraint();
    if (type === "min") {
      newCountConstraint.min = value;
    } else {
      newCountConstraint.max = value;
    }
    onNodeDataChange(id, {
      countConstraint: newCountConstraint,
    });
  }
  const countConstraint = getCountConstraint();
  const canAddObjects =
    objectVariables.filter((ot) => qualifierPerObjectType[ot.type].length > 0)
      .length > 0;
  return (
    <div
      className={`border shadow z-10 backdrop-blur flex flex-col py-2 px-0.5 rounded-md relative ${
        violations !== undefined
          ? violations.violations.length > 0
            ? "bg-red-100/70  border-red-200"
            : "bg-emerald-50/70  border-emerald-200 "
          : "bg-blue-50/70 border-blue-200"
      }`}
    >
      <Toggle
        className="flex w-6 h-6 p-0 absolute left-1"
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
      </Toggle>
      {violations?.violations !== undefined && (
        <button
          onClick={() => {
            if (showViolationsFor !== undefined) {
              showViolationsFor(violations);
            }
          }}
          className={`absolute right-1 top-1 text-xs flex flex-col items-center gap-x-1 border border-transparent px-1 py-0.5 rounded-sm hover:bg-amber-100/70 hover:border-gray-400/50`}
          title={`Found ${violations.violations.length} Violations of ${violations.numBindings} Bindings`}
        >
          {violations.violations.length > 0 && (
            <ExclamationTriangleIcon className="text-red-400 h-3 mt-1" />
          )}
          {violations.violations.length === 0 && (
            <CheckCircledIcon className="text-green-400 h-3" />
          )}
          <div className="flex flex-col items-center justify-center">
            {violations.violations.length}
            <div className="text-[0.6rem] leading-none text-muted-foreground">
              {Math.round(
                100 *
                  100 *
                  (violations.violations.length / violations.numBindings),
              ) / 100.0}
              %
            </div>
          </div>
        </button>
      )}

      <AlertHelper
        trigger={
          <button
            className="absolute -top-3.5 right-1 opacity-10 hover:opacity-100 hover:text-red-500"
            title="Delete node"
          >
            <TbTrash size={12} />
          </button>
        }
        title="Are you sure?"
        initialData={undefined}
        content={() => (
          <>This node and all contained constraints will be deleted.</>
        )}
        submitAction="Delete"
        onSubmit={() => {
          onNodeDataChange(id, undefined);
        }}
      />
      <div className="absolute left-2 -top-[1.1rem] px-1 border border-b-0 border-inherit bg-inherit text-xs z-0">
        <input
          disabled={!hasAssociatedObjects}
          onBlur={(ev) => {
            handleCountInput("min", ev);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              handleCountInput("min", ev);
              ev.currentTarget.blur();
            }
          }}
          className="bg-transparent disabled:cursor-not-allowed disabled:hover:bg-transparent hover:bg-blue-100 w-[4ch] text-center"
          type="text"
          pattern="([0-9]|&#8734;)+"
          defaultValue={
            countConstraint.min === Infinity ? "∞" : countConstraint.min
          }
        />
        -
        <input
          disabled={!hasAssociatedObjects}
          onBlur={(ev) => {
            handleCountInput("max", ev);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              handleCountInput("max", ev);
              ev.currentTarget.blur();
            }
          }}
          className="bg-transparent disabled:cursor-not-allowed disabled:hover:bg-transparent hover:bg-blue-100 w-[4ch] text-center"
          type="text"
          pattern="([0-9]|&#8734;)+"
          defaultValue={
            countConstraint.max === Infinity ? "∞" : countConstraint.max
          }
        />
      </div>
      <div className="text-large font-semibold mt-1 mx-4 flex flex-col justify-center items-center">
        <span>{data.eventType}</span>
        <MiscNodeConstraints
          id={id}
          data={data}
          onNodeDataChange={onNodeDataChange}
        />
      </div>
      <div className="mb-1">
        {data.selectedVariables.map((selectedVar, i) => (
          <div
            key={i}
            className="grid grid-cols-[auto,6rem,auto] gap-x-2 items-center w-fit mx-auto"
          >
            <button
              title="Remove"
              className="text-xs my-0 rounded-full transition-colors hover:bg-red-50 hover:outline hover:outline-1 hover:outline-red-400 hover:text-red-400 focus:text-red-500"
              onClick={() => {
                const newSelectedVariables = [...data.selectedVariables];
                newSelectedVariables.splice(i, 1);
                onNodeDataChange(id, {
                  selectedVariables: newSelectedVariables,
                });
              }}
            >
              <LuX />
            </button>
            <span className="text-left mb-1">
              <span title={"Object type: " + selectedVar.variable.type}>
                {selectedVar.variable.name}
              </span>
              <span
                className="text-gray-500"
                title={"Qualifier: " + selectedVar.qualifier}
              >
                {" "}
                @{selectedVar.qualifier}
              </span>
            </span>
            <button
              title="Toggle bound"
              className="text-xs py-1 px-1 rounded-sm transition-colors hover:bg-cyan-50 hover:outline hover:outline-1 hover:outline-cyan-400 hover:text-cyan-400 focus:text-cyan-500"
              onClick={() => {
                selectedVar.bound = !selectedVar.bound;
                onNodeDataChange(id, {
                  selectedVariables: [...data.selectedVariables],
                });
              }}
            >
              {selectedVar.bound ? <LuLink /> : <LuUnlink />}
            </button>
          </div>
        ))}
      </div>
      <div>
        <Combobox
          title={
            canAddObjects
              ? "Link object variables..."
              : "No options available. Please first add object variables above!"
          }
          options={objectVariables.flatMap((ot) => {
            return qualifierPerObjectType[ot.type].map((qualifier) => ({
              value: JSON.stringify({ objectvariable: ot, qualifier }),
              label: `${ot.name} @${qualifier} (${ot.type})`,
            }));
          })}
          onChange={(jsonValue: string) => {
            if (jsonValue !== undefined && jsonValue !== "") {
              const {
                objectvariable,
                qualifier,
              }: { objectvariable: ObjectVariable; qualifier: string } =
                JSON.parse(jsonValue);
              onNodeDataChange(id, {
                selectedVariables: [
                  ...data.selectedVariables,
                  {
                    variable: objectvariable,
                    qualifier,
                    bound: false,
                  },
                ],
              });
            }
          }}
          name="Variable"
          value={""}
        />
      </div>
      {hasAssociatedObjects && (
        <Handle
          className="!w-3 !h-3"
          position={Position.Top}
          type="target"
          id={id + "-target"}
        />
      )}
      {hasAssociatedObjects && (
        <Handle
          className="!w-3 !h-3"
          position={Position.Bottom}
          type="source"
          id={id + "-source"}
        />
      )}
    </div>
  );
}
