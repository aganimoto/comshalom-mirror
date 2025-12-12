import { Show } from 'solid-js';
import Stats from './Stats';
import Loading from './Loading';
import ErrorMessage from './ErrorMessage';
import type { CommuniquesResponse } from '../api';
import './Header.css';

interface Props {
  communiques: CommuniquesResponse | undefined;
  loading: boolean;
  error: Error | unknown;
  redirectUrl?: string;
}

export default function Header(props: Props) {
  return (
    <header class="header">
      <div class="banner-container">
        <img 
          src="./image.jpg" 
          alt="Banner ComShalom" 
          class="banner-image"
          loading="eager"
        />
      </div>
      <div class="header-content">
        <div class="logo-container">
          <img 
            src="./logo.png" 
            alt="Logo Shalom" 
            class="logo-image"
            loading="eager"
          />
          <span class="logo-text">mirror</span>
        </div>
        <h1>Comunicados de Discernimentos</h1>
        <p class="subtitle">Comunidade Católica Shalom</p>
        
        <Show when={props.loading}>
          <Loading redirectUrl={props.redirectUrl} />
        </Show>

        <Show when={props.error}>
          <ErrorMessage error={props.error} />
        </Show>

        <Show when={props.communiques && !props.loading && !props.error}>
          <Stats data={props.communiques!} />
        </Show>
      </div>
    </header>
  );
}


