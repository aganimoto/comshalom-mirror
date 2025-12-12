# ComShalom RSS Monitor

Sistema automatizado de monitoramento de feeds RSS desenvolvido com Cloudflare Workers. Processa comunicados específicos do ComShalom, armazena conteúdo no Cloudflare KV Storage, realiza commits automáticos no GitHub, envia notificações por email e push notifications para dispositivos móveis.

## Visão Geral

Solução serverless que monitora feeds RSS, detecta comunicados relevantes através de filtros configuráveis, armazena cópias completas do conteúdo HTML, realiza commits automáticos no GitHub e notifica usuários via email e push notifications.

## Funcionalidades Principais

### Monitoramento Automatizado
- **Cron Trigger**: Execução automática a cada 15 minutos
- **Múltiplos Feeds**: Suporte a múltiplos feeds RSS configuráveis
- **Filtragem por Similaridade**: Algoritmo de similaridade de texto (Levenshtein Distance)
- **Filtro Temporal**: Processa apenas posts a partir de data configurável (padrão: setembro 2025)

### Armazenamento e Persistência
- **Cloudflare KV Storage**: Armazenamento persistente de comunicados
- **Prevenção de Duplicatas**: Validação baseada em hash SHA-256 da URL
- **GitHub Integration**: Commits automáticos de arquivos HTML no repositório
- **UUID nos Links**: URLs públicas usam UUID único para melhor identificação

### Notificações
- **Email**: Notificações via Mailchannels (integrado ao Cloudflare Workers)
- **Push Notifications**: Notificações push para dispositivos móveis via Service Worker
- **Múltiplos Destinatários**: Suporte a múltiplos emails separados por vírgula

### Interface e API
- **Interface Web**: Frontend responsivo para visualização de comunicados
- **API REST**: Endpoints administrativos com autenticação
- **Paginação**: Suporte a paginação e busca na listagem
- **Cache**: Cache API para otimização de requisições

### Segurança e Performance
- **Sanitização HTML**: Remoção de scripts e conteúdo malicioso
- **Rate Limiting**: Limitação de requisições por IP
- **CORS**: Headers CORS configurados para acesso do frontend
- **Otimizações Workers**: Cache, processamento paralelo, validações

## Arquitetura

```
┌─────────────────┐
│  RSS Feed       │
│  (ComShalom)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Cloudflare     │
│  Worker         │
│  (Cron Trigger) │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│ KV     │ │ GitHub  │
│ Storage│ │ API     │
└────────┘ └────┬────┘
                │
         ┌──────┴──────┐
         ▼             ▼
    ┌────────┐    ┌──────────┐
    │ Email  │    │ Push     │
    │ (SMTP) │    │ Notif.   │
    └────────┘    └──────────┘
```

## Requisitos

- **Conta Cloudflare** (gratuita)
- **Conta GitHub**
- **Node.js** 18 ou superior
- **npm** ou **yarn**
- **Wrangler CLI** 4.x

## Instalação

### 1. Clonar Repositório

```bash
git clone https://github.com/aganimoto/comshalom-mirror.git
cd comshalom-mirror
```

### 2. Instalar Dependências

```bash
npm install
```

### 3. Instalar Wrangler CLI

```bash
npm install -g wrangler
```

### 4. Autenticação Cloudflare

```bash
wrangler login
```

## Configuração

### KV Namespace

Criar namespace para armazenamento de comunicados:

```bash
wrangler kv:namespace create "COMMUNIQUE_STORE"
```

Copiar o ID retornado e atualizar `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "COMMUNIQUE_STORE"
id = "ID_RETORNADO"
preview_id = "ID_RETORNADO"
```

Para desenvolvimento local, criar namespace de preview:

```bash
wrangler kv:namespace create "COMMUNIQUE_STORE" --preview
```

Atualizar `preview_id` em `wrangler.toml` com o ID retornado.

