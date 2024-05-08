import { useContext } from "react";
import type { EvaluationRes } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";
import {
  ExclamationTriangleIcon,
  CheckCircledIcon,
} from "@radix-ui/react-icons";

export default function ViolationIndicator({
  violationsPerNode,
}: {
  violationsPerNode: EvaluationRes;
}) {
  const { showViolationsFor } = useContext(VisualEditorContext);
  return (
    <button
      onClick={() => {
        if (
          violationsPerNode !== undefined &&
          showViolationsFor !== undefined
        ) {
          showViolationsFor(violationsPerNode);
        }
      }}
      className={`absolute right-1 top-1 text-xs flex flex-col items-center gap-x-1 border border-transparent px-1 py-0.5 rounded-sm hover:bg-amber-100/70 hover:border-gray-400/50`}
      title={`Found ${violationsPerNode.situationViolatedCount} Violations of ${violationsPerNode.situationCount} Bindings`}
    >
      {violationsPerNode.situationViolatedCount > 0 && (
        <ExclamationTriangleIcon className="text-red-400 h-4 mt-1" />
      )}
      {violationsPerNode.situationViolatedCount === 0 && (
        <CheckCircledIcon className="text-green-400 h-4" />
      )}
      <div className="flex flex-col items-center justify-center">
        <div className="leading-none font-semibold">
          {Math.round(
            100 *
              100 *
              (violationsPerNode.situationViolatedCount /
                violationsPerNode.situationCount),
          ) / 100.0}
          %
        </div>
        <span className="text-muted-foreground font-semibold text-xs">
          {violationsPerNode.situationViolatedCount}
        </span>
      </div>
    </button>
  );
}
