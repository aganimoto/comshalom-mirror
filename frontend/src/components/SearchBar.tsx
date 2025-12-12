import { JSX } from 'solid-js';
import './SearchBar.css';

interface Props {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
}

export default function SearchBar(props: Props) {
  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    props.onInput(e.currentTarget.value);
  };

  return (
    <div class="search-container">
      <div class="search-wrapper">
        <svg 
          class="search-icon" 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <input
          type="text"
          placeholder={props.placeholder || "Buscar comunicados..."}
          value={props.value}
          onInput={handleInput}
          class="search-input"
          aria-label="Buscar comunicados"
          autocomplete="off"
        />
        {props.value && (
          <button
            class="search-clear"
            onClick={() => props.onInput('')}
            aria-label="Limpar busca"
            type="button"
          >
            ×
          </button>
        )}
      </div>
      {props.value && props.resultCount !== undefined && (
        <div class="search-results-count">
          {props.resultCount} resultado{props.resultCount !== 1 ? 's' : ''} encontrado{props.resultCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}


