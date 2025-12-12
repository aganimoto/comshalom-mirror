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
                <span>📅 ${communique.timestamp ? (() => {
                    try {
                        const date = new Date(communique.timestamp);
                        return isNaN(date.getTime()) ? 'Data inválida' : date.toLocaleString('pt-BR');
                    } catch {
                        return 'Data inválida';
                    }
                })() : 'Data não disponível'}</span>
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

// Funções auxiliares para email
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function extractTextPreview(html: string, maxWords: number = 50): string {
  // Remove tags HTML e extrai texto
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

function formatDate(timestamp: string | undefined | null): string {
  if (!timestamp) return 'Data não disponível';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Data inválida';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Data inválida';
  }
}

function generateEmailHTML(communique: Communique, githubUrl: string): string {
  const safeTitle = escapeHtml(communique.title);
  const safeUrl = escapeHtml(communique.url);
  const safeGithubUrl = escapeHtml(githubUrl);
  const preview = extractTextPreview(communique.html, 50);
  const formattedDate = formatDate(communique.timestamp);
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Novo Comunicado: ${safeTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f7;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f7;">
        <tr>
            <td style="padding: 20px 0;">
                <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 30px 30px 20px; background: linear-gradient(135deg, #0071e3 0%, #5ac8fa 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; line-height: 1.3;">
                                📄 Novo Comunicado Detectado
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1d1d1f; font-size: 20px; font-weight: 600; line-height: 1.4;">
                                ${safeTitle}
                            </h2>
                            
                            <!-- Preview -->
                            <div style="background-color: #f9f9f9; border-left: 4px solid #0071e3; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                <p style="margin: 0; color: #86868b; font-size: 14px; line-height: 1.6;">
                                    ${escapeHtml(preview)}
                                </p>
                            </div>
                            
                            <!-- Info Cards -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                <tr>
                                    <td style="padding: 12px; background-color: #f9f9f9; border-radius: 6px; margin-bottom: 8px;">
                                        <strong style="color: #1d1d1f; font-size: 13px; display: block; margin-bottom: 4px;">📅 Data</strong>
                                        <span style="color: #86868b; font-size: 14px;">${formattedDate}</span>
                                    </td>
                                </tr>
                                ${communique.githubSha ? `
                                <tr>
                                    <td style="padding: 12px; background-color: #f9f9f9; border-radius: 6px; margin-top: 8px;">
                                        <strong style="color: #1d1d1f; font-size: 13px; display: block; margin-bottom: 4px;">🔗 Commit SHA</strong>
                                        <span style="color: #86868b; font-size: 12px; font-family: monospace;">${escapeHtml(communique.githubSha.substring(0, 7))}</span>
                                    </td>
                                </tr>
                                ` : ''}
                            </table>
                            
                            <!-- Action Buttons -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                                <tr>
                                    <td style="padding: 0;">
                                        <a href="${safeGithubUrl}" style="display: inline-block; padding: 14px 28px; background-color: #0071e3; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; text-align: center; margin-bottom: 10px; width: 100%; box-sizing: border-box;">
                                            🔗 Ver Página Completa
                                        </a>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 0;">
                                        <a href="${safeUrl}" style="display: inline-block; padding: 12px 28px; background-color: #f5f5f7; color: #0071e3; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; text-align: center; width: 100%; box-sizing: border-box; border: 1px solid #e5e5e7;">
                                            🌐 Fonte Original
                                        </a>
                                    </td>
                                </tr>
                                ${communique.githubUrl && communique.githubUrl !== githubUrl ? `
                                <tr>
                                    <td style="padding: 8px 0 0;">
                                        <a href="${escapeHtml(communique.githubUrl)}" style="display: inline-block; padding: 10px 20px; color: #86868b; text-decoration: none; font-size: 13px; text-align: center; width: 100%; box-sizing: border-box;">
                                            📦 Ver no GitHub
                                        </a>
                                    </td>
                                </tr>
                                ` : ''}
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 20px 30px; background-color: #f9f9f9; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e5e7;">
                            <p style="margin: 0; color: #86868b; font-size: 12px; text-align: center; line-height: 1.5;">
                                Este é um email automático do sistema de monitoramento RSS do ComShalom.<br>
                                <a href="${safeGithubUrl}" style="color: #0071e3; text-decoration: none;">Ver comunicado completo</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function generateEmailText(communique: Communique, githubUrl: string): string {
  const formattedDate = formatDate(communique.timestamp);
  const preview = extractTextPreview(communique.html, 50);
  
  return `NOVO COMUNICADO DETECTADO

Título: ${communique.title}

Preview:
${preview}

Data: ${formattedDate}
${communique.githubSha ? `Commit SHA: ${communique.githubSha.substring(0, 7)}\n` : ''}

Links:
- Página Completa: ${githubUrl}
- Fonte Original: ${communique.url}
${communique.githubUrl && communique.githubUrl !== githubUrl ? `- GitHub: ${communique.githubUrl}\n` : ''}

---
Este é um email automático do sistema de monitoramento RSS do ComShalom.`;
}

// Envia email via Resend API
async function sendEmailViaResend(
  env: Env,
  communique: Communique,
  githubUrl: string,
  recipients: string[],
  subject: string,
  htmlContent: string,
  textContent: string,
  retries = 2
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY não configurado');
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const emailContent: any = {
        from: env.EMAIL_FROM,
        to: recipients,
        subject: subject,
        html: htmlContent,
        text: textContent,
        headers: {
          'X-ComShalom-Id': communique.id,
          'X-ComShalom-Type': 'new-communique',
          'List-Unsubscribe': `<${githubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };

      // Adiciona reply-to se configurado
      if (env.EMAIL_REPLY_TO && isValidEmail(env.EMAIL_REPLY_TO)) {
        emailContent.reply_to = env.EMAIL_REPLY_TO;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://api.resend.com/emails', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.RESEND_API_KEY}`
        },
        body: JSON.stringify(emailContent)
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Resend error: ${response.status}`;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = `Resend error: ${errorJson.message || errorText}`;
        } catch {
          errorMessage = `Resend error: ${response.status} - ${errorText.substring(0, 200)}`;
        }
        
        throw new Error(errorMessage);
      }
      
      const result = await response.json() as { id?: string };
      logger.info('Email enviado com sucesso via Resend', { 
        id: communique.id,
        emailId: result.id || 'unknown',
        recipients: recipients.length,
        subject: subject
      });
      
    return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

// Envia email via Mailchannels API
async function sendEmailViaMailchannels(
  env: Env,
  communique: Communique,
  githubUrl: string,
  recipients: string[],
  subject: string,
  htmlContent: string,
  textContent: string,
  retries = 2
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const emailContent: any = {
        personalizations: [{
          to: recipients.map(email => ({ email }))
        }],
        from: {
          email: env.EMAIL_FROM,
          name: 'ComShalom RSS Monitor'
        },
        subject: subject,
        content: [
          {
            type: 'text/plain',
            value: textContent
          },
          {
          type: 'text/html',
            value: htmlContent
          }
        ],
        headers: {
          'X-ComShalom-Id': communique.id,
          'X-ComShalom-Type': 'new-communique',
          'List-Unsubscribe': `<${githubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };

      if (env.EMAIL_REPLY_TO && isValidEmail(env.EMAIL_REPLY_TO)) {
        emailContent.reply_to = {
          email: env.EMAIL_REPLY_TO
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
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
        const errorText = await response.text();
        let errorMessage = `Mailchannels error: ${response.status}`;
        
        if (response.status === 401) {
          const emailFromDomain = env.EMAIL_FROM ? env.EMAIL_FROM.split('@')[1] : 'não configurado';
          errorMessage = `Erro de autenticação (401): O Mailchannels requer configuração DNS (SPF). EMAIL_FROM atual: ${env.EMAIL_FROM || 'não configurado'}. Verifique se o domínio "${emailFromDomain}" tem SPF configurado (v=spf1 include:relay.mailchannels.net ~all) no DNS. Detalhes: ${errorText.substring(0, 200)}`;
        } else if (response.status === 403) {
          errorMessage = `Erro de permissão (403): O domínio não está autorizado. Verifique a configuração SPF/DKIM. Detalhes: ${errorText.substring(0, 200)}`;
        } else if (response.status === 400) {
          errorMessage = `Erro de validação (400): Verifique os dados do email. Detalhes: ${errorText.substring(0, 200)}`;
        } else {
          errorMessage = `Mailchannels error: ${response.status} - ${errorText.substring(0, 200)}`;
        }
        
        throw new Error(errorMessage);
      }
      
      logger.info('Email enviado com sucesso via Mailchannels', { 
        id: communique.id,
        recipients: recipients.length,
        subject: subject
      });
      
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

// Envia email com suporte a múltiplos provedores
async function sendEmail(
  env: Env,
  communique: Communique,
  githubUrl: string,
  retries = 2
): Promise<void> {
  // Verifica se email está habilitado
  if (env.EMAIL_ENABLED === 'false') {
    logger.debug('Email desabilitado via EMAIL_ENABLED=false');
    return;
  }

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

  // Trunca assunto para evitar problemas
  const subject = `Novo Comunicado: ${truncateText(communique.title, 50)}`;

  // Determina qual provedor usar
  const provider = (env.EMAIL_PROVIDER || 'mailchannels').toLowerCase();
  
  // Log do domínio usado para debug
  const emailFromDomain = env.EMAIL_FROM.split('@')[1];
  logger.info('Preparando envio de email', {
    emailFrom: env.EMAIL_FROM,
    emailFromDomain: emailFromDomain,
    recipients: recipients.length,
    subject: subject,
    provider: provider
  });

  // Gera conteúdo HTML e texto
  const htmlContent = generateEmailHTML(communique, githubUrl);
  const textContent = generateEmailText(communique, githubUrl);

  try {
    if (provider === 'resend') {
      await sendEmailViaResend(env, communique, githubUrl, recipients, subject, htmlContent, textContent, retries);
    } else {
      await sendEmailViaMailchannels(env, communique, githubUrl, recipients, subject, htmlContent, textContent, retries);
    }
    
    logger.info('Email enviado com sucesso', { 
      id: communique.id, 
      title: communique.title,
      recipients: recipients.length,
      subject: subject,
      provider: provider
    });
  } catch (error) {
    logger.error('Erro ao enviar email', { 
      error: String(error),
      id: communique.id,
      title: communique.title,
      provider: provider
    });
    throw error;
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

    // Envia email (não crítico - não deve quebrar o processamento)
    try {
    await sendEmail(env, communique, githubResult.url);
    } catch (error) {
      logger.error('Falha ao enviar email, mas processamento continua', { 
        id, 
        title: item.title,
        error: String(error)
      });
      // Continua o processamento mesmo se email falhar
    }
    
    // Envia notificações push (não crítico)
    try {
    await sendPushNotifications(env, communique, githubResult.url);
    } catch (error) {
      logger.error('Falha ao enviar notificação push, mas processamento continua', { 
        id, 
        title: item.title,
        error: String(error)
      });
      // Continua o processamento mesmo se push falhar
    }
    
    logger.info('Comunicado processado com sucesso', { id, title: item.title });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Erro ao processar item', { title: item.title, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

// Verifica se o conteúdo de uma URL é válido (não é página de erro)
// Validação mais robusta e permissiva para evitar falsos negativos
async function isValidContent(html: string, url?: string): Promise<{ valid: boolean; reason?: string; details?: any }> {
  const result: { valid: boolean; reason?: string; details?: any } = {
    valid: false,
    details: {}
  };
  
  if (!html || html.trim().length === 0) {
    result.reason = 'HTML vazio ou nulo';
    logger.warn('isValidContent: HTML vazio ou nulo', { url });
    return result;
  }
  
  const lowerHtml = html.toLowerCase();
  
  // Extrai texto do HTML (remove tags e normaliza espaços)
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove estilos
    .replace(/<[^>]*>/g, ' ') // Remove tags HTML
    .replace(/\s+/g, ' ') // Normaliza espaços
    .trim();
  
  const textLength = textContent.length;
  result.details = { htmlLength: html.length, textLength };
  
  logger.info('isValidContent: Verificando conteúdo', { 
    url,
    htmlLength: html.length, 
    textLength,
    preview: textContent.substring(0, 150) 
  });
  
  // CRITÉRIO 1: Tamanho mínimo muito reduzido (50 caracteres)
  // Se tem menos de 50 caracteres, provavelmente é vazio
  if (textLength < 50) {
    result.reason = `Conteúdo muito curto (${textLength} caracteres)`;
    logger.warn('isValidContent: Conteúdo muito curto', { textLength, url });
    return result;
  }
  
  // CRITÉRIO 2: Verifica se é claramente uma página de erro
  // Só rejeita se for OBVIAMENTE uma página de erro (título ou heading principal)
  const strongErrorPatterns = [
    /<title[^>]*>\s*(?:página\s+não\s+foi\s+encontrada|página\s+não\s+encontrada|page\s+not\s+found|404|erro\s+404)\s*<\/title>/i,
    /<h1[^>]*>\s*(?:página\s+não\s+foi\s+encontrada|página\s+não\s+encontrada|page\s+not\s+found|404|erro\s+404)\s*<\/h1>/i
  ];
  
  let isStrongError = false;
  for (const pattern of strongErrorPatterns) {
    if (pattern.test(html)) {
      // Se o título/heading principal é de erro E o conteúdo é muito curto, rejeita
      if (textLength < 200) {
        result.reason = 'Página de erro detectada no título/heading principal';
        logger.warn('isValidContent: Página de erro detectada', { textLength, url });
        return result;
      }
      isStrongError = true;
      break;
    }
  }
  
  // CRITÉRIO 3: Verifica elementos de conteúdo HTML
  const contentElements = {
    hasHeadings: /<h[1-6][^>]*>/i.test(html),
    hasParagraphs: /<p[^>]*>/i.test(html),
    hasArticles: /<article[^>]*>/i.test(html),
    hasSections: /<section[^>]*>/i.test(html),
    hasMain: /<main[^>]*>/i.test(html),
    hasContentDiv: /<div[^>]*class[^>]*content|<div[^>]*id[^>]*content/i.test(html),
    hasLists: /<[uo]l[^>]*>|<li[^>]*>/i.test(html)
  };
  
  const hasContentElements = Object.values(contentElements).some(v => v);
  result.details.contentElements = contentElements;
  
  // CRITÉRIO 4: Verifica palavras-chave de conteúdo (muito mais amplo)
  const contentKeywords = [
    'comunicado', 'discernimento', 'comissão', 'nomeação', 'transferência', 
    'fundação', 'missão', 'comunidade', 'shalom', 'católica', 'deus',
    'missionário', 'responsável', 'local', 'diaconia', 'assistência',
    'formação', 'apostólica', 'comunitária', 'regional', 'secretaria'
  ];
  
  const foundKeywords = contentKeywords.filter(keyword => lowerHtml.includes(keyword));
  const hasContentKeywords = foundKeywords.length > 0;
  result.details.keywords = { found: foundKeywords, count: foundKeywords.length };
  
  // DECISÃO: Aceita se atender QUALQUER um dos critérios abaixo
  
  // 1. Tem palavras-chave de conteúdo → ACEITA (mesmo que pequeno)
  if (hasContentKeywords) {
    result.valid = true;
    result.reason = `Palavras-chave de conteúdo encontradas (${foundKeywords.length}): ${foundKeywords.slice(0, 3).join(', ')}`;
    logger.info('isValidContent: ACEITO por palavras-chave', { 
      textLength,
      keywords: foundKeywords.slice(0, 5),
      url 
    });
    return result;
  }
  
  // 2. Tem mais de 200 caracteres E elementos HTML → ACEITA
  if (textLength >= 200 && hasContentElements) {
    result.valid = true;
    result.reason = `Conteúdo suficiente (${textLength} chars) com elementos HTML`;
    logger.info('isValidContent: ACEITO por tamanho e elementos', { 
      textLength,
      contentElements,
      url 
    });
    return result;
  }
  
  // 3. Tem mais de 500 caracteres → ACEITA (mesmo sem elementos específicos)
  if (textLength >= 500) {
    result.valid = true;
    result.reason = `Conteúdo extenso (${textLength} caracteres)`;
    logger.info('isValidContent: ACEITO por tamanho extenso', { textLength, url });
    return result;
  }
  
  // 4. Tem mais de 150 caracteres E não é erro forte → ACEITA (mais permissivo)
  if (textLength >= 150 && !isStrongError) {
    result.valid = true;
    result.reason = `Conteúdo moderado (${textLength} caracteres) sem erro forte`;
    logger.info('isValidContent: ACEITO por tamanho moderado', { textLength, url });
    return result;
  }
  
  // 5. Tem elementos HTML E mais de 100 caracteres → ACEITA
  if (hasContentElements && textLength >= 100) {
    result.valid = true;
    result.reason = `Elementos HTML presentes com ${textLength} caracteres`;
    logger.info('isValidContent: ACEITO por elementos HTML', { 
      textLength,
      contentElements,
      url 
    });
    return result;
  }
  
  // REJEITA apenas se for claramente inválido
  result.reason = `Conteúdo insuficiente: ${textLength} chars, sem keywords, sem elementos HTML suficientes`;
  logger.warn('isValidContent: REJEITADO', { 
    textLength,
    hasContentElements,
    hasContentKeywords,
    isStrongError,
    details: result.details,
    url 
  });
  return result;
}

// Extrai título do HTML
function extractTitleFromHTML(html: string, defaultTitle: string): string {
  try {
    // Tenta extrair do <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      if (title && title.length > 10) {
        return title;
      }
    }
    
    // Tenta extrair do <h1>
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      const title = h1Match[1].trim();
      if (title && title.length > 10) {
        return title;
      }
    }
    
    // Tenta extrair de meta og:title
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      const title = ogTitleMatch[1].trim();
      if (title && title.length > 10) {
        return title;
      }
    }
  } catch (e) {
    logger.warn('Erro ao extrair título do HTML', { error: String(e) });
  }
  
  return defaultTitle;
}

// Verifica URL específica de comunicado
async function checkSpecificUrl(
  url: string,
  env: Env,
  config: ReturnType<typeof loadConfig>
): Promise<{ success: boolean; error?: string; isNew?: boolean }> {
  try {
    logger.info('Verificando URL específica', { url });
    
    // Gera ID único baseado na URL (mesmo formato usado em processItem)
    const urlHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(url)
    );
    const hashArray = Array.from(new Uint8Array(urlHash));
    const id = hashArray
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 32);
    
    logger.info('ID gerado para URL específica', { id, url });
    
    // Busca o HTML
    logger.info('Buscando HTML da URL específica', { url });
    const html = await fetchFullHTML(url, 2);
    logger.info('HTML obtido', { url, htmlLength: html.length });
    
    // Valida se o conteúdo é válido (com validação melhorada)
    const validationResult = await isValidContent(html, url);
    logger.info('Validação de conteúdo', { 
      url, 
      valid: validationResult.valid, 
      reason: validationResult.reason,
      details: validationResult.details,
      htmlLength: html.length 
    });
    
    if (!validationResult.valid) {
      // Se a validação falhou, tenta uma validação alternativa mais permissiva
      // para URLs específicas (elas são confiáveis)
      const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const textLength = textContent.length;
      
      logger.info('Tentando validação alternativa para URL específica', { 
        url, 
        textLength,
        htmlLength: html.length 
      });
      
      // Para URLs específicas, aceita se tiver mais de 50 caracteres
      // (são URLs confiáveis que adicionamos manualmente)
      if (textLength < 50) {
        logger.error('URL específica rejeitada: conteúdo muito curto', { 
          url, 
          textLength,
          reason: validationResult.reason,
          details: validationResult.details
        });
        return { 
          success: false, 
          error: `Conteúdo inválido: ${validationResult.reason || 'página muito curta ou vazia'}` 
        };
      }
      
      // Se passou na validação alternativa, continua
      logger.warn('URL específica aceita pela validação alternativa', { 
        url, 
        textLength,
        originalReason: validationResult.reason 
      });
    }
    
    // Extrai título do HTML
    const defaultTitle = 'Comunicado acerca dos discernimentos de dezembro de 2025';
    const extractedTitle = extractTitleFromHTML(html, defaultTitle);
    logger.info('Título extraído', { url, title: extractedTitle });
    
    // Verifica se já existe no KV usando o mesmo ID
    const existing = await env.COMMUNIQUE_STORE.get(id);
    let existingItem: Communique | null = null;
    
    if (existing) {
      try {
        existingItem = JSON.parse(existing) as Communique;
        logger.info('URL específica já existe no sistema', { 
          id, 
          url, 
          existingTitle: existingItem.title, 
          hasPublicUrl: !!existingItem.publicUrl,
          hasGithubUrl: !!existingItem.githubUrl,
          htmlLength: existingItem.html?.length || 0
        });
        
        // Se já tem publicUrl E o conteúdo é o mesmo, não precisa processar novamente
        if (existingItem.publicUrl && html === existingItem.html) {
          logger.info('URL específica já processada e conteúdo não mudou', { 
            id, 
            url, 
            publicUrl: existingItem.publicUrl 
          });
          return { success: true, isNew: false };
        }
        
        // Processa se não tem publicUrl OU se o conteúdo mudou
        const reason = !existingItem.publicUrl 
          ? 'sem publicUrl - precisa processar' 
          : 'conteúdo mudou - precisa atualizar';
        logger.info('Processando URL específica', { id, url, reason });
      } catch (e) {
        logger.warn('Erro ao parsear item existente, processando como novo', { id, error: String(e) });
        existingItem = null;
      }
    } else {
      logger.info('Processando URL específica como novo item', { id, url, title: extractedTitle });
    }
    
    // Processa o item (novo ou atualização)
    const uuid = existingItem?.uuid || crypto.randomUUID();
    const communique: Communique = {
      id,
      uuid,
      title: extractedTitle,
      url: url,
      timestamp: existingItem?.timestamp || new Date().toISOString(),
      html
    };
    
    // Commit no GitHub
    logger.info('Fazendo commit no GitHub', { id, title: extractedTitle, uuid, isNew: !existingItem });
    try {
      const commitResult = await commitToGitHub(env, id, uuid, extractedTitle, html, 2, communique);
      communique.githubSha = commitResult.sha;
      communique.githubUrl = commitResult.githubUrl;
      communique.publicUrl = commitResult.url;
      
      logger.info('Commit realizado com sucesso', { 
        id, 
        sha: commitResult.sha?.substring(0, 7), 
        publicUrl: commitResult.url 
      });
    } catch (commitError) {
      logger.error('Erro ao fazer commit no GitHub', { 
        id, 
        error: String(commitError),
        url 
      });
      throw commitError;
    }
    
    // Salva no KV
    await env.COMMUNIQUE_STORE.put(id, JSON.stringify(communique));
    logger.info('Item salvo no KV com sucesso', { 
      id, 
      title: extractedTitle, 
      publicUrl: communique.publicUrl,
      githubUrl: communique.githubUrl 
    });
    
    // Envia email apenas se for novo (não bloqueia se falhar)
    if (!existingItem) {
      try {
        logger.info('Enviando email de notificação', { id, title: extractedTitle });
        await sendEmail(env, communique, communique.publicUrl!);
        logger.info('Email enviado com sucesso', { id });
      } catch (emailError) {
        logger.error('Erro ao enviar email (não crítico)', { error: String(emailError) });
      }
    } else {
      logger.info('Email não enviado (item já existia)', { id });
    }
    
    return { success: true, isNew: !existingItem };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Erro ao verificar URL específica', { url, error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
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
    // Verifica URLs específicas primeiro
    const specificUrls = [
      'https://portal.shalom.tec.br/comunicado-acerca-dos-discernimentos-de-dezembro-de-2025',
      'https://portal.shalom.tec.br/2025-dezembro-discernimentos'
    ];
    
    for (const specificUrl of specificUrls) {
      try {
        const specificResult = await checkSpecificUrl(specificUrl, env, config);
        if (specificResult.success) {
          stats.saved++;
          logger.info('URL específica verificada com sucesso', { 
            url: specificUrl, 
            isNew: specificResult.isNew 
          });
        } else {
          stats.errors++;
          logger.warn('URL específica falhou', { 
            url: specificUrl, 
            error: specificResult.error 
          });
        }
      } catch (error) {
        stats.errors++;
        logger.error('Erro ao verificar URL específica', { 
          url: specificUrl, 
          error: String(error) 
        });
      }
    }
    
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

// Sistema de autenticação por sessão
async function generateSessionToken(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createSession(env: Env, token: string): Promise<void> {
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 dias
  await env.COMMUNIQUE_STORE.put(`session:${token}`, JSON.stringify({ expiresAt }), {
    expirationTtl: 7 * 24 * 60 * 60 // 7 dias em segundos
  });
}

async function validateSession(env: Env, token: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const sessionData = await env.COMMUNIQUE_STORE.get(`session:${token}`);
    if (!sessionData) return false;
    const session = JSON.parse(sessionData) as { expiresAt: number };
    return Date.now() < session.expiresAt;
  } catch {
    return false;
  }
}

async function deleteSession(env: Env, token: string): Promise<void> {
  await env.COMMUNIQUE_STORE.delete(`session:${token}`);
}

function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const sessionCookie = cookies.find(c => c.startsWith('admin_session='));
  if (!sessionCookie) return null;
  return sessionCookie.split('=')[1] || null;
}

// Middleware de autenticação para rotas admin
async function requireAdmin(env: Env, request: Request): Promise<Response | null> {
  // Se não tiver ADMIN_KEY configurado, permite acesso (desenvolvimento)
  if (!env.ADMIN_KEY || env.ADMIN_KEY.trim() === '') {
    logger.warn('ADMIN_KEY não configurado, permitindo acesso sem autenticação');
    return null;
  }

  // Verifica sessão primeiro
  const sessionToken = getSessionToken(request);
  if (sessionToken && await validateSession(env, sessionToken)) {
    return null; // Autenticado
  }

  // Fallback para header (compatibilidade)
    const authHeader = request.headers.get('X-ADMIN-KEY');
  if (authHeader && authHeader === env.ADMIN_KEY) {
    return null; // Autenticado via header
  }

  // Não autenticado
  logger.warn('Tentativa de acesso não autorizado', { 
    hasSession: !!sessionToken,
    hasHeader: !!authHeader
  });
  
  // Se for requisição HTML, redireciona para login
  const acceptHeader = request.headers.get('Accept') || '';
  if (acceptHeader.includes('text/html')) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/admin/login' }
    });
  }
  
  // Para API, retorna JSON
  return new Response(JSON.stringify({ 
    error: 'Unauthorized',
    message: 'Autenticação necessária. Acesse /admin/login'
  }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
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

// Rota de login
router.get('/admin/login', async (request: Request, env: Env) => {
  // Se já estiver autenticado, redireciona para o admin
  const sessionToken = getSessionToken(request);
  if (sessionToken && await validateSession(env, sessionToken)) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/admin' }
    });
  }

  const loginHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Admin ComShalom</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 400px;
            width: 100%;
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            font-size: 2em;
            color: #1d1d1f;
            margin-bottom: 8px;
        }
        .logo p {
            color: #86868b;
            font-size: 0.9em;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #1d1d1f;
            font-weight: 500;
            font-size: 0.9em;
        }
        .form-group input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e5e7;
            border-radius: 8px;
            font-size: 1em;
            transition: border-color 0.2s;
        }
        .form-group input:focus {
            outline: none;
            border-color: #0071e3;
        }
        .btn-login {
            width: 100%;
            padding: 14px;
            background: #0071e3;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        .btn-login:hover {
            background: #0051a5;
        }
        .btn-login:disabled {
            background: #86868b;
            cursor: not-allowed;
        }
        .error-message {
            background: #fff5f5;
            border: 1px solid #ffcccc;
            color: #c33;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 0.9em;
            display: none;
        }
        .error-message.show {
            display: block;
        }
        .loading {
            display: none;
            text-align: center;
            margin-top: 10px;
        }
        .loading.show {
            display: block;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>🔐 Admin</h1>
            <p>ComShalom Monitor</p>
        </div>
        <div class="error-message" id="errorMessage"></div>
        <form id="loginForm">
            <div class="form-group">
                <label for="password">Senha</label>
                <input type="password" id="password" name="password" required autofocus>
            </div>
            <button type="submit" class="btn-login" id="loginBtn">Entrar</button>
            <div class="loading" id="loading">Carregando...</div>
        </form>
    </div>
    <script>
        const form = document.getElementById('loginForm');
        const passwordInput = document.getElementById('password');
        const loginBtn = document.getElementById('loginBtn');
        const errorMessage = document.getElementById('errorMessage');
        const loading = document.getElementById('loading');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = passwordInput.value;
            if (!password) {
                showError('Por favor, insira a senha');
                return;
            }

            loginBtn.disabled = true;
            loading.classList.add('show');
            errorMessage.classList.remove('show');

            try {
                const response = await fetch('/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    window.location.href = '/admin';
                } else {
                    showError(data.error || 'Senha incorreta');
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            } catch (error) {
                showError('Erro ao conectar. Tente novamente.');
            } finally {
                loginBtn.disabled = false;
                loading.classList.remove('show');
            }
        });

        function showError(message) {
            errorMessage.textContent = message;
            errorMessage.classList.add('show');
        }
    </script>
