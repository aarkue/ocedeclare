import { type Edge, type Node, type ReactFlowInstance, ReactFlowProvider } from "@xyflow/react";
import clsx from "clsx";
import { startTransition, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { CgTrash } from "react-icons/cg";
import { LuSave } from "react-icons/lu";
import { RxPlusCircled } from "react-icons/rx";
import { TbTrash } from "react-icons/tb";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import AlertHelper from "@/components/AlertHelper";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOcelInfo } from "@/hooks";
import {
	parseLocalStorageValue,
	QUERY_LOCALSTORAGE_OPEN_INDEX,
	QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
} from "@/lib/local-storage";
import type { FlowAndViolationData } from "@/types/misc";
import { emptyBoxNode } from "../helper/constructNodes";
import { FlowContext } from "../helper/FlowContext";
import type {
	ConstraintInfo,
	EvaluationResPerNodes,
	EventTypeLinkData,
	EventTypeNodeData,
	GateNodeData,
} from "../helper/types";
import TotalViolationInfo from "../TotalViolationInfo";
import VisualEditor from "../VisualEditor";
import AutoDiscoveryButton from "./AutoDiscovery";

/** Where the box a new query starts with is placed. The editor fits the view when a query is opened,
 *  so this only decides the box's flow coordinates, not where it ends up on screen. */
