import { Show, For, onMount, createMemo } from 'solid-js';
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

  // URL do comunicado mais recente para redirecionamento
  const redirectUrl = createMemo(() => {
    const items = communiques()?.items;
    if (items && items.length > 0) {
      // Prioriza publicUrl, depois githubUrl
      return items[0].publicUrl || items[0].githubUrl || '';
    }
    return '';
  });

  // Auto-refresh a cada 5 minutos
  onMount(() => {
    const interval = setInterval(() => {
      if (communiques.refetch) {
        communiques.refetch();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  });

  // Redireciona automaticamente quando os comunicados carregarem
  onMount(() => {
    // Aguarda um pouco para garantir que o loading apareça
    const checkAndRedirect = () => {
      const url = redirectUrl();
      if (url && !communiques.loading && communiques() && !communiques.error) {
        // Pequeno delay para mostrar a mensagem de redirecionamento
        setTimeout(() => {
          window.location.href = url;
        }, 1000);
      }
    };

    // Verifica periodicamente se os dados carregaram
    const interval = setInterval(() => {
      checkAndRedirect();
    }, 100);

    // Limpa o intervalo quando redirecionar ou após 10 segundos
    setTimeout(() => {
      clearInterval(interval);
    }, 10000);

    return () => clearInterval(interval);
  });

  return (
    <div class="container">
      <Header
        communiques={communiques()}
        loading={communiques.loading}
        error={communiques.error}
        redirectUrl={redirectUrl()}
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
