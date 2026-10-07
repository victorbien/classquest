import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Asset, type ApiError } from '../api';
import { useAuth } from '../auth';
import { isTerminal, searchAndSort, type SortOrder, type TypeFilter } from '../lib/assets';
import { PageHeader } from '../components/shell/PageHeader';
import { ResourceCard } from '../components/ResourceCard';
import { Button, Card, EmptyState, SearchInput, SegmentedControl, Select, type SegmentOption } from '../components/ui';

const TYPE_OPTIONS: SegmentOption<TypeFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'document', label: 'Documents', icon: 'document' },
  { value: 'book', label: 'Books', icon: 'book' },
  { value: 'video', label: 'Videos', icon: 'video' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'Title A–Z' },
];

/**
 * Library (teachers and admins): every resource across all courses, with its
 * pipeline state. Students reach resources through Courses instead (/library
 * redirects them there). Search and sort run client-side over GET /assets.
 */
export function Library() {
  const { session } = useAuth();
  const isStaff = session?.role === 'teacher' || session?.role === 'admin';

  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { assets } = await api.listAssets(type === 'all' ? undefined : type);
      setAssets(assets);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message ?? 'Could not load the library');
    }
  }, [type]);

  // Reload when the type filter changes.
  useEffect(() => {
    setAssets(null);
    void load();
  }, [load]);

  // Staff watch items move through the pipeline, so refresh faster while any
  // asset is still in flight; otherwise refresh occasionally.
  const inFlight = isStaff && (assets ?? []).some((a) => !isTerminal(a.status));
  useEffect(() => {
    const t = setInterval(() => void load(), inFlight ? 4000 : 30000);
    return () => clearInterval(t);
  }, [load, inFlight]);

  const visible = useMemo(() => searchAndSort(assets ?? [], query, sort), [assets, query, sort]);
  const total = assets?.length ?? 0;
  const searching = query.trim().length > 0;

  return (
    <>
      <PageHeader
        eyebrow={isStaff ? 'Resource library' : 'Learning portal'}
        title="Learning Library"
        description={
          isStaff
            ? 'Every resource across all courses, including items still being processed. Students only see completed resources of published courses.'
            : 'Documents, books and videos shared by your teachers. Resources open through secure, time-limited links.'
        }
        actions={
          <div className="cq-count-chip" aria-live="polite">
            <span className="cq-count-chip__value">{assets ? total : '–'}</span>
            <span className="cq-count-chip__label">
              {total === 1 ? 'resource' : 'resources'}
              {type !== 'all' && <> · {TYPE_OPTIONS.find((o) => o.value === type)?.label.toLowerCase()}</>}
            </span>
          </div>
        }
      />

      <Card variant="compact" className="cq-library-filters">
        <SearchInput value={query} onChange={setQuery} label="Search resources by title" placeholder="Search by title…" />
        <div className="cq-library-filters__row">
          <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} label="Resource type" />
          <Select label="Sort" hideLabel value={sort} onChange={(v) => setSort(v as SortOrder)} options={SORT_OPTIONS} />
        </div>
      </Card>

      {searching && assets && (
        <p className="cq-small cq-library-results" aria-live="polite">
          Showing {visible.length} of {total} {total === 1 ? 'resource' : 'resources'} matching “{query.trim()}”
        </p>
      )}

      {error && !assets ? (
        <Card>
          <EmptyState
            icon="alert"
            title="The library could not be loaded"
            description={error}
            action={<Button variant="secondary" iconLeft="refresh" onClick={() => void load()}>Try again</Button>}
          />
        </Card>
      ) : !assets ? (
        <div className="cq-resource-grid" aria-busy="true" aria-label="Loading resources">
          {[0, 1, 2].map((i) => (
            <div key={i} className="cq-resource cq-resource--skeleton" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          {searching ? (
            <EmptyState
              icon="search"
              title="No matching resources"
              description="Try a different title, or clear the search."
              action={<Button variant="secondary" onClick={() => setQuery('')}>Clear search</Button>}
            />
          ) : (
            <EmptyState
              icon="library"
              title={type === 'all' ? 'No resources yet' : `No ${TYPE_OPTIONS.find((o) => o.value === type)?.label.toLowerCase()} yet`}
              description={
                isStaff
                  ? 'Add a resource to a course, or seed the demo courses from Operations.'
                  : 'Resources appear here once your teachers publish them.'
              }
            />
          )}
        </Card>
      ) : (
        <div className="cq-resource-grid">
          {visible.map((a) => (
            <ResourceCard key={a.id} asset={a} showPipeline={isStaff} />
          ))}
        </div>
      )}
    </>
  );
}
