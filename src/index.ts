import { Router } from 'itty-router';
import type { Env, RSSItem, Communique } from './types';
import { logger } from './utils/logger';
import { escapeHtml, sanitizeHTML } from './utils/sanitize';
import { checkRateLimit, getRequestIdentifier } from './utils/rateLimit';
import { loadConfig } from './utils/config';
import { parseRSSFeed } from './utils/rssParser';
import { optimizedLevenshtein, validateSize, createOptimizedResponse } from './utils/workers';
import { getCachedResponse, cacheResponse, createCacheKey } from './utils/cache';
import { validateSubscription, type PushSubscription } from './utils/webpush';

// Função de similaridade usando Levenshtein Distance otimizada para Workers
function levenshteinDistance(str1: string, str2: string): number {
  // Usa versão otimizada que consome menos memória
  return optimizedLevenshtein(str1, str2);
}

function calculateSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  return 1 - (distance / maxLen);
}

// Verifica se o título corresponde aos padrões procurados
function matchesPattern(title: string, patterns: string[]): boolean {
  const normalizedTitle = title.toLowerCase();
  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase();
    
    // Primeiro verifica se o padrão está contido no título (mais permissivo)
    if (normalizedTitle.includes(normalizedPattern)) {
      return true;
    }
    
    // Se não estiver contido, calcula similaridade
    const similarity = calculateSimilarity(normalizedTitle, normalizedPattern);
    if (similarity > 0.7) {
      return true;
    }
  }
  return false;
}

// Parser RSS movido para utils/rssParser.ts

// Valida formato de URL
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Valida formato de email
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

// Gera slug a partir do título (usado apenas para referência, não no nome do arquivo)
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

// Gera HTML completo com wrapper para a página
function generateFullPageHTML(communique: Communique): string {
  const safeTitle = escapeHtml(communique.title);
  const safeUrl = escapeHtml(communique.url || '');
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f7;
            color: #1d1d1f;
            line-height: 1.6;
        }
        
        .header {
            background: white;
            border-bottom: 1px solid #e5e5e7;
            padding: 20px 0;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }
        
        .header h1 {
            font-size: 1.5em;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 8px;
        }
        
        .header-meta {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            font-size: 0.9em;
            color: #86868b;
        }
        
        .header-meta a {
            color: #0071e3;
            text-decoration: none;
        }
        
        .header-meta a:hover {
            text-decoration: underline;
        }
        
        .content-wrapper {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        
        .content {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
        }
        
        .content img {
            max-width: 100%;
            height: auto;
        }
        
        .content a {
            color: #0071e3;
            text-decoration: none;
        }
        
        .content a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 1.2em;
            }
            
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>${safeTitle}</h1>
            <div class="header-meta">
                <span>📅 ${new Date(communique.timestamp).toLocaleString('pt-BR')}</span>
                ${safeUrl ? `<a href="${safeUrl}" target="_blank">🌐 Fonte Original</a>` : ''}
            </div>
        </div>
    </div>
    <div class="content-wrapper">
        <div class="content">
            ${communique.html}
        </div>
    </div>
</body>
</html>`;
}

// Cache para branch default do GitHub
let cachedDefaultBranch: { branch: string; expires: number } | null = null;
const BRANCH_CACHE_TTL = 3600000; // 1 hora

// Detecta branch padrão do repositório GitHub (com cache)
async function getDefaultBranch(env: Env): Promise<string> {
  // Verifica cache
  if (cachedDefaultBranch && cachedDefaultBranch.expires > Date.now()) {
    return cachedDefaultBranch.branch;
  }
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`,
      {
        headers: {
          // Tokens classic (ghp_*) podem usar 'token' ou 'Bearer'
          // Fine-grained tokens (github_pat_*) usam 'Bearer'
          'Authorization': env.GITHUB_TOKEN.startsWith('github_pat_')
            ? `Bearer ${env.GITHUB_TOKEN}` 
            : `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Cloudflare-Worker'
        }
      }
    );

    if (response.ok) {
      const data = await response.json() as { default_branch: string };
      const branch = data.default_branch || 'main';
      
      // Atualiza cache
      cachedDefaultBranch = {
        branch,
        expires: Date.now() + BRANCH_CACHE_TTL
      };
      
      return branch;
    }
  } catch (error) {
    logger.warn('Erro ao detectar branch padrão, usando "main"', { error: String(error) });
  }
  
  const fallback = 'main';
  // Cache fallback também
  cachedDefaultBranch = {
    branch: fallback,
    expires: Date.now() + BRANCH_CACHE_TTL
  };
  
  return fallback;
}

// Busca HTML completo da página com timeout e retry
async function fetchFullHTML(url: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Cria um AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ComShalomRSSMonitor/1.0)'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch HTML: ${response.status} ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Valida tamanho usando função otimizada
      if (!validateSize(html, 10)) {
        const sizeMB = (html.length / 1024 / 1024).toFixed(2);
        throw new Error(`HTML muito grande: ${sizeMB}MB (máx: 10MB)`);
      }
      
      // Sanitiza HTML antes de retornar
      return sanitizeHTML(html, url);
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // Espera antes de tentar novamente (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error('Failed to fetch HTML after retries');
}

// Cria ou atualiza arquivo no GitHub com retry
async function commitToGitHub(
  env: Env,
  id: string,
  uuid: string,
  title: string,
  html: string,
  retries = 2,
  communique?: Communique
): Promise<{ sha?: string; url: string; githubUrl: string }> {
  // Usa apenas UUID para nome do arquivo (mais curto)
  const filename = `pages/${uuid}.html`;
  const path = filename;

  // Detecta branch padrão
  const defaultBranch = await getDefaultBranch(env);
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/${path}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let existingSha: string | undefined;
      
      // Verifica se o arquivo já existe
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
        
        const existingResponse = await fetch(apiUrl, {
          signal: controller.signal,
          headers: {
            'Authorization': env.GITHUB_TOKEN.startsWith('ghp_') 
              ? `Bearer ${env.GITHUB_TOKEN}` 
              : `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare-Worker'
          }
        });
        
        clearTimeout(timeoutId);

        if (existingResponse.ok) {
          const existingData = await existingResponse.json() as { sha: string };
          existingSha = existingData.sha;
        }
      } catch (e) {
        // Arquivo não existe, continuar
      }

      // Se tiver o objeto communique completo, gera HTML com wrapper
      let finalHtml = html;
      if (communique) {
        finalHtml = generateFullPageHTML(communique);
      }

      // Converte HTML para base64
      const content = btoa(unescape(encodeURIComponent(finalHtml)));

      // Cria ou atualiza o arquivo
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      // Para tokens classic (ghp_*), usar formato "token"
      // Para fine-grained tokens (github_pat_*), usar "Bearer"
      const authHeader = env.GITHUB_TOKEN.startsWith('github_pat_')
        ? `Bearer ${env.GITHUB_TOKEN}` 
        : `token ${env.GITHUB_TOKEN}`;
      
      // A API do GitHub Contents usa PUT para criar ou atualizar
      // Não precisa especificar branch se for a branch padrão
      const requestBody: any = {
        message: `Auto-import: comunicado detectado no RSS do ComShalom – ${title}`,
        content: content
      };
      
      // Adiciona branch apenas se não for a padrão
      if (defaultBranch !== 'main') {
        requestBody.branch = defaultBranch;
      }
      
      // Se o arquivo já existe, precisa do SHA para atualizar
      if (existingSha) {
        requestBody.sha = existingSha;
      }
      
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Worker'
        },
        body: JSON.stringify(requestBody)
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        logger.error('Erro na API do GitHub ao criar arquivo', { 
          status: response.status, 
          statusText: response.statusText,
          url: apiUrl,
          path: path,
          repo: `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`,
          owner: env.GITHUB_REPO_OWNER,
          name: env.GITHUB_REPO_NAME,
          defaultBranch: defaultBranch,
          hasToken: !!env.GITHUB_TOKEN,
          tokenLength: env.GITHUB_TOKEN ? env.GITHUB_TOKEN.length : 0,
          tokenPrefix: env.GITHUB_TOKEN ? env.GITHUB_TOKEN.substring(0, 10) + '...' : 'none',
          tokenSuffix: env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 10 ? '...' + env.GITHUB_TOKEN.substring(env.GITHUB_TOKEN.length - 4) : 'none',
          authHeaderPrefix: authHeader.substring(0, 25) + '...',
          method: 'PUT',
          hasExistingSha: !!existingSha,
          error 
        });
        throw new Error(`GitHub API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as { commit: { sha: string }; content: { html_url?: string } };
      
      // Tenta usar html_url da resposta, senão constrói manualmente
      const githubUrl = data.content.html_url || 
        `https://github.com/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/blob/${defaultBranch}/${path}`;
      
      // Se tiver domínio customizado configurado, usa ele
      const customDomain = env.CUSTOM_DOMAIN;
      const publicUrl = customDomain 
        ? `https://${customDomain}/${path}`
        : githubUrl;
      
      return {
        sha: data.commit.sha,
        url: publicUrl,
        githubUrl: githubUrl
      };
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // Espera antes de tentar novamente (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error('Failed to commit to GitHub after retries');
}

