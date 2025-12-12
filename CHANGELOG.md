# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2025-01-XX

### Adicionado

- Sistema de monitoramento automatizado de feeds RSS com triggers cron (15 minutos)
- Suporte a múltiplos feeds RSS configuráveis
- Filtragem por similaridade usando algoritmo Levenshtein Distance
- Filtro temporal para processar posts a partir de data configurável
- Armazenamento persistente em Cloudflare KV Storage
- Prevenção de duplicatas baseada em hash SHA-256 da URL
- Integração com GitHub API para commits automáticos de arquivos HTML
- Geração de URLs públicas com UUID único
- Notificações por email via Mailchannels e Resend
- Notificações push para dispositivos móveis via Service Worker
- Suporte a múltiplos destinatários de email separados por vírgula
- Interface web responsiva construída com SolidJS
- API REST com endpoints administrativos e autenticação
- Sistema de paginação e busca na listagem
- Cache API para otimização de requisições
- Sanitização HTML para remoção de scripts e conteúdo malicioso
- Rate limiting configurável por IP
- Headers CORS configurados para acesso do frontend
- Otimizações específicas para Cloudflare Workers
- Logging estruturado em JSON
- Sistema de configuração centralizada
- Documentação técnica completa
- Scripts de configuração de email (SPF/DKIM verification)
- Suporte a domínio customizado via CNAME
- GitHub Pages integration com deploy automatizado

### Configuração

- Variáveis de ambiente obrigatórias: GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME
- Variáveis de ambiente opcionais para personalização completa
- Configuração de KV namespaces para produção e preview
- Suporte a múltiplos provedores de email

### Segurança

- Autenticação via header X-ADMIN-KEY para rotas administrativas
- Rate limiting em memória (configurável)
- Sanitização completa de HTML antes do armazenamento
- Validação de entrada em todos os endpoints
- Escape de HTML para prevenção de XSS

