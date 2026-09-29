'use client';

import {
  columnVisibilityFeature,
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/client';

export interface DataColumnMeta {
  /** Name in the column menu; also the header when `header` is not a string. */
  readonly label: string;
  /** The API sort field this column orders by, when it is sortable. */
  readonly sortKey?: string;
  readonly align?: 'left' | 'right';
  /** Columns that must stay visible (e.g. the name column). */
  readonly alwaysVisible?: boolean;
}

export const dataTableFeatures = tableFeatures({
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: {} as DataColumnMeta,
});
type Features = typeof dataTableFeatures;
type Row = { id: string };
// The value type differs per column, so a list of mixed columns needs `any` there (as in the library's own helpers).
export type DataColumn<T extends Row> = ColumnDef<Features, T, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const columnHelper = <T extends Row>() => createColumnHelper<Features, T>();

export interface SortState {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

interface DataTableProps<T extends { id: string }> {
  /** Accessible name of the table and key for its remembered column choices. */
  label: string;
  storageKey: string;
  columns: DataColumn<T>[];
  data: readonly T[] | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  toolbar?: ReactNode;
  footer?: ReactNode;
}

const EMPTY: never[] = [];

/**
 * Column choices, remembered per table in localStorage. Read through useSyncExternalStore: the
 * server snapshot is "nothing saved", so hydration matches and the saved choice applies right
 * after. An in-memory copy keeps choices working when storage is blocked or full.
 */
const memory = new Map<string, string>();
const storageListeners = new Set<() => void>();

function subscribeToStorage(listener: () => void) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseVisibility(raw: string | null): ColumnVisibilityState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ColumnVisibilityState) : {};
  } catch {
    return {};
  }
}

function useRememberedVisibility(storageKey: string) {
  const key = `solmira.table.${storageKey}.columns`;
  const raw = useSyncExternalStore(
    subscribeToStorage,
    () => readStored(key),
    () => null,
  );
  const visibility = useMemo(() => parseVisibility(raw), [raw]);
  const update = (next: ColumnVisibilityState) => {
    const value = JSON.stringify(next);
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode or quota: the in-memory copy still holds the choice for this tab.
    }
    storageListeners.forEach((listener) => listener());
  };
  return [visibility, update] as const;
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all rows on this page"
      checked={checked}
      onChange={onChange}
      className="size-4"
    />
  );
}

function SortHeader({
  meta,
  sort,
  onSortChange,
}: {
  meta: DataColumnMeta;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
}) {
  if (!meta.sortKey || !onSortChange) return <>{meta.label}</>;
  const active = sort?.key === meta.sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() =>
        onSortChange({
          key: meta.sortKey!,
          direction: active && sort.direction === 'asc' ? 'desc' : 'asc',
        })
      }
      className={clsx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
    >
      {meta.label}
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}

export function DataTable<T extends { id: string }>(props: DataTableProps<T>) {
  const {
    label,
    columns,
    data,
    isLoading,
    isFetching,
    error,
    onRetry,
    empty,
    sort,
    onSortChange,
    selection,
    onSelectionChange,
  } = props;
  const [visibility, setVisibility] = useRememberedVisibility(props.storageKey);
  const selectable = Boolean(onSelectionChange);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: (data ?? EMPTY) as T[],
    getRowId: (row) => row.id,
    enableRowSelection: selectable,
    state: { rowSelection: selection ?? {}, columnVisibility: visibility },
    onRowSelectionChange: (updater) =>
      onSelectionChange?.(typeof updater === 'function' ? updater(selection ?? {}) : updater),
    onColumnVisibilityChange: (updater) =>
      setVisibility(typeof updater === 'function' ? updater(visibility) : updater),
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const columnCount = visibleColumns.length + (selectable ? 1 : 0);
  const rows = table.getRowModel().rows;
  const alignOf = (meta?: DataColumnMeta) => (meta?.align === 'right' ? 'text-right' : 'text-left');

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{props.toolbar}</div>
        <DropdownMenu
          label="Choose columns"
          trigger={
            <>
              <Columns3 aria-hidden className="size-4" /> Columns
            </>
          }
        >
          {() =>
            table
              .getAllLeafColumns()
              .filter((column) => !column.columnDef.meta?.alwaysVisible)
              .map((column) => (
                <label
                  key={column.id}
                  role="menuitemcheckbox"
                  aria-checked={column.getIsVisible()}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-canvas"
                >
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={() => column.toggleVisibility()}
                    className="size-4"
                  />
                  {column.columnDef.meta?.label ?? column.id}
                </label>
              ))
          }
        </DropdownMenu>
      </div>

      {error && !data ? (
        <div className="p-4">
          <Alert tone="error" title="Could not load this list">
            {describeError(error)}{' '}
            {onRetry && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
          </Alert>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label={label}
            aria-busy={isLoading || isFetching || undefined}
            className={clsx(
              'w-full text-sm transition-opacity',
              isFetching && !isLoading && 'opacity-60',
            )}
          >
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                {selectable && (
                  <th scope="col" className="w-10 px-4 py-2.5">
                    <SelectAllCheckbox
                      checked={table.getIsAllPageRowsSelected()}
                      indeterminate={table.getIsSomePageRowsSelected()}
                      onChange={() => table.toggleAllPageRowsSelected()}
                    />
                  </th>
                )}
                {visibleColumns.map((column) => {
                  const meta = column.columnDef.meta;
                  const active = meta?.sortKey !== undefined && sort?.key === meta.sortKey;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                      className={clsx('px-4 py-2.5 font-medium whitespace-nowrap', alignOf(meta))}
                    >
                      {meta ? (
                        <SortHeader meta={meta} sort={sort} onSortChange={onSortChange} />
                      ) : (
                        column.id
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading &&
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={index}>
                    <td colSpan={columnCount} className="px-4 py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={columnCount}>{empty}</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  aria-selected={selectable ? row.getIsSelected() : undefined}
                  className={clsx('hover:bg-canvas/60', row.getIsSelected() && 'bg-accent-soft/50')}
                >
                  {selectable && (
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                        className="size-4"
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={clsx('px-4 py-2.5', alignOf(cell.column.columnDef.meta))}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.footer}
    </div>
  );
}
