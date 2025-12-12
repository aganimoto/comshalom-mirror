import { createResource, Resource } from 'solid-js';
import { fetchCommuniques, type CommuniquesResponse } from '../api';

export function useCommuniques(): Resource<CommuniquesResponse> {
  const [communiques] = createResource(fetchCommuniques, {
    // Retry automático em caso de erro
    initialValue: { count: 0, items: [] },
  });

  return communiques;
}

