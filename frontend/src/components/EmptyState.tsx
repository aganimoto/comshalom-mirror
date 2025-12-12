import { Show } from 'solid-js';
import './EmptyState.css';

interface Props {
  hasSearch: boolean;
  onClearSearch?: () => void;
}

export default function EmptyState(props: Props) {
  return (
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </div>
      <h2>
        {props.hasSearch 
          ? 'Nenhum resultado encontrado' 
          : 'Nenhum comunicado encontrado'}
      </h2>
      <p>
        {props.hasSearch 
          ? 'Tente buscar com outros termos ou limpe a busca para ver todos os comunicados.'
          : 'Os comunicados aparecerão aqui quando forem detectados pelo sistema.'}
      </p>
      <Show when={props.hasSearch && props.onClearSearch}>
        <button class="btn btn-secondary" onClick={props.onClearSearch}>
          Limpar Busca
        </button>
      </Show>
    </div>
  );
}



