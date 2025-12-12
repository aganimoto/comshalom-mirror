import type { CommuniquesResponse } from '../api';
import './Stats.css';

interface Props {
  data: CommuniquesResponse;
}

export default function Stats(props: Props) {
  const count = props.data.count || 0;
  const items = props.data.items || [];
  
  // Conta quantos têm cópia interna (publicUrl ou githubUrl)
  const withInternalCopy = items.filter(item => item.publicUrl || item.githubUrl).length;
  
  // Conta quantos têm apenas URL original
  const onlyOriginal = count - withInternalCopy;

  return (
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value">{count}</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{withInternalCopy}</div>
        <div class="stat-label">Com Cópia</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{onlyOriginal}</div>
        <div class="stat-label">Apenas Original</div>
      </div>
    </div>
  );
}