</body>
</html>`;

  return new Response(loginHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});

// Rota POST de login
router.post('/admin/login', async (request: Request, env: Env) => {
  try {
    const body = await request.json() as { password?: string };
    const password = body.password;

    if (!env.ADMIN_KEY || env.ADMIN_KEY.trim() === '') {
      return new Response(JSON.stringify({ 
        error: 'ADMIN_KEY não configurado no servidor' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!password || password !== env.ADMIN_KEY) {
      logger.warn('Tentativa de login com senha incorreta');
      return new Response(JSON.stringify({ 
        error: 'Senha incorreta' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Cria sessão
    const sessionToken = await generateSessionToken();
    await createSession(env, sessionToken);

    // Retorna resposta com cookie
    const response = new Response(JSON.stringify({ success: true }), {
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
      }
    });

    return response;
  } catch (error) {
    logger.error('Erro no login', { error: String(error) });
    return new Response(JSON.stringify({ 
      error: 'Erro interno do servidor' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota de logout
router.post('/admin/logout', async (request: Request, env: Env) => {
  const sessionToken = getSessionToken(request);
  if (sessionToken) {
    await deleteSession(env, sessionToken);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
    }
  });
});

// Rota admin: listar todos os comunicados (com paginação e cache)
router.get('/admin/list', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = await requireAdmin(env, request);
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
                <span>📅 ${communique.timestamp ? (() => {
                    try {
                        const date = new Date(communique.timestamp);
                        return isNaN(date.getTime()) ? 'Data inválida' : date.toLocaleString('pt-BR');
                    } catch {
                        return 'Data inválida';
                    }
                })() : 'Data não disponível'}</span>
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
  const authCheck = await requireAdmin(env, request);
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

// Rota admin: painel principal com logs (DEVE VIR ANTES DA ROTA RAIZ)
router.get('/admin', async (request: Request, env: Env, ctx: ExecutionContext) => {
  logger.info('Rota /admin acessada', { url: request.url });
  const authCheck = await requireAdmin(env, request);
  if (authCheck) {
    logger.warn('Acesso negado em /admin', { status: 401 });
    return authCheck;
  }

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

    // Helper para validar timestamp
    function isValidTimestamp(ts: string | undefined | null): boolean {
      if (!ts) return false;
      const date = new Date(ts);
      return !isNaN(date.getTime());
    }
    
    function getTimestamp(ts: string | undefined | null): number {
      if (!ts) return 0;
      const date = new Date(ts);
      return isNaN(date.getTime()) ? 0 : date.getTime();
    }

    // Ordena por timestamp (mais recentes primeiro), filtrando timestamps inválidos
    logs.sort((a, b) => {
      const timeA = getTimestamp(a.timestamp);
      const timeB = getTimestamp(b.timestamp);
      if (timeA === 0 && timeB === 0) return 0;
      if (timeA === 0) return 1; // Sem timestamp vai para o final
      if (timeB === 0) return -1;
      return timeB - timeA;
    });

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

    // Calcula estatísticas detalhadas
    const now = Date.now();
    const last7Days = now - (7 * 24 * 60 * 60 * 1000);
    const last30Days = now - (30 * 24 * 60 * 60 * 1000);
    
    const communiquesByDate = communiques
      .filter(c => isValidTimestamp(c.timestamp))
      .map(c => ({
        ...c,
        date: getTimestamp(c.timestamp)
      }));
    
    const recent7Days = communiquesByDate.filter(c => c.date >= last7Days).length;
    const recent30Days = communiquesByDate.filter(c => c.date >= last30Days).length;
    
    const sortedByDate = [...communiquesByDate].sort((a, b) => b.date - a.date);
    const lastProcessed = sortedByDate[0]?.timestamp || null;
    const lastProcessedTime = lastProcessed && isValidTimestamp(lastProcessed) ? getTimestamp(lastProcessed) : null;
    const timeSinceLast = lastProcessedTime ? now - lastProcessedTime : null;
    
    // Status do sistema
    const systemStatus = timeSinceLast 
      ? timeSinceLast < 2 * 60 * 60 * 1000 ? 'healthy' // < 2 horas
      : timeSinceLast < 24 * 60 * 60 * 1000 ? 'warning' // < 24 horas
      : 'error' // > 24 horas
      : 'unknown';
    
    const successRate = communiques.length > 0 
      ? Math.round((communiques.filter(item => item.publicUrl).length / communiques.length) * 100)
      : 0;
    
    // Agrupa por dia para gráfico (últimos 7 dias)
    const dailyData: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now - (i * 24 * 60 * 60 * 1000));
      const dateKey = date.toISOString().split('T')[0];
      dailyData[dateKey] = 0;
    }
    
    communiquesByDate.forEach(c => {
      if (isValidTimestamp(c.timestamp)) {
        try {
          const dateKey = new Date(c.timestamp).toISOString().split('T')[0];
          if (dailyData.hasOwnProperty(dateKey)) {
            dailyData[dateKey]++;
          }
        } catch (e) {
          // Ignora timestamps inválidos
        }
      }
    });
    
    const chartData = Object.entries(dailyData).map(([date, count]) => ({
      date: new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      count
    }));
    
    const maxCount = Math.max(...chartData.map(d => d.count), 1);
    
    // Helper para calcular tempo relativo
    function getTimeAgo(date: Date): string {
      const diff = now - date.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return 'Agora';
      if (minutes < 60) return `${minutes} min atrás`;
      if (hours < 24) return `${hours}h atrás`;
      return `${days} dias atrás`;
    }
    
    const stats = {
      total: communiques.length,
      withGitHub: communiques.filter(item => item.githubSha).length,
      withPublicUrl: communiques.filter(item => item.publicUrl).length,
      totalViews: logs.filter(l => l.type === 'view').length,
      totalCopies: logs.filter(l => l.type === 'copy').length,
      recent7Days,
      recent30Days,
      successRate,
      systemStatus,
      lastProcessed,
      timeSinceLast,
      chartData,
      maxCount
    };

    const baseUrl = new URL(request.url).origin;
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
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 20px;
        }
        .header h1 { color: #1d1d1f; }
        .btn-logout {
            padding: 10px 20px;
            background: #ff3b30;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: background 0.2s;
        }
        .btn-logout:hover {
            background: #d32f2f;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition: all 0.2s;
            border-left: 4px solid #0071e3;
            position: relative;
            overflow: hidden;
        }
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .stat-card.success { border-left-color: #34c759; }
        .stat-card.warning { border-left-color: #ff9500; }
        .stat-card.error { border-left-color: #ff3b30; }
        .stat-card.info { border-left-color: #0071e3; }
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        .stat-icon {
            font-size: 1.5em;
            opacity: 0.8;
        }
        .stat-value {
            font-size: 2.5em;
            font-weight: 700;
            color: #1d1d1f;
            margin-bottom: 4px;
            line-height: 1;
        }
        .stat-label {
            color: #86868b;
            font-size: 0.9em;
            font-weight: 500;
        }
        .stat-change {
            font-size: 0.85em;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e5e5e7;
        }
        .stat-change.positive { color: #34c759; }
        .stat-change.negative { color: #ff3b30; }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 500;
        }
        .status-indicator.healthy {
            background: #d4edda;
            color: #155724;
        }
        .status-indicator.warning {
            background: #fff3cd;
            color: #856404;
        }
        .status-indicator.error {
            background: #f8d7da;
            color: #721c24;
        }
        .status-indicator.unknown {
            background: #e5e5e7;
            color: #86868b;
        }
        .chart-container {
            background: #f9f9f9;
            border-radius: 8px;
            padding: 20px;
            margin-top: 15px;
        }
        .chart-bars {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            height: 120px;
            margin-top: 10px;
        }
        .chart-bar {
            flex: 1;
            background: linear-gradient(to top, #0071e3, #5ac8fa);
            border-radius: 4px 4px 0 0;
            min-height: 4px;
            position: relative;
            transition: all 0.3s;
        }
        .chart-bar:hover {
            opacity: 0.8;
            transform: scaleY(1.05);
        }
        .chart-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            font-size: 0.8em;
            color: #86868b;
        }
        .chart-value {
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 0.75em;
            font-weight: 600;
            color: #1d1d1f;
            white-space: nowrap;
        }
        .timeline {
            margin-top: 20px;
        }
        .timeline-item {
            display: flex;
            gap: 12px;
            padding: 12px;
            border-left: 2px solid #e5e5e7;
            margin-left: 12px;
            margin-bottom: 12px;
            position: relative;
        }
        .timeline-item::before {
            content: '';
            position: absolute;
            left: -6px;
            top: 16px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #0071e3;
        }
        .timeline-item:last-child {
            border-left: none;
        }
        .timeline-content {
            flex: 1;
        }
        .timeline-title {
            font-weight: 500;
            margin-bottom: 4px;
            color: #1d1d1f;
        }
        .timeline-meta {
            font-size: 0.85em;
            color: #86868b;
        }
        .section {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 20px;
            margin-top: 20px;
        }
        .section h2 {
            margin-bottom: 15px;
            color: #1d1d1f;
        }
        .search-box {
            margin-bottom: 20px;
        }
        .search-box input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e5e7;
            border-radius: 8px;
            font-size: 1em;
        }
        .search-box input:focus {
            outline: none;
            border-color: #0071e3;
        }
        .communiques-list {
            display: grid;
            gap: 12px;
        }
        .communique-item {
            padding: 16px;
            border: 1px solid #e5e5e7;
            border-radius: 8px;
            transition: all 0.2s;
        }
        .communique-item:hover {
            border-color: #0071e3;
            background: #f9f9f9;
        }
        .communique-title {
            font-weight: 500;
            margin-bottom: 8px;
            color: #1d1d1f;
        }
        .communique-meta {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            font-size: 0.85em;
            color: #86868b;
            margin-bottom: 8px;
        }
        .communique-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            text-decoration: none;
            display: inline-block;
            transition: all 0.2s;
        }
        .btn-primary {
            background: #0071e3;
            color: white;
        }
        .btn-primary:hover {
            background: #0051a5;
        }
        .btn-secondary {
            background: #f5f5f7;
            color: #1d1d1f;
            border: 1px solid #e5e5e7;
        }
        .btn-secondary:hover {
            background: #e5e5e7;
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
        .no-data {
            text-align: center;
            padding: 40px;
            color: #86868b;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #86868b;
        }
        .actions-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-top: 20px;
        }
        .action-card {
            padding: 16px;
            background: #f5f5f7;
            border-radius: 8px;
            border: 1px solid #e5e5e7;
        }
        .action-card a {
            color: #0071e3;
            text-decoration: none;
            font-weight: 500;
        }
        .action-card a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Painel Administrativo</h1>
            <button class="btn-logout" onclick="logout()">🚪 Sair</button>
        </div>
        
        <div class="section" style="margin-top: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
                <h2 style="margin: 0;">📊 Visão Geral</h2>
                <div class="status-indicator ${stats.systemStatus}">
                    <span>${stats.systemStatus === 'healthy' ? '✅' : stats.systemStatus === 'warning' ? '⚠️' : stats.systemStatus === 'error' ? '❌' : '❓'}</span>
                    <span>${stats.systemStatus === 'healthy' ? 'Sistema Operacional' : stats.systemStatus === 'warning' ? 'Atenção Necessária' : stats.systemStatus === 'error' ? 'Sistema Inativo' : 'Status Desconhecido'}</span>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card info">
                    <div class="stat-header">
                        <div>
                            <div class="stat-value">${stats.total}</div>
                            <div class="stat-label">Total de Comunicados</div>
                        </div>
                        <div class="stat-icon">📄</div>
                    </div>
                    ${stats.recent7Days > 0 ? `<div class="stat-change positive">+${stats.recent7Days} nos últimos 7 dias</div>` : ''}
                </div>
                
                <div class="stat-card success">
                    <div class="stat-header">
                        <div>
                            <div class="stat-value">${stats.withPublicUrl}</div>
                            <div class="stat-label">Publicados</div>
                        </div>
                        <div class="stat-icon">✅</div>
                    </div>
                    <div class="stat-change ${stats.successRate >= 90 ? 'positive' : stats.successRate >= 70 ? '' : 'negative'}">
                        ${stats.successRate}% taxa de sucesso
                    </div>
                </div>
                
                <div class="stat-card info">
                    <div class="stat-header">
                        <div>
                            <div class="stat-value">${stats.recent7Days}</div>
                            <div class="stat-label">Últimos 7 Dias</div>
                        </div>
                        <div class="stat-icon">📈</div>
                    </div>
                    <div class="stat-change">
                        ${stats.recent30Days} nos últimos 30 dias
                    </div>
                </div>
                
                <div class="stat-card warning">
                    <div class="stat-header">
                        <div>
                            <div class="stat-value">${stats.totalViews}</div>
                            <div class="stat-label">Visualizações</div>
                        </div>
                        <div class="stat-icon">👁️</div>
                    </div>
                    <div class="stat-change">
                        ${stats.totalCopies} cópias registradas
                    </div>
                </div>
            </div>
            
            ${stats.lastProcessed && isValidTimestamp(stats.lastProcessed) ? `
            <div style="margin-top: 20px; padding: 16px; background: #f9f9f9; border-radius: 8px; font-size: 0.9em; color: #86868b;">
                <strong>Último processamento:</strong> ${new Date(stats.lastProcessed).toLocaleString('pt-BR')}
                ${stats.timeSinceLast ? ` (${Math.floor(stats.timeSinceLast / (60 * 60 * 1000))}h atrás)` : ''}
            </div>
            ` : ''}
        </div>
        
        <div class="section">
            <h2>📈 Tendência (Últimos 7 Dias)</h2>
            <div class="chart-container">
                <div class="chart-bars">
                    ${stats.chartData.map((d, i) => `
                        <div class="chart-bar" style="height: ${(d.count / stats.maxCount) * 100}%" title="${d.date}: ${d.count} comunicado${d.count !== 1 ? 's' : ''}">
                            ${d.count > 0 ? `<span class="chart-value">${d.count}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="chart-labels">
                    ${stats.chartData.map(d => `<span>${d.date}</span>`).join('')}
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📋 Comunicados</h2>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Buscar comunicados..." onkeyup="searchCommuniques()">
            </div>
            <div id="communiquesContainer" class="loading">Carregando comunicados...</div>
        </div>

        <div class="section">
            <h2>🕐 Atividades Recentes</h2>
            <div class="timeline">
                ${logs.slice(0, 10).filter(log => isValidTimestamp(log.timestamp)).map(log => {
                    const logTimestamp = getTimestamp(log.timestamp);
                    const diff = now - logTimestamp;
                    const minutes = Math.floor(diff / 60000);
                    const hours = Math.floor(diff / 3600000);
                    const days = Math.floor(diff / 86400000);
                    let timeAgo = 'Agora';
                    if (minutes >= 1 && minutes < 60) timeAgo = `${minutes} min atrás`;
                    else if (hours < 24) timeAgo = `${hours}h atrás`;
                    else if (days > 0) timeAgo = `${days} dias atrás`;
                    
                    return `
                    <div class="timeline-item">
                        <div class="timeline-content">
                            <div class="timeline-title">
                                ${log.type === 'view' ? '👁️ Visualização' : '📋 Cópia'} - ${escapeHtml(log.communiqueTitle)}
                            </div>
                            <div class="timeline-meta">
                                ${timeAgo} • IP: ${log.ip} ${log.referer !== 'direct' ? `• ${escapeHtml(log.referer.substring(0, 50))}${log.referer.length > 50 ? '...' : ''}` : ''}
                            </div>
                        </div>
                    </div>
                    `;
                }).join('')}
                ${logs.length === 0 ? '<div class="no-data">Nenhuma atividade recente</div>' : ''}
            </div>
        </div>
        
        <div class="section">
            <h2>📋 Logs de Acesso (Últimos 100)</h2>
            ${logs.length === 0 ? '<div class="no-data">Nenhum log encontrado</div>' : `
            <div style="overflow-x: auto;">
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
                        ${logs.filter(log => isValidTimestamp(log.timestamp)).map(log => {
                            const logDate = new Date(log.timestamp);
                            return `
                        <tr>
                            <td>
                                <span class="badge badge-${log.type}">${log.type === 'view' ? '👁️ Visualização' : '📋 Cópia'}</span>
                            </td>
                            <td>
                                <strong>${escapeHtml(log.communiqueTitle)}</strong><br>
                                <small style="color: #86868b;">ID: ${log.communiqueId}</small>
                            </td>
                            <td class="timestamp">${logDate.toLocaleString('pt-BR')}</td>
                            <td class="ip">${log.ip}</td>
                            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.referer)}">
                                ${log.referer === 'direct' ? '<em>Direto</em>' : escapeHtml(log.referer)}
                            </td>
                        </tr>
                        `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            `}
        </div>

        <div class="section">
            <h2>🔗 Ações</h2>
            <div class="actions-section">
                <div class="action-card">
                    <strong>📊 Estatísticas</strong>
                    <p style="margin-top: 8px; font-size: 0.9em; color: #86868b;">Ver estatísticas detalhadas</p>
                    <a href="/admin/stats" target="_blank">Ver JSON →</a>
                </div>
                <div class="action-card">
                    <strong>🔄 Reprocessar</strong>
                    <p style="margin-top: 8px; font-size: 0.9em; color: #86868b;">Reprocessar itens sem cópia</p>
                    <a href="/admin/reprocess" target="_blank">Executar →</a>
                </div>
                <div class="action-card">
                    <strong>🔄 Recriar Todas</strong>
                    <p style="margin-top: 8px; font-size: 0.9em; color: #86868b;">Recriar todas as páginas</p>
                    <a href="/admin/recreate-all" target="_blank">Executar →</a>
                </div>
                <div class="action-card">
                    <strong>📧 Testar Email</strong>
                    <p style="margin-top: 8px; font-size: 0.9em; color: #86868b;">Enviar email de teste</p>
                    <a href="/admin/test-email" target="_blank" id="testEmailLink" onclick="testEmail(event); return false;" style="cursor: pointer;">Enviar Teste →</a>
                </div>
            </div>
        </div>
    </div>
    <script>
        let allCommuniques = [];
        
        function getTimeAgo(date) {
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            
            if (minutes < 1) return 'Agora';
            if (minutes < 60) return \`\${minutes} min atrás\`;
            if (hours < 24) return \`\${hours}h atrás\`;
            return \`\${days} dias atrás\`;
        }
        
        async function loadCommuniques() {
            try {
                const response = await fetch('/admin/list?limit=100');
                if (!response.ok) throw new Error('Erro ao carregar');
    const data = await response.json();
                allCommuniques = data.items || [];
                renderCommuniques(allCommuniques);
            } catch (error) {
                document.getElementById('communiquesContainer').innerHTML = 
                    '<div class="no-data">Erro ao carregar comunicados</div>';
            }
        }
        
        function renderCommuniques(communiques) {
            const container = document.getElementById('communiquesContainer');
            if (communiques.length === 0) {
                container.innerHTML = '<div class="no-data">Nenhum comunicado encontrado</div>';
                return;
            }
            
            container.innerHTML = '<div class="communiques-list">' + communiques.map(item => {
                let formattedDate = 'Data inválida';
                if (item.timestamp) {
                    try {
                        const date = new Date(item.timestamp);
                        if (!isNaN(date.getTime())) {
                            formattedDate = date.toLocaleString('pt-BR');
                        }
                    } catch (e) {
                        // Mantém 'Data inválida'
                    }
                }
                return \`
                    <div class="communique-item">
                        <div class="communique-title">\${escapeHtml(item.title)}</div>
                        <div class="communique-meta">
                            <span>📅 \${formattedDate}</span>
                            \${item.publicUrl ? '<span>✅ Publicado</span>' : '<span>⚠️ Não publicado</span>'}
                        </div>
                        <div class="communique-actions">
                            \${item.publicUrl ? \`<a href="\${item.publicUrl}" target="_blank" class="btn btn-primary">Ver Página</a>\` : ''}
                            \${item.githubUrl ? \`<a href="\${item.githubUrl}" target="_blank" class="btn btn-secondary">GitHub</a>\` : ''}
                            <a href="/admin/view/\${item.id}" target="_blank" class="btn btn-secondary">Ver HTML</a>
                            \${item.url ? \`<a href="\${item.url}" target="_blank" class="btn btn-secondary">Fonte</a>\` : ''}
                        </div>
                    </div>
                \`;
            }).join('') + '</div>';
        }
        
        function searchCommuniques() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const filtered = allCommuniques.filter(item => 
                item.title.toLowerCase().includes(search) ||
                (item.url && item.url.toLowerCase().includes(search))
            );
            renderCommuniques(filtered);
        }
        
        async function logout() {
            if (confirm('Deseja realmente sair?')) {
                await fetch('/admin/logout', { method: 'POST' });
                window.location.href = '/admin/login';
            }
        }
        
        async function testEmail(event) {
            event.preventDefault();
            const link = document.getElementById('testEmailLink');
            const originalText = link.textContent;
            
            link.textContent = 'Enviando...';
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.6';
            
            try {
                const response = await fetch('/admin/test-email');
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ Email de teste enviado com sucesso!\\n\\nDestinatários: ' + data.recipients + '\\nTítulo: ' + data.communique.title);
                } else {
                    let errorMsg = '❌ Erro ao enviar email\\n\\n' + (data.message || data.error);
                    if (data.help) {
                        errorMsg += '\\n\\n💡 Dica: ' + data.help;
                    }
                    if (data.troubleshooting) {
                        errorMsg += '\\n\\n📋 Verificações:\\n';
                        if (data.troubleshooting.checkEmailConfig) {
                            errorMsg += '• ' + data.troubleshooting.checkEmailConfig + '\\n';
                        }
                        if (data.troubleshooting.checkSPF) {
                            errorMsg += '• ' + data.troubleshooting.checkSPF + '\\n';
                        }
                        if (data.troubleshooting.checkDomain) {
                            errorMsg += '• ' + data.troubleshooting.checkDomain + '\\n';
                        }
                    }
                    alert(errorMsg);
    }
  } catch (error) {
                alert(\`❌ Erro ao testar email: \${error.message}\`);
            } finally {
                link.textContent = originalText;
                link.style.pointerEvents = 'auto';
                link.style.opacity = '1';
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        loadCommuniques();
    </script>
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

                let formattedDate = 'Data inválida';
                if (item.timestamp) {
                    try {
                const date = new Date(item.timestamp);
                        if (!isNaN(date.getTime())) {
                            formattedDate = date.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                        }
                    } catch (e) {
                        // Mantém 'Data inválida'
                    }
                }

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
  const authCheck = await requireAdmin(env, request);
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
  const authCheck = await requireAdmin(env, request);
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

// Rota admin: estatísticas
router.get('/admin/stats', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = await requireAdmin(env, request);
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

// Rota admin: teste de email
router.get('/admin/test-email', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = await requireAdmin(env, request);
  if (authCheck) return authCheck;

  try {
    // Verifica se email está configurado
    if (!env.EMAIL_FROM || !env.EMAIL_TO) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Email não configurado. Configure EMAIL_FROM e EMAIL_TO nas variáveis de ambiente.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Cria um comunicado de teste
    const testCommunique: Communique = {
      id: 'test-' + Date.now(),
      uuid: crypto.randomUUID(),
      title: '🧪 Teste de Email - ComShalom RSS Monitor',
      url: 'https://comshalom.org/test',
      timestamp: new Date().toISOString(),
      html: `
        <h1>Este é um email de teste</h1>
        <p>Este é um comunicado de teste para verificar se o sistema de email está funcionando corretamente.</p>
        <p>Se você recebeu este email, significa que:</p>
        <ul>
          <li>✅ O sistema de email está configurado corretamente</li>
          <li>✅ O template HTML está sendo gerado</li>
          <li>✅ O Mailchannels está funcionando</li>
          <li>✅ As notificações estão sendo enviadas</li>
        </ul>
        <p><strong>Data do teste:</strong> ${new Date().toLocaleString('pt-BR')}</p>
        <p><em>Este é apenas um email de teste e pode ser ignorado.</em></p>
      `,
      githubSha: 'test123',
      githubUrl: 'https://github.com/test',
      publicUrl: 'https://go.tomina.ga/pages/test.html'
    };

    // Envia o email de teste
    await sendEmail(env, testCommunique, testCommunique.publicUrl || 'https://go.tomina.ga/pages/test.html');

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Email de teste enviado com sucesso!',
      communique: {
        id: testCommunique.id,
        title: testCommunique.title,
        timestamp: testCommunique.timestamp
      },
      recipients: env.EMAIL_TO.split(',').map(e => e.trim()).length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorMessage = String(error);
    logger.error('Erro ao enviar email de teste', { error: errorMessage });
    
    // Mensagem mais amigável baseada no tipo de erro
    let userMessage = 'Erro ao enviar email de teste.';
    let helpText = '';
    
    if (errorMessage.includes('401') || errorMessage.includes('autenticação')) {
      userMessage = 'Erro de autenticação: O Mailchannels requer configuração DNS (SPF).';
      helpText = 'Para usar o Mailchannels com Cloudflare Workers, você precisa configurar SPF no DNS do domínio do EMAIL_FROM. Se estiver usando um domínio workers.dev, considere usar um domínio customizado com SPF configurado.';
    } else if (errorMessage.includes('403')) {
      userMessage = 'Erro de permissão: O domínio não está autorizado.';
      helpText = 'Verifique se o domínio do EMAIL_FROM tem SPF e DKIM configurados corretamente apontando para o Mailchannels.';
    } else if (errorMessage.includes('400')) {
      userMessage = 'Erro de validação: Verifique os dados do email.';
      helpText = 'Certifique-se de que EMAIL_FROM e EMAIL_TO estão configurados corretamente e são emails válidos.';
    }
    
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage,
      message: userMessage,
      help: helpText,
      troubleshooting: {
        checkEmailConfig: 'Verifique se EMAIL_FROM e EMAIL_TO estão configurados nas variáveis de ambiente do Cloudflare Workers',
        checkSPF: 'Se usar domínio customizado, configure SPF: v=spf1 include:relay.mailchannels.net ~all',
        checkDomain: 'O domínio do EMAIL_FROM precisa estar autorizado no Mailchannels via DNS'
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota de teste para processar URL específica
router.get('/admin/test-url', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = await requireAdmin(env, request);
  if (authCheck) return authCheck;

  try {
    const urlParam = new URL(request.url).searchParams.get('url');
    const force = new URL(request.url).searchParams.get('force') === 'true';
    
    if (!urlParam) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Parâmetro "url" é obrigatório. Use: /admin/test-url?url=https://...&force=true (opcional)'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    logger.info('Testando processamento de URL específica', { url: urlParam, force });
    const config = loadConfig(env);
    
    // Se force=true, remove do KV antes de processar
    if (force) {
      const urlHash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(urlParam)
      );
      const hashArray = Array.from(new Uint8Array(urlHash));
      const id = hashArray
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 32);
      
      await env.COMMUNIQUE_STORE.delete(id);
      logger.info('Item removido do KV para forçar reprocessamento', { id, url: urlParam });
    }
    
    const result = await checkSpecificUrl(urlParam, env, config);

    return new Response(JSON.stringify({ 
      success: result.success,
      isNew: result.isNew,
      error: result.error,
      message: result.success 
        ? (result.isNew ? 'URL processada com sucesso (novo item)' : 'URL processada/atualizada')
        : `Erro ao processar URL: ${result.error}`,
      url: urlParam,
      forced: force
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorMessage = String(error);
    logger.error('Erro ao testar URL específica', { error: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Rota para forçar processamento de todas as URLs específicas
router.get('/admin/process-specific-urls', async (request: Request, env: Env, ctx: ExecutionContext) => {
  const authCheck = await requireAdmin(env, request);
  if (authCheck) return authCheck;

  try {
    const specificUrls = [
      'https://portal.shalom.tec.br/comunicado-acerca-dos-discernimentos-de-dezembro-de-2025',
      'https://portal.shalom.tec.br/2025-dezembro-discernimentos'
    ];
    
    const config = loadConfig(env);
    const results = [];
    
    for (const url of specificUrls) {
      try {
        // Remove do KV para forçar reprocessamento
        const urlHash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(url)
        );
        const hashArray = Array.from(new Uint8Array(urlHash));
        const id = hashArray
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .substring(0, 32);
        
        await env.COMMUNIQUE_STORE.delete(id);
        logger.info('Item removido para forçar reprocessamento', { id, url });
        
        const result = await checkSpecificUrl(url, env, config);
        results.push({
          url,
          success: result.success,
          isNew: result.isNew,
          error: result.error
        });
      } catch (error) {
        results.push({
          url,
          success: false,
          error: String(error)
        });
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Processamento de URLs específicas concluído',
      results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false,
      error: String(error)
    }), {
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
      // Log para debug quando rota não é encontrada
      logger.warn('Rota não encontrada', { 
        method: request.method, 
        url: request.url,
        pathname: new URL(request.url).pathname 
      });
      return addCorsHeaders(new Response('Not Found', { status: 404 }), origin);
    });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processRSSFeed(env));
  }
};

