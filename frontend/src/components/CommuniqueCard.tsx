import { Show, createMemo } from 'solid-js';
import type { Communique } from '../api';
import './CommuniqueCard.css';

interface Props {
  item: Communique;
}

export default function CommuniqueCard(props: Props) {
  const formatDate = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return 'Data inválida';
      
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      
      if (days === 0) return 'Hoje';
      if (days === 1) return 'Ontem';
      if (days < 7) return `${days} dias atrás`;
      
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Data inválida';
    }
  };

  const internalUrl = createMemo(() => 
    props.item.publicUrl || props.item.githubUrl
  );
  
  const hasInternalCopy = createMemo(() => !!internalUrl());

  return (
    <article class="communique-card" role="article" aria-labelledby={`title-${props.item.id}`}>
      <div class="communique-header">
        <h2 id={`title-${props.item.id}`} class="communique-title">
          {props.item.title || 'Sem título'}
        </h2>
        <time 
          class="communique-date" 
          datetime={props.item.timestamp}
          title={new Date(props.item.timestamp).toLocaleString('pt-BR')}
        >
          {formatDate(props.item.timestamp)}
        </time>
      </div>

      <Show when={hasInternalCopy()}>
        <div class="communique-url-container">
          <svg class="url-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <a 
            href={internalUrl()!} 
            target="_blank" 
            rel="noopener noreferrer" 
            class="communique-url"
            aria-label={`Ver página interna: ${props.item.title}`}
          >
            Página Interna
          </a>
        </div>
      </Show>

      <Show when={!hasInternalCopy()}>
        <div class="communique-url-container warning" role="status" aria-live="polite">
          <svg class="url-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span class="communique-url warning-text">Página ainda não copiada</span>
        </div>
      </Show>

      <div class="communique-actions" role="group" aria-label="Ações do comunicado">
        <Show when={props.item.publicUrl}>
          <a 
            href={props.item.publicUrl!} 
            target="_blank" 
            rel="noopener noreferrer" 
            class="btn btn-primary"
            aria-label={`Ver página interna de ${props.item.title}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            Ver Página
          </a>
        </Show>

        <Show when={props.item.githubUrl && props.item.publicUrl !== props.item.githubUrl}>
          <a 
            href={props.item.githubUrl!} 
            target="_blank" 
            rel="noopener noreferrer" 
            class="btn btn-secondary"
            aria-label={`Ver no GitHub: ${props.item.title}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            GitHub
          </a>
        </Show>

        <Show when={props.item.url}>
          <a 
            href={props.item.url} 
            target="_blank" 
            rel="noopener noreferrer" 
            class="btn btn-secondary"
            aria-label={`Ver fonte original: ${props.item.title}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            Original
          </a>
        </Show>
      </div>
    </article>
  );
}