### Variáveis de Ambiente Obrigatórias

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_REPO_OWNER
wrangler secret put GITHUB_REPO_NAME
```

### Variáveis de Ambiente Opcionais

```bash
# Autenticação
wrangler secret put ADMIN_KEY

# Notificações por Email
wrangler secret put EMAIL_FROM
wrangler secret put EMAIL_TO

# Configuração de Domínio
wrangler secret put CUSTOM_DOMAIN

# Filtros e Feeds
wrangler secret put PATTERNS
wrangler secret put RSS_FEEDS
wrangler secret put MIN_DATE

# Performance
wrangler secret put BATCH_SIZE
wrangler secret put MAX_CONCURRENCY
wrangler secret put RATE_LIMIT_ENABLED
```

### Descrição das Variáveis

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `GITHUB_TOKEN` | Sim | Token de acesso do GitHub (Personal Access Token) |
| `GITHUB_REPO_OWNER` | Sim | Proprietário do repositório GitHub |
| `GITHUB_REPO_NAME` | Sim | Nome do repositório GitHub |
| `ADMIN_KEY` | Não | Chave para autenticação nas rotas admin |
| `EMAIL_FROM` | Não | Email de origem para notificações |
| `EMAIL_TO` | Não | Emails destinatários (separados por vírgula) |
| `CUSTOM_DOMAIN` | Não | Domínio customizado do GitHub Pages |
| `PATTERNS` | Não | Padrões de busca (separados por vírgula, padrão: "discernimentos") |
| `RSS_FEEDS` | Não | URLs de feeds RSS (separadas por vírgula) |
| `MIN_DATE` | Não | Data mínima no formato ISO (padrão: 2025-09-01T00:00:00Z) |
| `BATCH_SIZE` | Não | Tamanho do batch para processamento (padrão: 5) |
| `MAX_CONCURRENCY` | Não | Máximo de itens processados em paralelo (padrão: 3) |
| `RATE_LIMIT_ENABLED` | Não | Habilitar rate limiting (padrão: true) |
| `VAPID_PUBLIC_KEY` | Não | Chave pública VAPID para Web Push |
| `VAPID_PRIVATE_KEY` | Não | Chave privada VAPID para Web Push |

### Token GitHub

#### Personal Access Token (Classic)

1. Acessar: https://github.com/settings/tokens
2. Gerar novo token (classic)
3. Definir escopo `repo` (acesso completo a repositórios)
4. Copiar o token gerado

#### Fine-Grained Personal Access Token

1. Acessar: https://github.com/settings/tokens?type=beta
2. Gerar novo token
3. Configurar acesso ao repositório específico
4. Permissões necessárias:
   - **Contents**: Read and write
   - **Metadata**: Read-only

## Execução Local

### Servidor de Desenvolvimento

```bash
npm run dev
```

Servidor disponível em `http://localhost:8787`.

### Teste Manual

```bash
# Health check
curl http://localhost:8787/health

# Executar processamento manualmente
curl http://localhost:8787/test
```

### Rotas Administrativas

```bash
# Listar comunicados
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/list

# Visualizar comunicado específico
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/view/ID

# Estatísticas
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/stats
```

## Deploy

### Deploy para Produção

```bash
npm run deploy
```

Worker disponível em `https://comshalom-rss-monitor.SUBDOMINIO.workers.dev`.

### Verificar Logs

```bash
npm run tail
```

### Registrar Subdomínio workers.dev

Antes do primeiro deploy, é necessário registrar um subdomínio:

1. Acessar: https://dash.cloudflare.com
2. Workers & Pages → Overview
3. Registrar subdomínio workers.dev

## Estrutura do Projeto

