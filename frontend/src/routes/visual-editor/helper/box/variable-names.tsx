import clsx from "clsx";
import { useContext } from "react";
import { LuBox } from "react-icons/lu";
import { MdEvent } from "react-icons/md";
import type { Variable } from "@/types/generated/Variable";
import { VisualEditorContext } from "../VisualEditorContext";

export function getEvVarName(eventVar: number) {
	return function GetEvVarName() {
		return <EvVarName eventVar={eventVar} />;
	};
}

export function EvVarName({ eventVar }: { eventVar: number }) {
	const { getVarName } = useContext(VisualEditorContext);
	const varInfo = getVarName(eventVar, "event");
	return (
		<span className="font-mono font-semibold min-w-fit" style={{ color: varInfo.color }}>
			<MdEvent className="inline-block -mr-1.5" /> {varInfo.name}
		</span>
	);
}

export function getObVarName(obVar: number, disabledStyle = false) {
	return function GetObVarName() {
		return <ObVarName obVar={obVar} disabledStyle={disabledStyle} />;
	};
}

export function ObVarName({ obVar, disabledStyle }: { obVar: number; disabledStyle?: boolean }) {
	const { getVarName } = useContext(VisualEditorContext);
	const varInfo = getVarName(obVar, "object");
	return (
		<span
			className={clsx(
				"font-mono font-semibold min-w-fit",
				disabledStyle === true && "text-stone-400",
			)}
			style={{ color: disabledStyle === true ? undefined : varInfo.color }}
		>
			<LuBox className="inline-block -mr-1.5" /> {varInfo.name}
		</span>
	);
}

export function EvOrObVarName({ varName }: { varName: Variable }) {
	if ("Event" in varName) {
		return <EvVarName eventVar={varName.Event} />;
	}
	return <ObVarName obVar={varName.Object} />;
}
