import { createSignal, createMemo, Accessor } from 'solid-js';
import type { Communique } from '../api';

export function useSearch(items: Accessor<Communique[]>) {
  const [search, setSearch] = createSignal('');

  const filtered = createMemo(() => {
    const query = search().toLowerCase().trim();
    if (!query) return items();
    
    return items().filter(item => 
      item.title?.toLowerCase().includes(query) ||
      item.url?.toLowerCase().includes(query) ||
      item.timestamp?.toLowerCase().includes(query)
    );
  });

  return {
    search,
    setSearch,
    filtered,
    hasResults: () => filtered().length > 0,
    resultCount: () => filtered().length,
  };
}

