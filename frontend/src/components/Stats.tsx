import { Show } from 'solid-js';
import type { CommuniquesResponse } from '../api';
import './Stats.css';

interface Props {
  data: CommuniquesResponse;
}

export default function Stats(props: Props) {
  const formatTimeAgo = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '-';
      
      const now = new Date();
      const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60)); // minutos

      if (diff < 60) return `${diff} min`;
      if (diff < 1440) return `${Math.floor(diff / 60)} h`;
      return `${Math.floor(diff / 1440)} dias`;
    } catch {
      return '-';
    }
  };

  const lastItem = props.data.items?.[0];

  return (
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value">{props.data.count || 0}</div>
        <div class="stat-label">Total</div>
      </div>
      <Show when={lastItem}>
        <div class="stat-card">
          <div class="stat-value">{formatTimeAgo(lastItem!.timestamp)}</div>
          <div class="stat-label">Última Atualização</div>
        </div>
      </Show>
    </div>
  );
}

