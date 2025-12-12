import './Loading.css';

interface Props {
  redirectUrl?: string;
}

export default function Loading(props: Props) {
  return (
    <div class="loading" role="status" aria-live="polite" aria-label={props.redirectUrl ? "Redirecionando" : "Carregando comunicados"}>
      <div class="spinner" aria-hidden="true"></div>
      {props.redirectUrl ? (
        <p>
          Redirecionando para o comunicado{' '}
          <a href={props.redirectUrl} style={{ color: '#0071e3', textDecoration: 'underline' }}>
            {props.redirectUrl}
          </a>
        </p>
      ) : (
        <p>Carregando comunicados...</p>
      )}
    </div>
  );
}