```
comshalom-mirror/
├── src/
│   ├── index.ts              # Código principal do Worker
│   ├── types.ts              # Definições de tipos TypeScript
│   └── utils/
│       ├── cache.ts          # Cache API utilities
│       ├── config.ts         # Configuração centralizada
│       ├── logger.ts         # Logging estruturado
│       ├── rateLimit.ts      # Rate limiting
│       ├── rssParser.ts      # Parser RSS melhorado
│       ├── sanitize.ts       # Sanitização HTML
│       ├── webpush.ts        # Web Push utilities
│       └── workers.ts        # Otimizações específicas Workers
├── public/
│   ├── index.html            # Frontend web
│   └── sw.js                 # Service Worker para push notifications
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Configuração do GitHub Pages

### 1. Arquivo CNAME

O arquivo `CNAME` na raiz do repositório configura o domínio customizado:

```
go.tomina.ga
```

### 2. Configuração DNS

No provedor DNS do domínio `tomina.ga`, criar registro CNAME:

```
Tipo: CNAME
Nome: go
Valor: aganimoto.github.io
TTL: 3600 (ou padrão)
```

### 3. Configuração no GitHub

1. Acessar: https://github.com/aganimoto/comshalom-mirror/settings/pages
2. **Source**: Branch `main`, folder `/ (root)`
3. **Custom domain**: `go.tomina.ga`
4. Marcar **"Enforce HTTPS"** após verificação

### 4. Verificação

```bash
dig go.tomina.ga +nostats +nocomments +nocmd
```

O resultado deve mostrar CNAME apontando para `aganimoto.github.io`.

## Notificações Push

### Ativação no Dispositivo Móvel

1. Acessar `https://go.tomina.ga` no navegador do celular
2. Clicar no botão **"🔕 Ativar Notificações"**
3. Permitir notificações quando solicitado
4. Notificações serão recebidas automaticamente quando novos comunicados forem detectados

### Funcionamento

- **Service Worker**: Registrado no navegador para receber notificações
- **Polling**: Verifica a cada 30 segundos se há novos comunicados
- **Notificações**: Exibidas mesmo com o navegador fechado (se Service Worker ativo)
- **Clique na Notificação**: Abre o comunicado diretamente

### Requisitos

- Navegador com suporte a Service Workers (Chrome, Firefox, Safari, Edge)
- HTTPS (necessário para Service Workers)
- Permissão de notificações concedida

## API REST

### Endpoints Públicos

#### `GET /health`

Status do Worker e conectividade.

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-12T10:00:00.000Z",
  "kv": "connected",
  "github": "configured"
}
```

#### `GET /test`

Execução manual do processamento RSS.

**Resposta:**
```json
{
  "success": true,
  "message": "Processamento iniciado em background",
  "status": "processing"
}
```

### Endpoints Administrativos

Todos os endpoints administrativos requerem header `X-ADMIN-KEY`.

#### `GET /admin/list`

Lista todos os comunicados salvos.

**Query Parameters:**
- `limit` (opcional): Número de itens por página (padrão: 50, máximo: 100)
- `cursor` (opcional): Cursor para paginação
- `search` (opcional): Termo de busca

**Exemplo:**
```bash
curl -H "X-ADMIN-KEY: sua-chave" \
     "https://worker.workers.dev/admin/list?limit=10&search=discernimentos"
```

**Resposta:**
```json
{
  "count": 10,
  "total": 25,
  "cursor": "cursor_string",
  "hasMore": true,
  "items": [
    {
      "id": "abc123...",
      "title": "Comunicado...",
      "url": "https://...",
      "timestamp": "2025-12-12T10:00:00.000Z",
      "githubUrl": "https://github.com/...",
      "publicUrl": "https://go.tomina.ga/pages/UUID-slug.html"
    }
  ]
}
```

#### `GET /admin/view/:id`

Visualiza HTML completo de um comunicado.

**Exemplo:**
```bash
curl -H "X-ADMIN-KEY: sua-chave" \
     "https://worker.workers.dev/admin/view/abc123..."
