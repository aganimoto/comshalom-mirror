export interface Env {
  COMMUNIQUE_STORE: KVNamespace;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  ADMIN_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_TO?: string; // Pode ser múltiplos emails separados por vírgula
  EMAIL_ENABLED?: string; // "false" para desabilitar emails
  EMAIL_REPLY_TO?: string; // Email para reply-to (opcional)
  EMAIL_PROVIDER?: string; // "resend" ou "mailchannels" (padrão: "mailchannels")
  RESEND_API_KEY?: string; // API Key do Resend (necessário se EMAIL_PROVIDER=resend)
  CUSTOM_DOMAIN?: string; // Domínio customizado do GitHub Pages (ex: go.tomina.ga)
  PATTERNS?: string; // Padrões de busca separados por vírgula (opcional, senão usa padrão). Use "*" para processar todos
  RSS_FEEDS?: string; // URLs de feeds RSS separadas por vírgula (opcional, senão usa feed padrão)
  MIN_DATE?: string; // Data mínima no formato ISO (ex: 2025-09-01T00:00:00Z)
  BATCH_SIZE?: string; // Tamanho do batch para processamento paralelo (padrão: 5)
  MAX_CONCURRENCY?: string; // Máximo de itens processados em paralelo (padrão: 3)
  RATE_LIMIT_ENABLED?: string; // "false" para desabilitar rate limiting
  VAPID_PUBLIC_KEY?: string; // Chave pública VAPID para Web Push
  VAPID_PRIVATE_KEY?: string; // Chave privada VAPID para Web Push
}

export interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

export interface Communique {
  id: string;
  uuid: string; // UUID único para URLs públicas
  title: string;
  url: string;
  timestamp: string;
  html: string;
  githubSha?: string;
  githubUrl?: string;
  publicUrl?: string; // URL pública (domínio customizado ou GitHub)
}

