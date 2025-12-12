import './ErrorMessage.css';

interface Props {
  error: Error | unknown;
}

export default function ErrorMessage(props: Props) {
  const message = props.error instanceof Error 
    ? props.error.message 
    : String(props.error);

  const isConnectionError = message.includes('não está rodando') || 
                            message.includes('não foi possível conectar');

  return (
    <div class="error-message" role="alert">
      <div class="error-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <p class="error-title">Erro ao carregar comunicados</p>
      <p class="error-text">{message}</p>
      {isConnectionError && (
        <div class="error-help">
          <p><strong>Como resolver:</strong></p>
          <ol>
            <li>Abra um terminal na raiz do projeto</li>
            <li>Execute: <code>npm run dev</code></li>
            <li>Aguarde o Worker iniciar em <code>http://localhost:8787</code></li>
            <li>Recarregue esta página</li>
          </ol>
        </div>
      )}
    </div>
  );
}