```

**Resposta:** HTML formatado com wrapper profissional.

#### `GET /admin/stats`

Estatísticas do sistema.

**Resposta:**
```json
{
  "total": 25,
  "withGitHub": 25,
  "withPublicUrl": 25,
  "lastProcessed": "2025-12-12T10:00:00.000Z",
  "timestamp": "2025-12-12T10:15:00.000Z"
}
```

### Endpoints de Notificações Push

#### `GET /api/push/check`

Verifica se há nova notificação (usado pelo Service Worker).

**Headers:**
- `X-Last-Check`: Timestamp da última verificação

**Resposta:**
```json
{
  "hasNew": true,
  "notification": {
    "title": "Novo Comunicado Detectado",
    "body": "Título do comunicado",
    "url": "https://go.tomina.ga/...",
    "icon": "/icon-192x192.png",
    "timestamp": 1702380000000
  }
}
```

## Configuração Avançada

### Filtros de Busca

Por padrão, o sistema busca posts com "discernimentos" no título a partir de setembro de 2025.

**Configurar via variável de ambiente:**
```bash
wrangler secret put PATTERNS
# Valor: "discernimentos,envio,disciples"
```

**Processar todos os posts:**
```bash
wrangler secret put PATTERNS
# Valor: "*"
```

### Múltiplos Feeds RSS

```bash
wrangler secret put RSS_FEEDS
# Valor: "https://comshalom.org/feed/,https://comshalom.org/?s=discernimentos&feed=rss2"
```

### Data Mínima

```bash
wrangler secret put MIN_DATE
# Valor: "2025-09-01T00:00:00Z"
```

### Performance

```bash
# Tamanho do batch (1-10)
wrangler secret put BATCH_SIZE
# Valor: "5"

# Máximo de concorrência (1-10)
wrangler secret put MAX_CONCURRENCY
# Valor: "3"

