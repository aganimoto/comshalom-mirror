import { createResource } from 'solid-js';
import { fetchCommuniques, type CommuniquesResponse } from '../api';

export function useCommuniques() {
  const [communiques, { refetch }] = createResource<CommuniquesResponse>(
    async () => {
      // Força atualização sem cache para garantir dados atualizados
      return await fetchCommuniques(true);
    }
  );

  return {
    get items() {
      return communiques()?.items || [];
    },
    get count() {
      return communiques()?.count || 0;
    },
    get loading() {
      return communiques.loading;
    },
    get error() {
      return communiques.error;
    },
    refetch: () => {
      // Força atualização sem cache
      refetch();
    },
    // Retorna o objeto completo para compatibilidade
    get value() {
      return communiques();
    }
  };
}
