import { Show, For, onMount } from 'solid-js';
import { useCommuniques } from '../hooks/useCommuniques';
import { useSearch } from '../hooks/useSearch';
import Header from '../components/Header';
import SearchBar from '../components/SearchBar';
import CommuniqueCard from '../components/CommuniqueCard';
import EmptyState from '../components/EmptyState';
import './Home.css';

export default function Home() {
  const communiques = useCommuniques();
  const { search, setSearch, filtered, hasResults, resultCount } = useSearch(
    () => communiques()?.items || []
  );

  // Auto-refresh a cada 5 minutos
  onMount(() => {
    const interval = setInterval(() => {
      if (communiques.refetch) {
        communiques.refetch();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  });

  return (
    <div class="container">
      <Header
        communiques={communiques()}
        loading={communiques.loading}
        error={communiques.error}
      />

      <Show when={communiques() && !communiques.loading && !communiques.error}>
        <SearchBar
          value={search()}
          onInput={setSearch}
          resultCount={resultCount()}
        />

        <Show 
          when={hasResults()}
          fallback={
            <EmptyState 
              hasSearch={!!search()} 
              onClearSearch={() => setSearch('')}
            />
          }
        >
          <div class="communiques-grid" role="list">
            <For each={filtered()}>
              {(item, index) => (
                <div role="listitem" style={{ 'animation-delay': `${index() * 0.05}s` }}>
                  <CommuniqueCard item={item} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
