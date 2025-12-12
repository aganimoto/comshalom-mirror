// Detecção automática da URL do Worker
function getWorkerUrl(): string {
  if (typeof window === 'undefined') return '';
  
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8787';
  }
  return import.meta.env.VITE_WORKER_URL || 'https://comshalom-rss-monitor.tominaga.workers.dev';
}

const WORKER_URL = getWorkerUrl();
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'sh1982';

export interface Communique {
  id: string;
  uuid?: string;
  title: string;
  url: string;
  timestamp: string;
  githubUrl?: string;
  publicUrl?: string;
}

export interface CommuniquesResponse {
  count: number;
  total?: number;
  cursor?: string;
  hasMore?: boolean;
  items: Communique[];
}

export async function fetchCommuniques(forceRefresh = false): Promise<CommuniquesResponse> {
  try {
    // Adiciona parâmetro para forçar atualização sem cache quando necessário
    // Por padrão, adiciona timestamp para evitar cache muito antigo
    const cacheParam = forceRefresh ? '&_nocache=true' : `&_t=${Date.now()}`;
    const response = await fetch(`${WORKER_URL}/admin/list?limit=100${cacheParam}`, {
      headers: {
        'X-ADMIN-KEY': ADMIN_KEY
      },
      // Timeout de 30 segundos
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Não autorizado. Verifique a chave de administração.');
      }
      if (response.status === 404) {
        throw new Error('Endpoint não encontrado. Verifique a URL do Worker.');
      }
      throw new Error(`Erro ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Validação básica dos dados
    if (!data || !Array.isArray(data.items)) {
      throw new Error('Resposta inválida do servidor');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      // Tratamento específico para conexão recusada
      if (error.message.includes('Failed to fetch') || 
          error.message.includes('ERR_CONNECTION_REFUSED') ||
          error.message.includes('NetworkError')) {
        const isLocalhost = typeof window !== 'undefined' && 
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        
        if (isLocalhost && WORKER_URL.includes('localhost:8787')) {
          throw new Error(
            'Worker não está rodando. ' +
            'Execute "npm run dev" na raiz do projeto para iniciar o Worker em http://localhost:8787'
          );
        }
        throw new Error('Não foi possível conectar ao servidor. Verifique se o Worker está rodando.');
      }
      
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new Error('Tempo de espera esgotado. Tente novamente.');
      }
      throw error;
    }
    throw new Error('Erro desconhecido ao buscar comunicados');
  }
}