// Envia email via Mailchannels com retry e validação
async function sendEmail(
  env: Env,
  communique: Communique,
  githubUrl: string,
  retries = 2
): Promise<void> {
  if (!env.EMAIL_FROM || !env.EMAIL_TO) {
    logger.warn('Email não configurado, pulando envio');
    return;
  }

  // Valida email de origem
  if (!isValidEmail(env.EMAIL_FROM)) {
    logger.warn('Email de origem inválido', { emailFrom: env.EMAIL_FROM });
    return;
  }

  // Suporta múltiplos emails separados por vírgula
  const recipients = env.EMAIL_TO.split(',')
    .map(email => email.trim())
    .filter(email => {
      if (!isValidEmail(email)) {
        logger.warn('Email destinatário inválido ignorado', { email });
        return false;
      }
      return true;
    });
  
  if (recipients.length === 0) {
    logger.warn('Nenhum destinatário de email válido configurado');
    return;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const emailContent = {
        personalizations: [{
          to: recipients.map(email => ({ email }))
        }],
        from: {
          email: env.EMAIL_FROM,
          name: 'ComShalom RSS Monitor'
        },
        subject: `Novo Comunicado Detectado: ${communique.title}`,
        content: [{
          type: 'text/html',
          value: `
            <h2>Novo Comunicado Detectado</h2>
            <p><strong>Título:</strong> ${communique.title}</p>
            <p><strong>URL Original:</strong> <a href="${communique.url}">${communique.url}</a></p>
            <p><strong>Data:</strong> ${new Date(communique.timestamp).toLocaleString('pt-BR')}</p>
            <p><strong>Commit SHA:</strong> ${communique.githubSha || 'N/A'}</p>
            <p><strong>URL Pública:</strong> <a href="${githubUrl}">${githubUrl}</a></p>
            ${communique.githubUrl && communique.githubUrl !== githubUrl ? `<p><strong>GitHub:</strong> <a href="${communique.githubUrl}">${communique.githubUrl}</a></p>` : ''}
            <hr>
            <p><small>Este é um email automático do sistema de monitoramento RSS do ComShalom.</small></p>
          `
        }]
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailContent)
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Mailchannels error: ${response.status} - ${error}`);
      }
      
      return; // Sucesso
    } catch (error) {
      if (attempt === retries) {
        logger.error('Erro ao enviar email após retries', { error: String(error) });
        throw error;
      }
      // Espera antes de tentar novamente
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

// Envia notificações push para todos os dispositivos registrados
async function sendPushNotifications(
  env: Env,
  communique: Communique,
  publicUrl: string
): Promise<void> {
  try {
    // Salva evento de notificação para o Service Worker verificar via polling
    const notificationEvent = {
      id: communique.id,
      title: communique.title,
      url: publicUrl,
      timestamp: Date.now()
    };
    
    await env.COMMUNIQUE_STORE.put('last_notification', JSON.stringify(notificationEvent));
    logger.info('Notificação push preparada', { id: communique.id, title: communique.title });
  } catch (error) {
    logger.error('Erro ao preparar notificação push', { error: String(error) });
    // Não falha o processamento se push falhar
  }
}

// Processa um item individual
async function processItem(
  item: RSSItem,
  env: Env,
  config: ReturnType<typeof loadConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    // Gera ID único baseado no hash da URL
    const urlHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(item.link)
    );
    const hashArray = Array.from(new Uint8Array(urlHash));
    const id = hashArray
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 32);
    
    // Gera UUID único para URLs públicas
    const uuid = crypto.randomUUID();
    
    // Verifica se já existe no KV
    const existing = await env.COMMUNIQUE_STORE.get(id);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as Communique;
        if (parsed.url === item.link || parsed.title === item.title) {
          logger.debug('Item já existe', { id, title: item.title });
          return { success: false, error: 'Already exists' };
        }
      } catch (e) {
        logger.warn('Erro ao parsear item existente', { id, error: String(e) });
      }
    }

    logger.info('Processando novo item', { id, uuid, title: item.title });

    // Busca HTML completo (já sanitizado)
    const html = await fetchFullHTML(item.link);

    // Cria objeto do comunicado
    const communique: Communique = {
      id,
      uuid,
      title: item.title,
      url: item.link,
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      html
    };

    // Salva no KV
    await env.COMMUNIQUE_STORE.put(id, JSON.stringify(communique));

    // Commit no GitHub (passa o communique para gerar HTML completo)
    const githubResult = await commitToGitHub(env, id, uuid, item.title, html, 2, communique);
    communique.githubSha = githubResult.sha;
    communique.githubUrl = githubResult.githubUrl;
    communique.publicUrl = githubResult.url;
    
    // Atualiza no KV com informações do GitHub
    await env.COMMUNIQUE_STORE.put(id, JSON.stringify(communique));

    // Envia email
    await sendEmail(env, communique, githubResult.url);
    
    // Envia notificações push
    await sendPushNotifications(env, communique, githubResult.url);
    
    logger.info('Comunicado processado com sucesso', { id, title: item.title });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Erro ao processar item', { title: item.title, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

// Função principal do Cron
async function processRSSFeed(env: Env): Promise<{ processed: number; saved: number; errors: number }> {
  const startTime = Date.now();
  const config = loadConfig(env);
  
  const stats = {
    processed: 0,
    saved: 0,
    errors: 0
  };

  try {
    logger.info('Iniciando processamento RSS', { 
      feedsCount: config.rssFeeds.length,
      patternsCount: config.patterns.length,
      minDate: config.minDate.toISOString()
    });
    
    // Processa todos os feeds RSS em paralelo
    const feedResults = await Promise.allSettled(
      config.rssFeeds.map(async (feedUrl) => {
        if (!isValidUrl(feedUrl)) {
          logger.warn('URL de feed inválida ignorada', { feedUrl });
          return [];
        }
        
        logger.info('Processando feed', { feedUrl });
        const items = await parseRSSFeed(feedUrl);
        logger.info('Itens encontrados no feed', { feedUrl, count: items.length });
        return items;
      })
    );
    
    // Coleta todos os itens
    let allItems: RSSItem[] = [];
    for (const result of feedResults) {
      if (result.status === 'fulfilled') {
        allItems = allItems.concat(result.value);
      } else {
        stats.errors++;
        logger.error('Erro ao processar feed', { error: String(result.reason) });
      }
    }
    
    // Remove duplicatas por URL
    const uniqueItems = Array.from(
      new Map(allItems.map(item => [item.link, item])).values()
    );
    
    logger.info('Itens únicos após remover duplicatas', { count: uniqueItems.length });

    // Filtra itens relevantes por padrão E por data
    const relevantItems = uniqueItems.filter(item => {
      if (!isValidUrl(item.link)) {
        logger.warn('URL inválida ignorada', { url: item.link });
        return false;
      }
      
      // Filtra por data
      if (item.pubDate) {
        try {
          const itemDate = new Date(item.pubDate);
          if (isNaN(itemDate.getTime()) || itemDate < config.minDate) {
            return false;
          }
        } catch (e) {
          logger.warn('Erro ao parsear data', { pubDate: item.pubDate });
        }
      }
      
      // Se processAll = true, não filtra por padrão
      if (config.processAll) {
        return true;
      }
      
      return matchesPattern(item.title, config.patterns);
    });
    
    logger.info('Itens relevantes encontrados', { 
      count: relevantItems.length,
      processAll: config.processAll 
    });

    // Processa itens em batches paralelos
    const batchSize = config.batchSize;
    const maxConcurrency = config.maxConcurrency;
    
    for (let i = 0; i < relevantItems.length; i += batchSize) {
      const batch = relevantItems.slice(i, i + batchSize);
      
      // Processa batch com limite de concorrência
      const semaphore: Promise<void>[] = [];
      for (const item of batch) {
        stats.processed++;
        
        // Limita concorrência
        if (semaphore.length >= maxConcurrency) {
          await Promise.race(semaphore);
        }
        
        const promise = processItem(item, env, config).then(result => {
          if (result.success) {
            stats.saved++;
          } else {
            stats.errors++;
          }
        });
        
        semaphore.push(promise);
      }
      
      // Aguarda batch completo
      await Promise.all(semaphore);
    }

    const duration = Date.now() - startTime;
    logger.info('Processamento concluído', { 
      duration,
      processed: stats.processed,
      saved: stats.saved,
      errors: stats.errors
    });
    
    return stats;
  } catch (error) {
    stats.errors++;
    logger.error('Erro ao processar RSS', { error: String(error) });
    throw error;
  }
}

// Middleware de autenticação para rotas admin
function requireAdmin(env: Env) {
  return (request: Request): Response | undefined => {
    if (!env.ADMIN_KEY) {
      return undefined; // Sem proteção se não configurado
    }

    const authHeader = request.headers.get('X-ADMIN-KEY');
    if (authHeader !== env.ADMIN_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return undefined;
  };
}

// Helper para adicionar headers CORS
function addCorsHeaders(response: Response, origin?: string | null): Response {
  const headers = new Headers(response.headers);
  
  // Permite requisições do domínio do frontend
  const allowedOrigins = [
    'https://go.tomina.ga',
    'https://aganimoto.github.io',
    'http://localhost:8787',
    'http://localhost:3000',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000'
  ];
  
  // Verifica se o origin está na lista de permitidos
  if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Se não houver origin (requisição direta), permite qualquer origem em desenvolvimento
    headers.set('Access-Control-Allow-Origin', '*');
  }
  
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-ADMIN-KEY');
  headers.set('Access-Control-Max-Age', '86400');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Router
const router = Router();

// Rota admin: listar todos os comunicados (com paginação e cache)
router.get('/admin/list', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  // Rate limiting
  if (loadConfig(env).rateLimitEnabled) {
    const identifier = getRequestIdentifier(request);
    const rateLimit = await checkRateLimit(env.COMMUNIQUE_STORE, identifier);
    if (!rateLimit.allowed) {
      return createOptimizedResponse(JSON.stringify({ 
        error: 'Rate limit exceeded',
        resetAt: rateLimit.resetAt 
      }), {
        status: 429,
        headers: { 
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt)
        }
      });
    }
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100); // Máx 100
    const cursor = url.searchParams.get('cursor') || undefined;
    const search = url.searchParams.get('search')?.toLowerCase();
    const noCache = url.searchParams.get('_nocache') === 'true' || url.searchParams.get('_refresh') === 'true';
    
    // Tenta buscar do cache (apenas se não houver search, cursor ou se não for forçado a não usar cache)
    if (!search && !cursor && !noCache && typeof caches !== 'undefined') {
      const cacheKey = createCacheKey(request.url);
      const cached = await getCachedResponse(await caches.open('admin-list'), cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    // Lista com paginação
    const result = await env.COMMUNIQUE_STORE.list({ limit, cursor });
    
    // Busca valores em paralelo (otimizado para Workers)
    const values = await Promise.all(
      result.keys.map(key => env.COMMUNIQUE_STORE.get(key.name))
    );
    
    let items: Communique[] = values
      .filter((v): v is string => v !== null)
      .map(v => {
        try {
          return JSON.parse(v) as Communique;
        } catch (e) {
          logger.warn('Erro ao parsear item do KV', { error: String(e) });
          return null;
        }
      })
      .filter((item): item is Communique => item !== null && !!item.id && !!item.title);

    // Filtro de busca (se fornecido)
    if (search) {
      items = items.filter(item => 
        (item.title ? item.title.toLowerCase().includes(search) : false) ||
        (item.url ? item.url.toLowerCase().includes(search) : false)
      );
    }

    // Ordena por timestamp (mais recentes primeiro), itens sem timestamp vão para o final
    items.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;
      return dateB - dateA;
    });

    // Constrói a URL base para visualização
    const baseUrl = new URL(request.url).origin;
    
    const responseData = {
      count: items.length,
      total: result.list_complete ? items.length : undefined,
      cursor: 'cursor' in result ? result.cursor : undefined,
      hasMore: result.list_complete === false,
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        url: item.url,
        timestamp: item.timestamp,
        githubUrl: item.githubUrl,
        publicUrl: item.publicUrl || item.githubUrl // Usa GitHub Pages como visualização
      }))
    };
    
    const response = createOptimizedResponse(JSON.stringify(responseData), {
      headers: { 'Content-Type': 'application/json' }
    });
    
    // Cachea resposta se não houver search, cursor ou se não for forçado a não usar cache
    if (!search && !cursor && !noCache && typeof caches !== 'undefined') {
      ctx.waitUntil(
        cacheResponse(await caches.open('admin-list'), createCacheKey(request.url), response, 60)
          .catch(err => logger.warn('Erro ao cachear resposta', { error: String(err) }))
      );
    }
    
    return response;
  } catch (error) {
    logger.error('Erro ao listar comunicados', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Função auxiliar para renderizar HTML do comunicado
function renderCommuniqueHTML(communique: Communique, baseUrl: string, viewUrl: string): string {
  const publicUrl = communique.publicUrl || communique.githubUrl || communique.url;
  const safeTitle = escapeHtml(communique.title);
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f7;
            color: #1d1d1f;
            line-height: 1.6;
        }
        
        .header {
            background: white;
            border-bottom: 1px solid #e5e5e7;
            padding: 20px 0;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }
        
        .header h1 {
            font-size: 1.5em;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 8px;
        }
        
        .header-meta {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            font-size: 0.9em;
            color: #86868b;
        }
        
        .header-meta a {
            color: #0071e3;
            text-decoration: none;
        }
        
        .header-meta a:hover {
            text-decoration: underline;
        }
        
        .content-wrapper {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        
        .content {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
        }
        
        .content img {
            max-width: 100%;
            height: auto;
        }
        
        .content a {
            color: #0071e3;
            text-decoration: none;
        }
        
        .content a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 1.2em;
            }
            
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>${safeTitle}</h1>
            <div class="header-meta">
                <span>📅 ${new Date(communique.timestamp).toLocaleString('pt-BR')}</span>
                ${publicUrl ? `<a href="${escapeHtml(publicUrl)}" target="_blank">🔗 Ver original</a>` : ''}
                ${communique.url ? `<a href="${escapeHtml(communique.url)}" target="_blank">🌐 Fonte</a>` : ''}
            </div>
        </div>
    </div>
    <div class="content-wrapper">
        <div class="content">
            ${communique.html}
        </div>
    </div>
</body>
</html>`;
}

// Rota admin: visualizar HTML de um comunicado
// Função para salvar log de visualização/cópia
async function saveAccessLog(
  kv: KVNamespace,
  type: 'view' | 'copy',
  communiqueId: string,
  communiqueTitle: string,
  request: Request
): Promise<void> {
  try {
    const logEntry = {
      type,
      communiqueId,
      communiqueTitle,
      timestamp: new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
      referer: request.headers.get('Referer') || 'direct'
    };
    
    const logKey = `access_log:${Date.now()}:${Math.random().toString(36).substring(7)}`;
    await kv.put(logKey, JSON.stringify(logEntry), {
      expirationTtl: 86400 * 30 // 30 dias
    });
    
    logger.info(`Log de ${type} salvo`, { communiqueId, communiqueTitle });
  } catch (error) {
    logger.warn('Erro ao salvar log de acesso', { error: String(error) });
  }
}

router.get('/admin/view/:id', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  try {
    // Extrai o ID da URL
    const url = new URL(request.url);
    const match = url.pathname.match(/\/admin\/view\/([^\/]+)/);
    const id = match ? match[1] : null;
    
    if (!id) {
      return new Response(JSON.stringify({ error: 'ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const value = await env.COMMUNIQUE_STORE.get(id);
    if (!value) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const communique = JSON.parse(value) as Communique;
    
    // Salva log de visualização (não bloqueia a resposta)
    ctx.waitUntil(
      saveAccessLog(env.COMMUNIQUE_STORE, 'view', id, communique.title, request)
        .catch(err => logger.warn('Erro ao salvar log', { error: String(err) }))
    );
    
    // Cria um wrapper HTML melhorado para visualização
    const baseUrl = new URL(request.url).origin;
    const viewUrl = `${baseUrl}/admin/view/${id}`;
    const wrappedHtml = renderCommuniqueHTML(communique, baseUrl, viewUrl);
    
    return new Response(wrappedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota para interceptar acessos às páginas públicas e registrar logs
router.get('/pages/:uuid', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/pages\/([^\/]+)/);
    const uuid = match ? match[1] : null;
    
    if (!uuid) {
      return new Response('Not found', { status: 404 });
    }

    // Busca comunicado pelo UUID
    const keys = await env.COMMUNIQUE_STORE.list();
    let communique: Communique | null = null;
    let communiqueId: string | null = null;

    for (const key of keys.keys) {
      if (key.name.startsWith('access_log:')) continue;
      const value = await env.COMMUNIQUE_STORE.get(key.name);
      if (value) {
        try {
          const item = JSON.parse(value) as Communique;
          if (item.uuid === uuid) {
            communique = item;
            communiqueId = key.name;
            break;
          }
        } catch (e) {
          // Ignora itens inválidos
        }
      }
    }

    if (!communique || !communiqueId) {
      return new Response('Comunicado não encontrado', { status: 404 });
    }

    // Salva log de cópia (não bloqueia a resposta)
    ctx.waitUntil(
      saveAccessLog(env.COMMUNIQUE_STORE, 'copy', communiqueId, communique.title, request)
        .catch(err => logger.warn('Erro ao salvar log de cópia', { error: String(err) }))
    );

    // Retorna o HTML do comunicado
    const baseUrl = new URL(request.url).origin;
    const viewUrl = `${baseUrl}/admin/view/${communiqueId}`;
    const wrappedHtml = renderCommuniqueHTML(communique, baseUrl, viewUrl);
    
    return new Response(wrappedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (error) {
    logger.error('Erro ao servir página pública', { error: String(error) });
    return new Response('Erro interno', { status: 500 });
  }
});

// Rota para servir o frontend
router.get('/', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    const url = new URL(request.url);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const baseUrl = url.origin;
    
    // Em produção (workers.dev), redireciona para GitHub Pages
    if (!isLocalhost && url.hostname.includes('.workers.dev')) {
      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ComShalom - Comunicados de Discernimentos</title>
    <meta http-equiv="refresh" content="0; url=https://go.tomina.ga/">
</head>
<body>
    <p>Redirecionando para <a href="https://go.tomina.ga/">https://go.tomina.ga/</a></p>
</body>
</html>`;
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    }
    
    // Em desenvolvimento local, serve o frontend inline
    // O Wrangler em modo dev pode servir arquivos estáticos, mas vamos servir inline
    // para garantir que funcione
    const frontendHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comunicados de Discernimentos - ComShalom</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f7;
            color: #1d1d1f;
            line-height: 1.6;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        header {
            background: white;
            border-radius: 12px;
            padding: 40px;
            margin-bottom: 30px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
        }

        h1 {
            font-size: 2.2em;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }

        .subtitle {
            color: #86868b;
            font-size: 1em;
            margin-bottom: 24px;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-top: 24px;
        }

        .stat-card {
            background: #f5f5f7;
            padding: 20px;
            border-radius: 10px;
            border: 1px solid #e5e5e7;
        }

        .stat-value {
            font-size: 2em;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 4px;
        }

        .stat-label {
            font-size: 0.85em;
            color: #86868b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .loading, .error {
            background: white;
            border-radius: 12px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
        }

        .error {
            background: #fff5f5;
            border-color: #ffcccc;
            color: #c33;
        }

        .communiques-list {
            display: grid;
            gap: 16px;
        }

        .communique-card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
            transition: all 0.2s ease;
        }

        .communique-card:hover {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            transform: translateY(-2px);
        }

        .communique-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 16px;
            gap: 16px;
            flex-wrap: wrap;
        }

        .communique-title {
            font-size: 1.15em;
            font-weight: 500;
            color: #1d1d1f;
            flex: 1;
            min-width: 200px;
            line-height: 1.4;
        }

        .communique-date {
            color: #86868b;
            font-size: 0.9em;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }

        .communique-url {
            color: #0071e3;
            text-decoration: none;
            font-size: 0.9em;
            word-break: break-all;
            display: block;
            margin-bottom: 16px;
        }

        .communique-url:hover {
            text-decoration: underline;
        }

        .communique-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9em;
            font-weight: 500;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid transparent;
        }

        .btn-primary {
            background: #1d1d1f;
            color: white;
            border-color: #1d1d1f;
        }

        .btn-primary:hover {
            background: #424245;
            border-color: #424245;
        }

        .btn-secondary {
            background: white;
            color: #1d1d1f;
            border-color: #d2d2d7;
        }

        .btn-secondary:hover {
            background: #f5f5f7;
            border-color: #86868b;
        }

        .empty-state {
            text-align: center;
            padding: 80px 20px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e5e7;
        }

        .empty-state h2 {
            font-size: 1.5em;
            font-weight: 600;
            color: #1d1d1f;
            margin-bottom: 12px;
        }

        .empty-state p {
            color: #86868b;
            font-size: 1em;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Comunicados de Discernimentos</h1>
            <p class="subtitle">Comunidade Católica Shalom</p>
            <div class="stats" id="stats">
                <div class="stat-card">
                    <div class="stat-value" id="total-count">-</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="last-update">-</div>
                    <div class="stat-label">Última Atualização</div>
                </div>
            </div>
        </header>

        <div id="loading" class="loading">
            <p>Carregando comunicados...</p>
        </div>

        <div id="error" class="error" style="display: none;"></div>

        <div id="communiques-list" class="communiques-list" style="display: none;"></div>

        <div id="empty-state" class="empty-state" style="display: none;">
            <h2>Nenhum comunicado encontrado</h2>
            <p>Os comunicados aparecerão aqui quando forem detectados pelo sistema.</p>
        </div>
    </div>

    <script>
        const WORKER_URL = "${baseUrl}";
        const ADMIN_KEY = 'Shalom1982!!';

        console.log('Worker URL:', WORKER_URL);

        async function loadCommuniques() {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const list = document.getElementById('communiques-list');
            const emptyState = document.getElementById('empty-state');

            try {
                loading.style.display = 'block';
                error.style.display = 'none';
                list.style.display = 'none';
                emptyState.style.display = 'none';

                const response = await fetch(\`\${WORKER_URL}/admin/list\`, {
                    headers: {
                        'X-ADMIN-KEY': ADMIN_KEY
                    }
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error('Não autorizado. Verifique a chave de administração.');
                    }
                    throw new Error(\`Erro \${response.status}: \${response.statusText}\`);
                }

                const data = await response.json();

                loading.style.display = 'none';

                if (data.count === 0) {
                    emptyState.style.display = 'block';
                    updateStats(0, null);
                    return;
                }

                updateStats(data.count, data.items[0]?.timestamp);
                renderCommuniques(data.items);
                list.style.display = 'grid';

            } catch (err) {
                loading.style.display = 'none';
                error.style.display = 'block';
                error.innerHTML = \`
                    <p><strong>Erro ao carregar comunicados</strong></p>
                    <p>\${err.message}</p>
                    <p style="margin-top: 12px; font-size: 0.9em; color: #86868b;">
                        Verifique se o Worker está rodando em: <code>\${WORKER_URL}</code>
                    </p>
                \`;
                // Erro já tratado no catch acima
            }
        }

        function updateStats(count, lastTimestamp) {
            document.getElementById('total-count').textContent = count;

            if (lastTimestamp) {
                const date = new Date(lastTimestamp);
                const now = new Date();
                const diff = Math.floor((now - date) / (1000 * 60)); // minutos

                let timeAgo;
                if (diff < 60) {
                    timeAgo = \`\${diff} min\`;
                } else if (diff < 1440) {
                    timeAgo = \`\${Math.floor(diff / 60)} h\`;
                } else {
                    timeAgo = \`\${Math.floor(diff / 1440)} dias\`;
                }

                document.getElementById('last-update').textContent = timeAgo;
            } else {
                document.getElementById('last-update').textContent = '-';
            }
        }

        function renderCommuniques(items) {
            const list = document.getElementById('communiques-list');
            list.innerHTML = '';

            items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'communique-card';

                const date = new Date(item.timestamp);
                const formattedDate = date.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // SEMPRE prioriza página interna (publicUrl ou githubUrl) como link principal
                const internalUrl = item.publicUrl || item.githubUrl;
                const displayUrl = internalUrl || item.url || '#';
                const hasInternalCopy = !!(item.publicUrl || item.githubUrl);

                card.innerHTML = \`
                    <div class="communique-header">
                        <div class="communique-title">\${escapeHtml(item.title)}</div>
                        <div class="communique-date">\${formattedDate}</div>
                    </div>
                    \${hasInternalCopy ? \`
                        <a href="\${displayUrl}" target="_blank" rel="noopener" class="communique-url">
                            🔗 Página Interna: \${displayUrl}
                        </a>
                    \` : \`
                        <div class="communique-url" style="color: #86868b; cursor: default;">
                            ⚠️ Página ainda não copiada
                        </div>
                    \`}
                    <div class="communique-actions">
                        \${item.publicUrl ? \`
                            <a href="\${item.publicUrl}" target="_blank" rel="noopener" class="btn btn-primary">
                                Ver Página Interna
                            </a>
                        \` : item.githubUrl ? \`
                            <a href="\${item.githubUrl}" target="_blank" rel="noopener" class="btn btn-primary">
                                Ver no GitHub
                            </a>
                        \` : ''}
                        \${item.url ? \`
                            <a href="\${item.url}" target="_blank" rel="noopener" class="btn btn-secondary">
                                Ver Fonte Original
                            </a>
                        \` : ''}
                    </div>
                \`;

                list.appendChild(card);
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Carregar comunicados ao carregar a página
        loadCommuniques();

        // Atualizar a cada 5 minutos
        setInterval(loadCommuniques, 5 * 60 * 1000);
    </script>
</body>
</html>`;
    
    return new Response(frontendHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (error) {
    return new Response('Erro ao carregar frontend', { status: 500 });
  }
});

// Rota para registrar subscription de push notification
router.post('/api/push/subscribe', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    const body = await request.json() as { subscription: PushSubscription };
    
    if (!validateSubscription(body.subscription)) {
      return createOptimizedResponse(JSON.stringify({ error: 'Invalid subscription format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Busca subscriptions existentes
    const subscriptionsKey = 'push_subscriptions';
    const existingData = await env.COMMUNIQUE_STORE.get(subscriptionsKey);
    let subscriptions: PushSubscription[] = existingData ? JSON.parse(existingData) : [];
    
    // Verifica se já existe (por endpoint)
    const exists = subscriptions.some(sub => sub.endpoint === body.subscription.endpoint);
    
    if (!exists) {
      subscriptions.push(body.subscription);
      await env.COMMUNIQUE_STORE.put(subscriptionsKey, JSON.stringify(subscriptions));
      logger.info('Push subscription registrada', { endpoint: body.subscription.endpoint.substring(0, 50) + '...' });
    }
    
    return createOptimizedResponse(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Erro ao registrar subscription', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota para remover subscription
router.post('/api/push/unsubscribe', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    const body = await request.json() as { endpoint: string };
    
    const subscriptionsKey = 'push_subscriptions';
    const existingData = await env.COMMUNIQUE_STORE.get(subscriptionsKey);
    
    if (!existingData) {
      return createOptimizedResponse(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let subscriptions: PushSubscription[] = JSON.parse(existingData);
    subscriptions = subscriptions.filter(sub => sub.endpoint !== body.endpoint);
    
    await env.COMMUNIQUE_STORE.put(subscriptionsKey, JSON.stringify(subscriptions));
    logger.info('Push subscription removida', { endpoint: body.endpoint.substring(0, 50) + '...' });
    
    return createOptimizedResponse(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Erro ao remover subscription', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota para obter VAPID public key
router.get('/api/push/vapid-key', async (request: Request, env: Env, ctx: ExecutionContext) => {
  if (!env.VAPID_PUBLIC_KEY) {
    return createOptimizedResponse(JSON.stringify({ error: 'VAPID keys not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return createOptimizedResponse(JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

// Rota para verificar se há nova notificação (polling do Service Worker)
router.get('/api/push/check', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    const lastCheck = request.headers.get('X-Last-Check');
    const lastCheckTime = lastCheck ? parseInt(lastCheck, 10) : 0;
    
    const notificationData = await env.COMMUNIQUE_STORE.get('last_notification');
    
    if (!notificationData) {
      return createOptimizedResponse(JSON.stringify({ hasNew: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const notification = JSON.parse(notificationData) as { id: string; title: string; url: string; timestamp: number };
    
    if (notification.timestamp > lastCheckTime) {
      return createOptimizedResponse(JSON.stringify({
        hasNew: true,
        notification: {
          title: 'Novo Comunicado Detectado',
          body: notification.title,
          url: notification.url,
          icon: '/icon-192x192.png',
          timestamp: notification.timestamp
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return createOptimizedResponse(JSON.stringify({ hasNew: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Erro ao verificar notificações', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ hasNew: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Verifica se uma página existe no GitHub
async function checkPageExists(env: Env, uuid: string): Promise<boolean> {
  try {
    const defaultBranch = await getDefaultBranch(env);
    const path = `pages/${uuid}.html`;
    const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/${path}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'Authorization': env.GITHUB_TOKEN.startsWith('github_pat_')
          ? `Bearer ${env.GITHUB_TOKEN}` 
          : `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare-Worker'
      }
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// Rota admin: recriar todas as páginas do zero
router.get('/admin/recreate-all', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  try {
    const keys = await env.COMMUNIQUE_STORE.list();
    const items: Communique[] = [];
    
    // Busca todos os valores em paralelo
    const values = await Promise.all(
      keys.keys.map(key => env.COMMUNIQUE_STORE.get(key.name))
    );
    
    for (const value of values) {
      if (value) {
        try {
          const item = JSON.parse(value) as Communique;
          // Processa todos os itens que têm HTML
          if (item.html && item.html.length > 0) {
            // Garante que tem UUID
            if (!item.uuid) {
              item.uuid = crypto.randomUUID();
            }
            items.push(item);
          }
        } catch (e) {
          logger.warn('Erro ao parsear item', { error: String(e) });
        }
      }
    }

    if (items.length === 0) {
      return createOptimizedResponse(JSON.stringify({
        message: 'Nenhum item encontrado para recriar',
        count: 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    logger.info('Iniciando recriação de todas as páginas', { count: items.length });

    // Processa em background
    ctx.waitUntil(
      (async () => {
        const results = await Promise.allSettled(
          items.map(async (item) => {
            try {
              logger.info('Recriando página', { id: item.id, uuid: item.uuid, title: item.title });
              
              // Faz commit no GitHub (sempre recria, mesmo se já existir)
              const githubResult = await commitToGitHub(env, item.id, item.uuid, item.title, item.html, 2, item);
              
              // Atualiza o item com informações do GitHub
              item.githubSha = githubResult.sha;
              item.githubUrl = githubResult.githubUrl;
              item.publicUrl = githubResult.url;
              
              // Atualiza no KV
              await env.COMMUNIQUE_STORE.put(item.id, JSON.stringify(item));
              
              logger.info('Página recriada com sucesso', { id: item.id, publicUrl: item.publicUrl });
              return { success: true, id: item.id, publicUrl: item.publicUrl };
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              logger.error('Erro ao recriar página', { id: item.id, error: errorMsg });
              return { success: false, id: item.id, error: errorMsg };
            }
          })
        );

        const successful = results.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
        const failed = results.length - successful;
        logger.info('Recriação concluída', { successful, failed, total: results.length });
      })()
    );

    return createOptimizedResponse(JSON.stringify({
      message: 'Recriação de páginas iniciada em background',
      count: items.length,
      status: 'processing'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Erro ao iniciar recriação', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota admin: reprocessar itens sem cópia no GitHub
router.get('/admin/reprocess', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  try {
    const keys = await env.COMMUNIQUE_STORE.list();
    const items: Communique[] = [];
    
    // Busca todos os valores em paralelo
    const values = await Promise.all(
      keys.keys.map(key => env.COMMUNIQUE_STORE.get(key.name))
    );
    
    for (const value of values) {
      if (value) {
        try {
          const item = JSON.parse(value) as Communique;
          // Filtra itens que precisam ser reprocessados:
          // 1. Não têm publicUrl ou githubUrl
          // 2. Não têm UUID (para adicionar UUID aos itens antigos)
          if (item.html && (!item.publicUrl && !item.githubUrl || !item.uuid)) {
            // Se não tiver UUID, gera um novo
            if (!item.uuid) {
              item.uuid = crypto.randomUUID();
            }
            items.push(item);
          }
        } catch (e) {
          logger.warn('Erro ao parsear item', { error: String(e) });
        }
      }
    }

    if (items.length === 0) {
      return createOptimizedResponse(JSON.stringify({
        message: 'Nenhum item precisa ser reprocessado',
        count: 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    logger.info('Iniciando reprocessamento', { count: items.length });

    // Processa sincronamente para garantir que seja concluído
    const results = await Promise.allSettled(
      items.map(async (item) => {
        try {
          logger.info('Reprocessando item', { id: item.id, title: item.title, hasHtml: !!item.html });
          
          // Verifica se tem HTML
          if (!item.html || item.html.length === 0) {
            logger.warn('Item sem HTML, pulando', { id: item.id });
            return { success: false, id: item.id, error: 'No HTML content' };
          }

          // Faz commit no GitHub usando o HTML já salvo (passa o item completo para gerar HTML com wrapper)
          const githubResult = await commitToGitHub(env, item.id, item.uuid, item.title, item.html, 2, item);
          
          // Atualiza o item com informações do GitHub
          item.githubSha = githubResult.sha;
          item.githubUrl = githubResult.githubUrl;
          item.publicUrl = githubResult.url;
          
          // Atualiza no KV
          await env.COMMUNIQUE_STORE.put(item.id, JSON.stringify(item));
          
          logger.info('Item reprocessado com sucesso', { id: item.id, title: item.title, publicUrl: item.publicUrl });
          return { success: true, id: item.id, publicUrl: item.publicUrl };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error('Erro ao reprocessar item', { id: item.id, error: errorMsg });
          return { success: false, id: item.id, error: errorMsg };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
    const failed = results.length - successful;
    const errors = results
      .filter(r => r.status === 'fulfilled' && r.value && !r.value.success)
      .map(r => (r as PromiseFulfilledResult<any>).value);

    logger.info('Reprocessamento concluído', { successful, failed, total: results.length });

    return createOptimizedResponse(JSON.stringify({
      message: `Reprocessamento concluído`,
      count: items.length,
      successful,
      failed,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Erro ao reprocessar itens', { error: String(error) });
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota de health check
router.get('/health', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    // Verifica se o KV está acessível
    await env.COMMUNIQUE_STORE.list({ limit: 1 });
    
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      kv: 'connected',
      github: env.GITHUB_TOKEN ? 'configured' : 'not_configured'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      error: String(error),
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota admin: painel principal com logs
router.get('/admin', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  try {
    // Busca logs de acesso
    const logKeys = await env.COMMUNIQUE_STORE.list({ prefix: 'access_log:' });
    const logs: Array<{
      type: string;
      communiqueId: string;
      communiqueTitle: string;
      timestamp: string;
      ip: string;
      userAgent: string;
      referer: string;
    }> = [];

    for (const key of logKeys.keys.slice(-100)) { // Últimos 100 logs
      const value = await env.COMMUNIQUE_STORE.get(key.name);
      if (value) {
        try {
          logs.push(JSON.parse(value));
        } catch (e) {
          // Ignora logs inválidos
        }
      }
    }

    // Ordena por timestamp (mais recentes primeiro)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Busca lista de comunicados para estatísticas
    const communiqueKeys = await env.COMMUNIQUE_STORE.list();
    const communiques: Communique[] = [];
    for (const key of communiqueKeys.keys) {
      const value = await env.COMMUNIQUE_STORE.get(key.name);
      if (value && !key.name.startsWith('access_log:')) {
        try {
          communiques.push(JSON.parse(value) as Communique);
        } catch (e) {
          // Ignora itens inválidos
        }
      }
    }

    const stats = {
      total: communiques.length,
      withGitHub: communiques.filter(item => item.githubSha).length,
      withPublicUrl: communiques.filter(item => item.publicUrl).length,
      totalViews: logs.filter(l => l.type === 'view').length,
      totalCopies: logs.filter(l => l.type === 'copy').length,
      lastProcessed: communiques.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0]?.timestamp || null
    };

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - ComShalom Monitor</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f7;
            color: #1d1d1f;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { margin-bottom: 30px; color: #1d1d1f; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .stat-value {
            font-size: 2em;
            font-weight: 600;
            color: #0071e3;
            margin-bottom: 5px;
        }
        .stat-label {
            color: #86868b;
            font-size: 0.9em;
        }
        .logs-section {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 20px;
            margin-top: 20px;
        }
        .logs-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .logs-table th,
        .logs-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e5e7;
        }
        .logs-table th {
            background: #f5f5f7;
            font-weight: 600;
            color: #1d1d1f;
        }
        .logs-table tr:hover {
            background: #f9f9f9;
        }
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: 500;
        }
        .badge-view {
            background: #e3f2fd;
            color: #1976d2;
        }
        .badge-copy {
            background: #f3e5f5;
            color: #7b1fa2;
        }
        .timestamp {
            color: #86868b;
            font-size: 0.9em;
        }
        .ip {
            font-family: monospace;
            font-size: 0.9em;
        }
        .no-logs {
            text-align: center;
            padding: 40px;
            color: #86868b;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Painel Administrativo</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${stats.total}</div>
                <div class="stat-label">Total de Comunicados</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.withGitHub}</div>
                <div class="stat-label">Com GitHub</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.withPublicUrl}</div>
                <div class="stat-label">Com URL Pública</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalViews}</div>
                <div class="stat-label">Visualizações</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalCopies}</div>
                <div class="stat-label">Cópias</div>
            </div>
        </div>

        <div class="logs-section">
            <h2>📋 Logs de Acesso (Últimos 100)</h2>
            ${logs.length === 0 ? '<div class="no-logs">Nenhum log encontrado</div>' : `
            <table class="logs-table">
                <thead>
                    <tr>
                        <th>Tipo</th>
                        <th>Comunicado</th>
                        <th>Data/Hora</th>
                        <th>IP</th>
                        <th>Referer</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => `
                    <tr>
                        <td>
                            <span class="badge badge-${log.type}">${log.type === 'view' ? '👁️ Visualização' : '📋 Cópia'}</span>
                        </td>
                        <td>
                            <strong>${escapeHtml(log.communiqueTitle)}</strong><br>
                            <small style="color: #86868b;">ID: ${log.communiqueId}</small>
                        </td>
                        <td class="timestamp">${new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                        <td class="ip">${log.ip}</td>
                        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.referer)}">
                            ${log.referer === 'direct' ? '<em>Direto</em>' : escapeHtml(log.referer)}
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            `}
        </div>

        <div style="margin-top: 30px; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <h3>🔗 Links Úteis</h3>
            <ul style="list-style: none; margin-top: 10px;">
                <li style="margin: 8px 0;"><a href="/admin/list" style="color: #0071e3; text-decoration: none;">📋 Listar Comunicados</a></li>
                <li style="margin: 8px 0;"><a href="/admin/stats" style="color: #0071e3; text-decoration: none;">📊 Estatísticas (JSON)</a></li>
                <li style="margin: 8px 0;"><a href="/admin/reprocess" style="color: #0071e3; text-decoration: none;">🔄 Reprocessar Itens</a></li>
            </ul>
        </div>
    </div>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota admin: estatísticas
router.get('/admin/stats', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = requireAdmin(env)(request);
  if (authCheck) return authCheck;

  try {
    const keys = await env.COMMUNIQUE_STORE.list();
    const items: Communique[] = [];

    for (const key of keys.keys) {
      const value = await env.COMMUNIQUE_STORE.get(key.name);
      if (value) {
        items.push(JSON.parse(value) as Communique);
      }
    }

    // Calcula estatísticas
    const total = items.length;
    const withGitHub = items.filter(item => item.githubSha).length;
    const withPublicUrl = items.filter(item => item.publicUrl).length;
    
    // Ordena por timestamp para pegar o mais recente
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const lastProcessed = items[0]?.timestamp || null;

    return new Response(JSON.stringify({
      total,
      withGitHub,
      withPublicUrl,
      lastProcessed,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota de teste manual (útil para desenvolvimento)
router.get('/test', async (request: Request, env: Env, ctx: ExecutionContext) => {
  try {
    // Usa waitUntil para processar em background e retornar resposta imediata
    let stats: { processed: number; saved: number; errors: number } | null = null;
    let error: string | null = null;
    
    const processPromise = processRSSFeed(env)
      .then(result => { stats = result; })
      .catch(err => { error = String(err); });
    
    // Se for requisição HTTP, processa em background
    if (ctx) {
      ctx.waitUntil(processPromise);
      return createOptimizedResponse(JSON.stringify({ 
        success: true, 
        message: 'Processamento iniciado em background',
        status: 'processing'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Se for cron, aguarda conclusão
    await processPromise;
    
    if (error) {
      return createOptimizedResponse(JSON.stringify({ error }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return createOptimizedResponse(JSON.stringify({ 
      success: true, 
      message: 'RSS processado com sucesso',
      stats
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return createOptimizedResponse(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Handler principal
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Trata requisições OPTIONS (preflight)
    if (request.method === 'OPTIONS') {
      return addCorsHeaders(
        new Response(null, { status: 204 }),
        request.headers.get('Origin')
      );
    }
    
    const origin = request.headers.get('Origin');
    
    return router.handle(request, env, ctx).then(response => {
      if (response) {
        return addCorsHeaders(response, origin);
      }
      return addCorsHeaders(new Response('Not Found', { status: 404 }), origin);
    });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processRSSFeed(env));
  }
};

