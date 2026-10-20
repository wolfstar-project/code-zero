<template>
  <section class="panel overflow-hidden">
    <div class="section-title">
      <div class="flex items-center gap-2">
        <h2 class="m-0 text-xs font-750 tracking-[0.12em] uppercase">
          {{ $t('dashboard.queue.title') }}
        </h2>
        <span class="border border-line bg-raised px-1.5 py-0.5 mono text-muted">
          {{ rows.length }}
        </span>
      </div>

      <label class="flex items-center gap-2">
        <span class="sr-only">{{ $t('common.table.filterLabel') }}</span>
        <Icon aria-hidden="true" class="h-3.5 w-3.5 text-muted" name="lucide:search" />
        <input
          ref="filterInput"
          v-model="query"
          class="input-field h-7 w-40 text-xs sm:w-56"
          type="search"
          :placeholder="$t('common.table.filterPlaceholder')"
        />
      </label>
    </div>

    <div v-if="tasks.length > 0" class="overflow-x-auto">
      <table class="w-full min-w-160 border-collapse text-start">
        <caption class="sr-only">
          {{
            $t('dashboard.queue.caption')
          }}
        </caption>
        <thead>
          <tr class="border-b border-line bg-raised/55">
            <th
              v-for="header in headers"
              :key="header.id"
              scope="col"
              class="px-3.5 py-2.5 label-upper"
              :aria-sort="ariaSort(header.column.getIsSorted())"
            >
              <button
                class="focus-ring flex items-center gap-1.5 text-inherit uppercase tracking-inherit"
                type="button"
                :aria-label="
                  $t('common.table.sortBy', { column: $t(columnLabelKey(header.column.id)) })
                "
                @click="header.column.getToggleSortingHandler()?.($event)"
              >
                {{ $t(columnLabelKey(header.column.id)) }}
                <Icon
                  aria-hidden="true"
                  class="h-3 w-3"
                  :class="header.column.getIsSorted() ? 'text-ink' : 'text-muted/60'"
                  :name="sortIcon(header.column.getIsSorted())"
                />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td class="px-3.5 py-10 text-center text-xs text-muted" :colspan="headers.length">
              {{ $t('common.table.noMatches') }}
            </td>
          </tr>
          <tr
            v-for="row in rows"
            :key="row.original.id"
            tabindex="0"
            class="cursor-pointer border-b border-line/70 transition last:border-b-0 hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            :class="selectedId === row.original.id ? 'bg-accent/5' : ''"
            @click="$emit('select', row.original.id)"
            @keydown.enter="$emit('select', row.original.id)"
          >
            <td class="px-3.5 py-3 font-mono text-xs text-link">{{ shortId(row.original.id) }}</td>
            <td class="px-3.5 py-3">
              <p class="m-0 text-xs font-650">{{ repositoryName(row.original.repository) }}</p>
              <p class="m-0 mt-1 max-w-72 truncate font-mono text-3xs text-muted">
                {{ row.original.repository }}
              </p>
            </td>
            <td class="px-3.5 py-3"><TaskStatus :status="row.original.status" /></td>
            <td class="px-3.5 py-3 font-mono text-3xs text-muted">
              {{ new Date(row.original.updatedAt).toLocaleString(locale) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="min-h-52 grid place-items-center px-5 py-10 text-center">
      <div>
        <div class="mx-auto h-9 w-9 grid place-items-center border border-line bg-raised">
          <Icon aria-hidden="true" class="h-4 w-4 text-muted" name="lucide:inbox" />
        </div>
        <h3 class="mb-0 mt-4 text-sm font-650">{{ $t('dashboard.queue.emptyTitle') }}</h3>
        <p class="mx-auto mb-0 mt-2 max-w-80 text-xs text-muted leading-relaxed">
          {{ $t('dashboard.queue.emptyBody') }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/vue-table';
import type { DashboardTask } from '~~/modules/dashboard/types/dashboard';

const props = defineProps<{ tasks: DashboardTask[]; selectedId?: string }>();
defineEmits<{ select: [id: string] }>();

const { locale } = useI18n();

// Looked up by column id, so the keys are spelled out here for `i18n:report` to find.
const COLUMN_LABEL_KEYS: Readonly<Record<string, string>> = {
  id: 'dashboard.queue.columns.id',
  repository: 'dashboard.queue.columns.repository',
  status: 'dashboard.queue.columns.status',
  updatedAt: 'dashboard.queue.columns.updated',
};

const SORT_ICONS = {
  asc: 'lucide:arrow-up',
  desc: 'lucide:arrow-down',
  none: 'lucide:chevrons-up-down',
} as const;

/** Total lookups: `noUncheckedIndexedAccess` is on, and a column without a label is a bug, not a
 * blank header — falling back to the id makes that visible instead of rendering nothing. */
function columnLabelKey(id: string): string {
  return COLUMN_LABEL_KEYS[id] ?? id;
}

function sortIcon(direction: false | 'asc' | 'desc'): string {
  return SORT_ICONS[direction || 'none'] ?? SORT_ICONS.none;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function repositoryName(repository: string): string {
  const normalized = repository.replaceAll('\\', '/');
  return normalized.split('/').findLast((segment) => segment.length > 0) ?? repository;
}

// Registered explicitly: v9 ships no row models by default, and a feature that is not listed here
// leaves its state atoms undefined rather than silently doing nothing.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  columnVisibilityFeature,
});

// `updatedAt` is ISO-8601, so lexicographic text sorting is already chronological. The trailing
// `search` column is never rendered; it exists so one filter box can match across every field the
// reader can see, which v9 has no global filter for.
const columns = [
  { id: 'id', accessorKey: 'id', sortFn: 'text' as const },
  { id: 'repository', accessorKey: 'repository', sortFn: 'text' as const },
  { id: 'status', accessorKey: 'status', sortFn: 'text' as const },
  { id: 'updatedAt', accessorKey: 'updatedAt', sortFn: 'text' as const },
  {
    id: 'search',
    accessorFn: (task: DashboardTask) => `${task.id} ${task.repository} ${task.status}`,
    filterFn: 'includesString' as const,
    enableSorting: false,
  },
];

const data = computed(() => props.tasks);

const table = useTable({
  features,
  columns,
  data,
  // Matches the order the control plane hands us, so the default view is unchanged.
  initialState: { sorting: [{ id: 'updatedAt', desc: true }], columnVisibility: { search: false } },
});

const headers = computed(() => table.getHeaderGroups()[0]?.headers ?? []);
const rows = computed(() => table.getRowModel().rows);

const query = ref('');
watch(query, (value) => {
  table.getColumn('search')?.setFilterValue(value);
});

function ariaSort(direction: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

const filterInput = useTemplateRef<HTMLInputElement>('filterInput');

/**
 * The ids in the order they are on screen. Keyboard selection has to walk what the reader sees,
 * which sorting and filtering both change — the unsorted `tasks` prop is the wrong list.
 */
const orderedIds = computed(() => rows.value.map((row) => row.original.id));

function focusFilter(): void {
  filterInput.value?.focus();
}

defineExpose({ focusFilter, orderedIds });
</script>
