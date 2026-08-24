import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useEvalResultPage } from "@/hooks/useEvalResultPage";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { BindingRow } from "@/types/generated/BindingRow";
import type { EvalPageRequest } from "@/types/generated/EvalPageRequest";
import Spinner from "../Spinner";
import { Button } from "../ui/button";
import { IndeterminateCheckbox } from "../ui/intermediate-checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { columnsForBindingRow } from "./columns";

type Mode = "violations" | "situations" | "satisfied-situations" | undefined;

interface ServerPaginatedBindingTableProps {
	evalVersion: number;
	nodeIndex: number;
	totalCount: number;
	totalViolatedCount: number;
	node: BindingBoxTreeNode;
	addViolationStatus: boolean;
	showElementInfo: (
		elInfo: { req: { id: string } | { index: number }; type: "object" | "event" } | undefined,
	) => unknown;
	initialMode: Mode;
}

function modeToFilter(mode: Mode): boolean | null {
	if (mode === "violations") return true;
	if (mode === "satisfied-situations") return false;
	return null;
}

export function DataTablePagination({
	evalVersion,
	nodeIndex,
	totalCount,
	totalViolatedCount,
	node,
	addViolationStatus,
	showElementInfo,
	initialMode,
}: ServerPaginatedBindingTableProps) {
	const [pageSize, setPageSize] = useState(10);
	// Filter changes reset pagination; keep both in the same state object so
	// there's no stale-page round-trip while a useEffect catches up.
	const [{ pageIndex, violated }, setPage] = useState<{
		pageIndex: number;
		violated: boolean | null;
	}>(() => ({ pageIndex: 0, violated: modeToFilter(initialMode) }));

	const req: EvalPageRequest = useMemo(
		() => ({
			evalVersion,
			nodeIndex,
			offset: pageIndex * pageSize,
			limit: pageSize,
			violated,
		}),
		[evalVersion, nodeIndex, pageIndex, pageSize, violated],
	);

	const { data, isLoading, error } = useEvalResultPage(req);

	const rows = data?.rows ?? [];
	const filteredCount =
		data?.filteredCount ??
		(violated === null
			? totalCount
			: violated
				? totalViolatedCount
				: totalCount - totalViolatedCount);
	const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));

	const columns: ColumnDef<BindingRow>[] = useMemo(() => {
		if (rows.length === 0) return [];
		return columnsForBindingRow(rows[0], showElementInfo, node, addViolationStatus);
	}, [rows, showElementInfo, node, addViolationStatus]);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		pageCount,
		state: {
			pagination: { pageIndex, pageSize },
		},
	});

	if (error && error.message === "STALE_EVAL_VERSION") {
		return (
			<div className="p-4 text-sm text-destructive">
				These results are from a previous evaluation and have expired. Re-run the evaluation to view
				bindings.
			</div>
		);
	}

	return (
		<div className="w-full">
			<div className="rounded-md border w-full max-h-[73vh] overflow-auto">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id} className="divide-x">
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id} className="py-1 px-2 mx-4">
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
										{header.id === "Violation" && (
											<div className="flex items-center gap-x-1 w-fit">
												<IndeterminateCheckbox
													title={
														violated === false
															? "Only show satisfied bindings"
															: violated === true
																? "Only show violated bindings"
																: "Show both satisfied and violated bindings"
													}
													state={
														violated === false
															? "unchecked"
															: violated === true
																? "checked"
																: "indeterminate"
													}
													newState={(newChecked) => {
														const next =
															newChecked === "indeterminate" ? null : newChecked !== "unchecked";
														setPage({ pageIndex: 0, violated: next });
													}}
												/>
												{violated === null ? "any" : violated ? "viol." : "sat."}
											</div>
										)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody className="text-xs">
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={columns.length || 1} className="h-24 text-center">
									<div className="flex items-center justify-center gap-x-2">
										Loading… <Spinner />
									</div>
								</TableCell>
							</TableRow>
						) : rows.length > 0 ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id} className="divide-x w-fit">
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={columns.length || 1} className="h-24 text-center">
									No results.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<div className="grid grid-cols-[1fr_1fr_auto] space-x-2 items-center justify-between px-2 text-xs mt-2 w-full">
				<div className="flex items-center justify-center space-x-2">
					<p className="font-medium">Rows per page</p>
					<Select
						value={`${pageSize}`}
						onValueChange={(value) => {
							setPageSize(Number(value));
							setPage((prev) => ({ ...prev, pageIndex: 0 }));
						}}
					>
						<SelectTrigger className="h-8 w-[70px]">
							<SelectValue placeholder={pageSize} />
						</SelectTrigger>
						<SelectContent side="top">
							{[10, 20, 30, 40, 50].map((n) => (
								<SelectItem key={n} value={`${n}`}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center justify-center">
					Page {pageIndex + 1} of {pageCount}
				</div>
				<div className="flex items-center space-x-2 justify-end">
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() =>
							setPage((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
						}
						disabled={pageIndex === 0}
					>
						<span className="sr-only">Go to previous page</span>
						<ChevronLeftIcon className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() =>
							setPage((prev) => ({
								...prev,
								pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1),
							}))
						}
						disabled={pageIndex >= pageCount - 1}
					>
						<span className="sr-only">Go to next page</span>
						<ChevronRightIcon className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

export default DataTablePagination;
