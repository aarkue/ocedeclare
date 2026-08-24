import clsx from "clsx";
import { useState } from "react";
import { BsPlusCircle } from "react-icons/bs";
import { TbTrash } from "react-icons/tb";
import { Link, useNavigate } from "react-router-dom";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { v4 } from "uuid";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA,
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import type { DataExtractionBlueprintMeta } from "./data-extraction-types";

export default function DataExtractionRoot() {
	const [blueprints, setBlueprints] = useState<DataExtractionBlueprintMeta[]>(
		parseLocalStorageValue(
			localStorage.getItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META) ?? "[]",
		),
	);
	const [deletePromptFor, setDeletePromptFor] = useState<{ index: number } | "ALL" | undefined>();

	function saveData(meta = blueprints) {
		localStorage.setItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META, JSON.stringify(meta));
	}

	const navigate = useNavigate();

	return (
		<div className="text-left h-full overflow-hidden flex flex-col">
			<h2 className="text-4xl font-black bg-clip-text text-transparent tracking-tighter bg-linear-to-t from-blue-400 to-sky-600">
				Data Extraction Blueprints
			</h2>
			<h4 className="font-semibold text-lg tracking-tight">Manage Data Extraction Blueprints</h4>
			<p>
				Extract object-centric event data from databases (SQLite, PostgresSQL, DuckDB) or files
				(CSV, XLSX, Parquet).
			</p>
			<div className="flex justify-between items-center mt-2 mb-3">
				<Button
					className="cursor-pointer"
					onClick={() => {
						const newID = v4();
						const newBlueprints: DataExtractionBlueprintMeta[] = [
							...blueprints,
							{
								name: `Blueprint ${blueprints.length + 1}`,
								id: newID,
								createdAt: new Date().toISOString(),
							},
						];
						saveData(newBlueprints);
						setBlueprints(newBlueprints);
						navigate(`/data-extraction/${newID}`);
					}}
				>
					<BsPlusCircle className="mr-1.5 stroke-1" />
					New Blueprint
				</Button>
				{blueprints.length > 0 && (
					<Button variant="destructive" onClick={() => setDeletePromptFor("ALL")}>
						Delete All...
					</Button>
				)}
			</div>
			<AlertDialog
				open={deletePromptFor !== undefined}
				onOpenChange={(o) => {
					if (!o) {
						setDeletePromptFor(undefined);
					}
				}}
			>
				<AlertDialogContent className="flex flex-col max-h-full justify-between">
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription className="hidden">
							Are you sure you want to delete {deletePromptFor === "ALL" ? "all " : ""}the selected
							blueprint
							{deletePromptFor === "ALL" ? "s" : ""}? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="text-base text-gray-700 max-h-full overflow-auto px-2">
						{deletePromptFor !== undefined && deletePromptFor !== "ALL" && (
							<>
								<span>
									Blueprint:{" "}
									<span className="font-semibold">
										{blueprints[deletePromptFor.index]?.name ||
											`Blueprint ${deletePromptFor.index + 1}`}
									</span>
								</span>
								<br />
								<br />
							</>
						)}
						This deletes the blueprint and its sources. This cannot be undone.
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deletePromptFor === undefined) return;
								if (deletePromptFor === "ALL") {
									blueprints.forEach((p) => {
										localStorage.removeItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + p.id);
									});
									setBlueprints([]);
									saveData([]);
									return;
								}
								const deleted = blueprints[deletePromptFor.index];
								const next = [...blueprints];
								next.splice(deletePromptFor.index, 1);
								setBlueprints(next);
								saveData(next);
								if (deleted) {
									localStorage.removeItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + deleted.id);
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<div className="h-full overflow-auto">
				{blueprints.length === 0 && (
					<div className="text-center text-muted-foreground py-12">
						<p className="text-lg">No blueprints yet.</p>
						<p className="text-sm mt-1">Click "New Blueprint" to get started.</p>
					</div>
				)}
				{blueprints.length > 0 && (
					<AutoSizer>
						{({ height, width }) => (
							<FixedSizeList
								height={height}
								itemCount={blueprints.length}
								itemSize={45}
								width={width}
							>
								{({ index, style }: ListChildComponentProps) => {
									const p = blueprints[index];
									if (p === undefined) return null;
									return (
										<div style={style} className="pb-1">
											<BlueprintMetaInfo
												blueprint={p}
												index={index}
												onDelete={() => setDeletePromptFor({ index })}
											/>
										</div>
									);
								}}
							</FixedSizeList>
						)}
					</AutoSizer>
				)}
			</div>
		</div>
	);
}

function BlueprintMetaInfo({
	blueprint,
	index,
	onDelete,
}: {
	blueprint: DataExtractionBlueprintMeta;
	index: number;
	onDelete: () => unknown;
}) {
	return (
		<div
			className={clsx(
				"flex justify-between border rounded h-full w-full items-center",
				"bg-blue-50 border-blue-300 font-semibold",
			)}
		>
			<Link
				to={`/data-extraction/${blueprint.id}`}
				className="w-full h-full block whitespace-nowrap overflow-hidden text-ellipsis px-2 text-left"
			>
				<h4 className="text-sm" title={blueprint.name || `Blueprint ${index + 1}`}>
					{blueprint.name || `Blueprint ${index + 1}`}
				</h4>
				<p className="text-xs font-light text-gray-700">
					{blueprint.description || "No description"}
				</p>
			</Link>
			<button
				type="button"
				className="text-red-700 px-2 block hover:bg-red-300 h-full"
				onClick={() => onDelete()}
			>
				<TbTrash />
			</button>
		</div>
	);
}