# Desabilitar rate limiting
wrangler secret put RATE_LIMIT_ENABLED
# Valor: "false"
```

### Intervalo do Cron

Editar `wrangler.toml`:

```toml
[triggers]
crons = ["*/15 * * * *"]  # A cada 15 minutos
```

Formato: `minuto hora dia mês dia-da-semana`

Exemplos:
- `*/15 * * * *` - A cada 15 minutos
- `0 */1 * * *` - A cada hora
- `0 9 * * *` - Diariamente às 9h

## Troubleshooting

### KV namespace not found

**Problema:** Erro ao acessar KV namespace.

**Solução:**
1. Verificar ID do namespace em `wrangler.toml`
2. Confirmar criação: `wrangler kv:namespace list`
3. Verificar binding: `wrangler kv:key list --namespace-id ID`

### GitHub API error: 401

**Problema:** Token inválido ou sem permissões.

**Solução:**
1. Verificar token: `wrangler secret list`
2. Testar token:
   ```bash
   curl -H "Authorization: token TOKEN" https://api.github.com/user
   ```
3. Verificar permissões do token (deve ter `repo` ou `Contents: Read and write`)

### GitHub API error: 404

**Problema:** Repositório não encontrado.

**Solução:**
1. Verificar `GITHUB_REPO_OWNER` e `GITHUB_REPO_NAME`
2. Confirmar existência do repositório
3. Verificar acesso do token ao repositório

### Cron não executa

**Problema:** Cron Trigger não está executando.

**Solução:**
1. Cron Triggers operam apenas em produção
2. Verificar logs: `wrangler tail`
3. Verificar configuração no Cloudflare Dashboard
4. Confirmar formato do cron em `wrangler.toml`

### Email não enviado

**Problema:** Notificações por email não são enviadas.

**Solução:**
1. Verificar `EMAIL_FROM` e `EMAIL_TO`
2. Consultar logs: `wrangler tail`
3. Para produção, configurar registros SPF/DKIM no domínio de origem
4. Verificar formato dos emails (devem ser válidos)

### Notificações push não funcionam

**Problema:** Notificações push não aparecem no celular.

**Solução:**
1. Verificar se está usando HTTPS (necessário para Service Workers)
2. Verificar permissão de notificações no navegador
3. Verificar se Service Worker está registrado (DevTools > Application > Service Workers)
4. Verificar console do navegador para erros
5. Confirmar que `/sw.js` está acessível

### Erro de CORS

**Problema:** Erro de CORS ao acessar API do frontend.

**Solução:**
1. Verificar origem permitida no código
2. Verificar header `Origin` nas requisições
3. Confirmar que frontend e Worker estão no mesmo domínio ou configurados corretamente

## Monitoramento e Logs

### Logs em Tempo Real

```bash
npm run tail
```

### Logs Estruturados

Todos os logs são estruturados em JSON com:
- `timestamp`: Data e hora ISO
- `level`: Nível do log (info, warn, error, debug)
- `message`: Mensagem do log
- `metadata`: Dados adicionais (opcional)

### Métricas

Acessar `/admin/stats` para estatísticas do sistema:
- Total de comunicados
- Comunicados com commit no GitHub
- Último processamento
- Timestamp da consulta

## Segurança

### Autenticação

- Rotas administrativas protegidas com `X-ADMIN-KEY`
- Rate limiting configurável para prevenir abuso
- Validação de entrada em todos os endpoints

### Sanitização

- HTML sanitizado antes de armazenar
- Remoção de scripts e conteúdo malicioso
- Escape de HTML para prevenir XSS

### CORS

- Headers CORS configurados para origens permitidas
- Suporte a múltiplos domínios (localhost, produção)

## Limitações Conhecidas

### Segurança

1. **ADMIN_KEY no Frontend**: A chave de administração está exposta no código do frontend (`index.html`). Recomenda-se implementar autenticação baseada em sessão ou OAuth.

2. **Rate Limiting em Memória**: O rate limiting atual é em memória e não persiste entre reinicializações do Worker. Para produção crítica, recomenda-se usar Cloudflare KV ou Durable Objects.

3. **Validação de Tamanho de Requisições**: Requisições muito grandes podem causar problemas. Limites de tamanho devem ser configurados conforme necessário.

### Confiabilidade

1. **Dependência do KV Storage**: Dados são armazenados no Cloudflare KV. Não há backup automático. Recomenda-se implementar sincronização periódica com GitHub.

2. **Retry para KV**: Operações de KV não possuem retry automático. Falhas temporárias podem resultar em perda de dados.

3. **Processamento em Batches**: Itens são processados em batches. Falhas em um item podem afetar o processamento do batch inteiro.

4. **Dependência do GitHub API**: Se a API do GitHub estiver indisponível, os arquivos não são criados, mesmo que o item seja salvo no KV.

### Performance

1. **Cache com TTL Fixo**: O cache possui TTL fixo. Para diferentes tipos de conteúdo, TTLs diferentes seriam mais eficientes.

2. **HTML Não Comprimido**: HTML é armazenado sem compressão, ocupando mais espaço no KV e GitHub.

3. **Frontend Inline**: O HTML do frontend está inline no Worker, aumentando o tamanho do bundle.

### Manutenibilidade

1. **Schema Não Versionado**: Mudanças no schema do `Communique` podem quebrar itens antigos. Recomenda-se implementar versionamento de schema.

2. **Logs Sem Rotação**: Logs podem crescer indefinidamente. Recomenda-se implementar rotação ou limpeza periódica.

3. **Sem Testes Automatizados**: Não há testes unitários ou de integração. Recomenda-se adicionar testes para garantir qualidade.

### Escalabilidade

1. **Limite de KV**: Cloudflare KV possui limites de tamanho (25MB por valor, 100GB por namespace). Para grandes volumes, recomenda-se arquitetura distribuída.

2. **Limite de Worker CPU Time**: Workers possuem limite de CPU time por requisição. Processamento muito intensivo pode exceder limites.

3. **Monitoramento Básico**: Métricas básicas estão disponíveis. Não há alertas ou dashboards avançados.


## Licença

MIT