const SEED_NODE_POSITION = { x: 40, y: 30 };
const SEED_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export default function VisualEditorOuter() {
	const ocelInfo = useOcelInfo();
	const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
	const constraintListRefSmall = useRef<FixedSizeList>(null);
	const [showConstraintSelection, setShowConstraintSelection] = useState(false);
	const [currentInstanceAndData, setCurrentInstanceAndData] = useState<{
		instance?:
			| ReactFlowInstance<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>
			| undefined;
		getter?: () =>
			| {
					violations?: EvaluationResPerNodes;
			  }
			| undefined;
	}>({});

	const [activeIndex, setActiveIndex] = useState<number>();
	const [deletePromptForIndex, setDeletePromptForIndex] = useState<number>();
	const prevDataRef = useRef<FlowAndViolationData[]>([]);

	useEffect(() => {
		const meta = parseLocalStorageValue<ConstraintInfo[]>(
			localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
		);
		const data = parseLocalStorageValue<FlowAndViolationData[]>(
			localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]",
		);

		prevDataRef.current = data;
		setConstraints(meta);

		// Honor a cross-route request to open a specific constraint (e.g. from Path Schemas).
		const openIdxRaw = localStorage.getItem(QUERY_LOCALSTORAGE_OPEN_INDEX);
		if (openIdxRaw !== null) {
			localStorage.removeItem(QUERY_LOCALSTORAGE_OPEN_INDEX);
			const openIdx = Number.parseInt(openIdxRaw, 10);
			if (!Number.isNaN(openIdx) && openIdx >= 0 && openIdx < meta.length) {
				setActiveIndex(openIdx);
			}
		}
	}, []);

	useEffect(() => {
		if (activeIndex !== undefined) {
			constraintListRefSmall.current?.scrollToItem(activeIndex, "smart");
		}
	}, [activeIndex]);

	const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>();
	function scheduleAutoSave() {
		if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
		autoSaveTimer.current = setTimeout(saveData, 400);
	}

	function saveData() {
		if (
			currentInstanceAndData.instance !== undefined &&
			activeIndex !== undefined &&
			currentInstanceAndData.getter !== undefined
		) {
			// First, save current data
			const prevOtherData = currentInstanceAndData.getter();
			prevDataRef.current[activeIndex] = {
				flowJson: currentInstanceAndData.instance.toObject(),
				violations: prevOtherData?.violations,
			};
		}

		if (prevDataRef.current !== undefined) {
			localStorage.setItem(
				QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
				JSON.stringify(prevDataRef.current.map((x) => ({ ...x, violations: undefined }))),
			);
		}
		localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(constraints));
	}

	function changeIndex(newIndex: number | undefined, length = constraints.length) {
		if (
			currentInstanceAndData.instance !== undefined &&
			activeIndex !== undefined &&
			currentInstanceAndData.getter !== undefined
		) {
			const dataFromPrevIndex = currentInstanceAndData.instance.toObject();
			const prevOtherData = currentInstanceAndData.getter();
			prevDataRef.current[activeIndex] = {
				flowJson: dataFromPrevIndex,
				violations: prevOtherData?.violations,
			};
		}
		if (newIndex === undefined || (!Number.isNaN(newIndex) && newIndex >= 0 && newIndex < length)) {
			setActiveIndex(newIndex);
		}
	}

	function ConstraintMetaInfo({
		constraint,
		index,
	}: {
		constraint: ConstraintInfo;
		index: number;
	}) {
		return (
			<div
				className={clsx(
					"flex justify-between border rounded h-full w-full items-center",
					index !== activeIndex && "bg-gray-50 border-gray-300",
					index === activeIndex && "bg-blue-200 border-blue-300 font-semibold",
				)}
			>
				<button
					type="button"
					onClick={() => {
						changeIndex(index);
						setShowConstraintSelection(false);
					}}
					className={clsx(
						"w-full h-full block whitespace-nowrap overflow-hidden text-ellipsis px-2 text-left",
					)}
				>
					<h4
						className="text-sm font-semibold"
						title={constraint.name !== "" ? constraint.name : `Constraint ${index + 1}`}
					>
						{constraint.name !== "" ? constraint.name : `Constraint ${index + 1}`}
					</h4>
					<p className="text-xs font-light text-gray-700">
						{constraint.description !== "" ? constraint.description : "No description"}
					</p>
				</button>

				<button
					type="button"
					className="text-red-700 px-2 block hover:bg-red-300 h-full"
					onClick={() => setDeletePromptForIndex(index)}
				>
					<TbTrash />
				</button>
			</div>
		);
	}
	if (!ocelInfo) {
		return null;
	}

	return (
		<div className="w-full h-full">
			<FlowContext.Provider
				value={{
					flushData: (data) => {
						if (
							data !== undefined &&
							activeIndex !== undefined &&
							currentInstanceAndData.instance !== undefined
						) {
							prevDataRef.current[activeIndex] = {
								flowJson: currentInstanceAndData.instance.toObject(),
								violations: data?.violations,
							};
							setConstraints([...constraints]);
						}
					},
					instance: currentInstanceAndData?.instance,
					setInstance: (i) => {
						setCurrentInstanceAndData((ci) => ({
							...ci,
							instance: i,
						}));
					},
					registerOtherDataGetter: (getter) => {
						setCurrentInstanceAndData((ci) => ({ ...ci, getter }));
					},
					otherData:
						activeIndex !== undefined
							? {
									violations: prevDataRef.current[activeIndex]?.violations,
									nodes: prevDataRef.current[activeIndex]?.flowJson?.nodes,
									edges: prevDataRef.current[activeIndex]?.flowJson?.edges,
									viewport: prevDataRef.current[activeIndex]?.flowJson?.viewport,
								}
							: undefined,
					scheduleAutoSave,
				}}
			>
				<div className="flex flex-col justify-start items-center mb-2 gap-y-2 h-full">
					{ocelInfo !== undefined && (
						<>
							<div
								className={`w-full max-w-4xl gap-y-2 ${
									constraints.length > 0 ? "justify-between" : "justify-center"
								}`}
							/>
							<AlertDialog
								open={deletePromptForIndex !== undefined}
								onOpenChange={(o) => {
									if (!o) {
										setDeletePromptForIndex(undefined);
									}
								}}
							>
								<AlertDialogContent className="flex flex-col max-h-full justify-between">
									<AlertDialogHeader>
										<AlertDialogTitle>Delete Constraint</AlertDialogTitle>
									</AlertDialogHeader>
									<div className="text-base text-gray-700 max-h-full overflow-auto px-2">
										{deletePromptForIndex !== undefined && (
											<>
												<span className="">
													Constraint:{" "}
													<span className="font-semibold">
														{(constraints[deletePromptForIndex]?.name ?? "").length > 0
															? constraints[deletePromptForIndex]?.name
															: `Constraint ${deletePromptForIndex + 1}`}
													</span>
												</span>
												<br />
												<br />
											</>
										)}
										Deleting this constraint will delete all contained nodes and cannot be undone.
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => {
												if (deletePromptForIndex === undefined) return;
												prevDataRef.current.splice(deletePromptForIndex, 1);
												if (activeIndex !== undefined && activeIndex >= constraints.length - 1) {
													changeIndex(activeIndex - 1);
												}
												setConstraints((constraints) => {
													const newConstraints = [...constraints];
													newConstraints.splice(deletePromptForIndex, 1);
													return newConstraints;
												});
											}}
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>

							<ReactFlowProvider>
								<div className="w-full h-full flex flex-col gap-y-2 px-r">
									<div
										className={clsx(
											"grid w-full px-4 text-center",
											activeIndex !== undefined &&
												constraints[activeIndex] !== undefined &&
												"grid-cols-[1fr_1fr_1fr]",
											(activeIndex === undefined || constraints[activeIndex] === undefined) &&
												"grid-cols-1  h-full",
										)}
									>
										<div className="flex flex-col w-full h-full relative">
											<Dialog
												open={showConstraintSelection}
												onOpenChange={(o) => {
													setShowConstraintSelection(o);
												}}
											>
												<DialogContent className="flex flex-col max-h-full justify-between">
													<DialogHeader>
														<DialogTitle>Select Query</DialogTitle>
													</DialogHeader>
													<div className="h-[50vh] w-full">
														<AutoSizer>
															{({ height, width }) => (
																<FixedSizeList
																	initialScrollOffset={
																		activeIndex !== undefined
																			? 45 * activeIndex - height / 2
																			: undefined
																	}
																	height={height}
																	itemCount={constraints.length}
																	itemSize={45}
																	width={width}
																>
																	{({ index, style }: ListChildComponentProps) => {
																		const c = constraints[index];
																		if (c === undefined) {
																			return null;
																		}
																		return (
																			<div style={style} className="pb-1">
																				<ConstraintMetaInfo constraint={c} index={index} />
																			</div>
																		);
																	}}
																</FixedSizeList>
															)}
														</AutoSizer>
													</div>
												</DialogContent>
											</Dialog>
											<div>
												<div className="flex justify-center gap-x-2 items-center w-full mb-2">
													{activeIndex === undefined && (
														<div className="mr-auto text-left">
															<h2 className="text-4xl font-black bg-clip-text text-transparent tracking-tighter bg-linear-to-t from-sky-400 to-teal-600">
																OCPQ
															</h2>
															<h4 className="font-semibold text-lg tracking-tight">
																Object-Centric Process Queries
															</h4>
														</div>
													)}
													<AlertHelper
														trigger={
															<Button
																title={"Delete All"}
																variant="destructive"
																size="icon"
																className="min-w-7"
																// className="h-12 w-12"
																disabled={constraints.length === 0}
															>
																<CgTrash size={"20"} />
															</Button>
														}
														title={"Delete All Constraints"}
														initialData={undefined}
														content={() => <p>Are you sure? This will delete all constraints.</p>}
														submitAction={"Delete All"}
														onSubmit={() => {
															prevDataRef.current = [];
															setConstraints([]);
															setActiveIndex(undefined);
														}}
													/>

													{activeIndex !== undefined && (
														<Button
															disabled={constraints.length === 0}
															onClick={() => setShowConstraintSelection(true)}
														>
															{constraints.length} Queries...
														</Button>
													)}
													<Button
														// size="lg"
														onClick={() => {
															prevDataRef.current.splice(constraints.length, 1);
															// Start with one box, so the query opens with something to
															// drag a child out of.
															prevDataRef.current[constraints.length] = {
																flowJson: {
																	nodes: [emptyBoxNode(SEED_NODE_POSITION)],
																	edges: [],
																	viewport: SEED_VIEWPORT,
																},
															};
															setConstraints((cs) => [
																...cs,
																{
																	name: `New Constraint (${cs.length + 1})`,
																	description: "",
																},
															]);
															startTransition(() => {
																changeIndex(constraints.length, constraints.length + 1);
															});
														}}
													>
														<RxPlusCircled className="mr-1" />
														Add
													</Button>
													<AutoDiscoveryButton
														ocelInfo={ocelInfo}
														constraints={constraints}
														setConstraints={setConstraints}
														prevDataRef={prevDataRef}
													/>
													<Button
														title="Save"
														variant="outline"
														size="icon"
														className="min-w-7"
														onClick={() => {
															saveData();
															toast.success("Saved Data");
														}}
													>
														<LuSave />
													</Button>
												</div>
											</div>
											{constraints.length === 0 && (
												<Button
													className="text-lg h-14"
													onClick={() => {
														prevDataRef.current[constraints.length] = {
															flowJson: {
																nodes: [emptyBoxNode(SEED_NODE_POSITION)],
																edges: [],
																viewport: SEED_VIEWPORT,
															},
														};
														changeIndex(constraints.length, constraints.length + 1);
														setConstraints((cs) => [
															...cs,
															{
																name: "My first OCPQ Query",
																description: "",
															},
														]);
													}}
												>
													Create your first query...
												</Button>
											)}
											<div className="h-full w-full">
												<AutoSizer>
													{({ height, width }) => (
														<FixedSizeList
															ref={constraintListRefSmall}
															height={activeIndex === undefined ? height : 70}
															itemCount={constraints.length}
															itemSize={45}
															width={width}
														>
															{({ index, style }: ListChildComponentProps) => {
																const c = constraints[index];
																if (c === undefined) {
																	return null;
																}
																return (
																	<div style={style} className="pb-1">
																		<ConstraintMetaInfo constraint={c} index={index} />
																	</div>
																);
															}}
														</FixedSizeList>
													)}
												</AutoSizer>
											</div>
										</div>
										{activeIndex !== undefined && constraints[activeIndex] !== undefined && (
											<div className="">
												<p className="h-6 text-xs lg:text-base">Selected Query</p>
												<div className="w-full flex flex-col gap-y-1 px-2" key={activeIndex}>
													<Input
														className="text-lg font-medium "
														placeholder="Name"
														type="text"
														defaultValue={
															constraints[activeIndex].name !== ""
																? constraints[activeIndex].name
																: `Constraint ${activeIndex + 1}`
														}
														onBlur={(ev) => {
															setConstraints((cs) => {
																if (ev.target != null) {
																	const newCs = [...cs];
																	newCs[activeIndex].name = ev.target.value;
																	return newCs;
																}
																return cs;
															});
														}}
													/>
													<div className="px-2">
														<Textarea
															className="max-h-10"
															defaultValue={constraints[activeIndex].description}
															placeholder="Description"
															onBlur={(ev) => {
																setConstraints((cs) => {
																	if (ev.target != null) {
																		const newCs = [...cs];
																		newCs[activeIndex].description = ev.target.value;
																		return newCs;
																	}
																	return cs;
																});
															}}
														/>
													</div>
												</div>
											</div>
										)}
										{activeIndex !== undefined && constraints[activeIndex] !== undefined && (
											<div className="text-xs lg:text-base">
												<p className="h-6">Query Info</p>
												<div className="px-2 border rounded flex flex-col items-center justify-around w-full">
													{prevDataRef.current[activeIndex]?.flowJson !== undefined
														? prevDataRef.current[activeIndex].flowJson.nodes.length
														: 0}{" "}
													Nodes,{" "}
													{prevDataRef.current[activeIndex]?.flowJson !== undefined
														? prevDataRef.current[activeIndex].flowJson.edges.length
														: 0}{" "}
													Edges
													<TotalViolationInfo
														violations={prevDataRef.current[activeIndex]?.violations}
														flowJSON={prevDataRef.current[activeIndex]?.flowJson}
													/>
												</div>
											</div>
										)}
									</div>
									{activeIndex !== undefined && constraints[activeIndex] !== undefined && (
										<div className="relative w-full h-full">
											<div className="xl:w-full min-h-140 h-full border border-blue-100 rounded-sm p-2">
												{ocelInfo !== undefined && (
													<VisualEditor
														constraintInfo={constraints[activeIndex]}
														ocelInfo={ocelInfo}
													/>
												)}
											</div>
										</div>
									)}
								</div>
							</ReactFlowProvider>
						</>
					)}
				</div>
			</FlowContext.Provider>
		</div>
	);
}
