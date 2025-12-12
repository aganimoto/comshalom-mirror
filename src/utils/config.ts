// Configuração centralizada

import type { Env } from '../types';

export interface AppConfig {
  minDate: Date;
  patterns: string[];
  rssFeeds: string[];
  processAll: boolean;
  rateLimitEnabled: boolean;
  batchSize: number;
  maxConcurrency: number;
}

/**
 * Carrega e valida configuração do ambiente
 */
export function loadConfig(env: Env): AppConfig {
  // Data mínima configurável via ENV ou padrão
  const minDate = env.MIN_DATE 
    ? new Date(env.MIN_DATE) 
    : new Date('2025-09-01T00:00:00Z');
  
  // Feeds RSS configuráveis
  const rssFeeds = env.RSS_FEEDS
    ? env.RSS_FEEDS.split(',').map(url => url.trim()).filter(Boolean)
    : ['https://comshalom.org/feed/'];
  
  // Padrões configuráveis
  const patterns = env.PATTERNS
    ? env.PATTERNS === '*'
      ? ['*'] // Processa todos
      : env.PATTERNS.split(',').map(p => p.trim()).filter(Boolean)
    : ['discernimentos'];
  
  const processAll = patterns.length === 1 && patterns[0] === '*';
  
  // Configurações de processamento
  const batchSize = parseInt(env.BATCH_SIZE || '5', 10);
  const maxConcurrency = parseInt(env.MAX_CONCURRENCY || '3', 10);
  
  // Rate limiting (pode ser desabilitado via ENV)
  const rateLimitEnabled = env.RATE_LIMIT_ENABLED !== 'false';
  
  return {
    minDate,
    patterns,
    rssFeeds,
    processAll,
    rateLimitEnabled,
    batchSize: Math.max(1, Math.min(batchSize, 10)), // Entre 1 e 10
    maxConcurrency: Math.max(1, Math.min(maxConcurrency, 10)) // Entre 1 e 10
  };
}

