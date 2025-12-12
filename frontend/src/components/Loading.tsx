import './Loading.css';

export default function Loading() {
  return (
    <div class="loading" role="status" aria-live="polite" aria-label="Carregando comunicados">
      <div class="spinner" aria-hidden="true"></div>
      <p>Carregando comunicados...</p>
    </div>
  );
}

