# ComShalom RSS Monitor

Sistema automatizado de monitoramento de feeds RSS desenvolvido com Cloudflare Workers. Processa comunicados específicos do ComShalom, armazena conteúdo no Cloudflare KV Storage, realiza commits automáticos no GitHub, envia notificações por email e push notifications para dispositivos móveis.

## Badges

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-Enabled-orange.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)

## Visão Geral

Solução serverless que monitora feeds RSS, detecta comunicados relevantes através de filtros configuráveis, armazena cópias completas do conteúdo HTML, realiza commits automáticos no GitHub e notifica usuários via email e push notifications.

### Problema que Resolve

O sistema resolve a necessidade de monitoramento automatizado de comunicados específicos publicados em feeds RSS, fornecendo:

- Detecção automática de novos comunicados em intervalos configuráveis
- Armazenamento persistente e versionamento via GitHub
- Múltiplos canais de notificação (email e push)
- Interface web para visualização e busca de comunicados
- Prevenção de duplicatas e otimização de performance

### Principais Funcionalidades

- Monitoramento automatizado via cron triggers (execução a cada 15 minutos)
- Suporte a múltiplos feeds RSS configuráveis
- Filtragem inteligente por similaridade de texto (algoritmo Levenshtein Distance)
- Filtro temporal configurável para processar posts a partir de data específica
- Armazenamento persistente em Cloudflare KV Storage
- Prevenção de duplicatas baseada em hash SHA-256
- Integração com GitHub API para commits automáticos
- Notificações por email via Mailchannels ou Resend
- Notificações push para dispositivos móveis via Service Worker
- Interface web responsiva construída com SolidJS
- API REST com endpoints administrativos protegidos
- Sistema de cache para otimização de requisições
- Rate limiting configurável por IP
- Sanitização HTML para segurança

### Público-Alvo

Este projeto é direcionado a:

- Desenvolvedores que necessitam monitorar feeds RSS automaticamente
- Organizações que precisam de sistema de notificações para comunicados importantes
- Equipes que requerem versionamento automático de conteúdo web
- Profissionais que buscam solução serverless escalável e econômica

## Requisitos do Sistema

### Linguagens e Frameworks

- **Node.js**: Versão 18 ou superior
- **TypeScript**: Versão 5.3 ou superior
- **Bun**: Versão mais recente (para desenvolvimento do frontend, opcional - npm também funciona)

### Dependências de Sistema Operacional

Compatível com:
- macOS 10.15 ou superior
- Linux (Ubuntu 20.04+, Debian 10+, ou equivalente)
- Windows 10 ou superior (via WSL2 recomendado)

### Requisitos de Hardware

Mínimos:
- 4 GB RAM
- 2 GB espaço em disco
- Conexão com internet para deployment e desenvolvimento

### Serviços Externos Necessários

- **Conta Cloudflare**: Conta gratuita ou paga com Workers habilitado
- **Conta GitHub**: Para armazenamento de arquivos e GitHub Pages
- **Domínio opcional**: Para configuração de CNAME e domínio customizado
- **Provedor de email**: Mailchannels (integrado) ou Resend (opcional)

### Ferramentas de Desenvolvimento

- **npm** ou **yarn** ou **bun**: Gerenciador de pacotes
- **Git**: Controle de versão
- **Wrangler CLI**: Versão 4.x para deploy e gerenciamento de Workers

## Instalação

### Passo 1: Clonar Repositório

```bash
git clone https://github.com/aganimoto/comshalom-mirror.git
cd comshalom-mirror
```

### Passo 2: Instalar Dependências

Instale as dependências do projeto principal:

```bash
npm install
```

Instale as dependências do frontend:

```bash
cd frontend
bun install
# ou
npm install
cd ..
```

### Passo 3: Instalar Wrangler CLI

Instale o Wrangler CLI globalmente:

```bash
npm install -g wrangler
```

### Passo 4: Autenticação Cloudflare

Autentique-se no Cloudflare:

```bash
wrangler login
```

Siga as instruções no navegador para autorizar o acesso.

### Passo 5: Configurar KV Namespace

Crie o namespace KV para armazenamento de comunicados:

```bash
# Namespace de produção
wrangler kv:namespace create "COMMUNIQUE_STORE"
```

Copie o ID retornado e atualize `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "COMMUNIQUE_STORE"
id = "ID_RETORNADO"
preview_id = "ID_RETORNADO"  # Será atualizado no próximo passo
```

Crie o namespace de preview para desenvolvimento local:

```bash
wrangler kv:namespace create "COMMUNIQUE_STORE" --preview
```

Atualize `preview_id` em `wrangler.toml` com o ID retornado.

### Passo 6: Configurar Variáveis de Ambiente

Configure as variáveis obrigatórias:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_REPO_OWNER
wrangler secret put GITHUB_REPO_NAME
```

Configure variáveis opcionais conforme necessário (consulte seção Configuração).

## Configuração

### Arquivos de Configuração

#### wrangler.toml

Arquivo principal de configuração do Cloudflare Worker:

```toml
name = "comshalom-rss-monitor"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "COMMUNIQUE_STORE"
id = "SEU_NAMESPACE_ID"
preview_id = "SEU_PREVIEW_ID"

[triggers]
crons = ["*/15 * * * *"]  # Executa a cada 15 minutos
```

#### tsconfig.json

Configuração do TypeScript para compilação e type checking:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2021"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Variáveis de Ambiente

#### Variáveis Obrigatórias

| Variável | Descrição | Como Obter |
|----------|-----------|------------|
| `GITHUB_TOKEN` | Token de acesso do GitHub | [GitHub Settings > Tokens](https://github.com/settings/tokens) |
| `GITHUB_REPO_OWNER` | Proprietário do repositório | Seu usuário ou organização no GitHub |
| `GITHUB_REPO_NAME` | Nome do repositório | Nome do repositório onde os arquivos serão commitados |

#### Variáveis Opcionais

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `ADMIN_KEY` | - | Chave para autenticação nas rotas administrativas |
| `EMAIL_FROM` | - | Email de origem para notificações |
| `EMAIL_TO` | - | Emails destinatários (separados por vírgula) |
| `EMAIL_ENABLED` | `false` | Habilitar/desabilitar emails (`true` ou `false`) |
| `EMAIL_REPLY_TO` | - | Email para reply-to |
| `EMAIL_PROVIDER` | `mailchannels` | Provedor: `mailchannels` ou `resend` |
| `RESEND_API_KEY` | - | API Key do Resend (necessário se `EMAIL_PROVIDER=resend`) |
| `CUSTOM_DOMAIN` | - | Domínio customizado do GitHub Pages |
| `PATTERNS` | `discernimentos` | Padrões de busca (separados por vírgula, use `*` para todos) |
| `RSS_FEEDS` | `https://comshalom.org/feed/` | URLs de feeds RSS (separadas por vírgula) |
| `MIN_DATE` | `2025-09-01T00:00:00Z` | Data mínima no formato ISO |
| `BATCH_SIZE` | `5` | Tamanho do batch (1-10) |
| `MAX_CONCURRENCY` | `3` | Máximo de itens processados em paralelo (1-10) |
| `RATE_LIMIT_ENABLED` | `true` | Habilitar rate limiting (`true` ou `false`) |
| `VAPID_PUBLIC_KEY` | - | Chave pública VAPID para Web Push |
| `VAPID_PRIVATE_KEY` | - | Chave privada VAPID para Web Push |

### Configuração de Ambientes

#### Desenvolvimento

Para desenvolvimento local, configure os secrets de preview:

```bash
wrangler secret put GITHUB_TOKEN --env dev
```

#### Produção

Configure os secrets para produção:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_REPO_OWNER
wrangler secret put GITHUB_REPO_NAME
```

### Configuração do GitHub Token

#### Personal Access Token (Classic)

1. Acesse: https://github.com/settings/tokens
2. Clique em "Generate new token (classic)"
3. Defina escopo `repo` (acesso completo a repositórios)
4. Copie o token gerado

#### Fine-Grained Personal Access Token

1. Acesse: https://github.com/settings/tokens?type=beta
2. Clique em "Generate new token"
3. Configure acesso ao repositório específico
4. Permissões necessárias:
   - **Contents**: Read and write
   - **Metadata**: Read-only
5. Copie o token gerado

### Configuração de Cron Trigger

Edite `wrangler.toml` para ajustar o intervalo de execução:

```toml
[triggers]
crons = ["*/15 * * * *"]  # A cada 15 minutos
```

Formato: `minuto hora dia mês dia-da-semana`

Exemplos:
- `*/15 * * * *` - A cada 15 minutos
- `0 */1 * * *` - A cada hora
- `0 9 * * *` - Diariamente às 9h
- `0 9 * * 1-5` - Dias úteis às 9h

## Uso

### Execução Local

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

O servidor estará disponível em `http://localhost:8787`.

### Teste Manual

Verifique a saúde do Worker:

```bash
curl http://localhost:8787/health
```

Execute processamento RSS manualmente:

```bash
curl http://localhost:8787/test
```

### Rotas Administrativas

Listar comunicados:

```bash
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/list
```

Visualizar comunicado específico:

```bash
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/view/ID_DO_COMUNICADO
```

Obter estatísticas:

```bash
curl -H "X-ADMIN-KEY: sua-chave" http://localhost:8787/admin/stats
```

### Comandos Principais

```bash
# Desenvolvimento
npm run dev                    # Inicia servidor de desenvolvimento
npm run frontend:dev           # Inicia frontend em modo desenvolvimento

# Build
npm run frontend:build         # Compila frontend para produção

# Deploy
npm run deploy                 # Faz deploy do Worker para produção
npm run tail                   # Monitora logs em tempo real
```

### Casos de Uso Comuns

#### Processar Todos os Posts

Configure a variável de ambiente:

```bash
wrangler secret put PATTERNS
# Valor: "*"
```

#### Múltiplos Feeds RSS

```bash
wrangler secret put RSS_FEEDS
# Valor: "https://comshalom.org/feed/,https://outro-feed.com/rss"
```

#### Ajustar Performance

```bash
# Tamanho do batch
wrangler secret put BATCH_SIZE
# Valor: "10"

# Máxima concorrência
wrangler secret put MAX_CONCURRENCY
# Valor: "5"
```

## Arquitetura

### Diagrama de Arquitetura

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

### Stack Tecnológica

#### Backend

- **Cloudflare Workers**: Runtime serverless para execução do código
- **TypeScript**: Linguagem de programação
- **itty-router**: Roteamento HTTP para Workers
- **Cloudflare KV**: Armazenamento de chave-valor
- **GitHub API**: Versionamento e armazenamento de arquivos

#### Frontend

- **SolidJS**: Framework JavaScript reativo
- **TypeScript**: Type safety
- **Vite**: Build tool e dev server
- **CSS Modules**: Estilização modular

#### Infraestrutura

- **GitHub Pages**: Hospedagem estática do frontend
- **Cloudflare Workers**: Execução serverless
- **Cloudflare KV**: Persistência de dados
- **Mailchannels/Resend**: Envio de emails

### Padrões de Design

- **Singleton Pattern**: Configuração centralizada
- **Factory Pattern**: Geração de respostas HTTP otimizadas
- **Strategy Pattern**: Múltiplos provedores de email
- **Repository Pattern**: Abstração de acesso ao KV Storage
- **Observer Pattern**: Sistema de notificações

### Estrutura de Diretórios

```
comshalom-mirror/
├── src/                        # Código fonte do Worker
│   ├── index.ts               # Entry point e rotas principais
│   ├── types.ts               # Definições de tipos TypeScript
│   └── utils/                 # Utilitários
│       ├── cache.ts           # Cache API utilities
│       ├── config.ts          # Configuração centralizada
│       ├── logger.ts          # Logging estruturado
│       ├── rateLimit.ts       # Rate limiting
│       ├── rssParser.ts       # Parser RSS
│       ├── sanitize.ts        # Sanitização HTML
│       ├── webpush.ts         # Web Push utilities
│       └── workers.ts         # Otimizações específicas Workers
├── frontend/                   # Aplicação frontend
│   ├── src/
│   │   ├── components/        # Componentes React/SolidJS
│   │   ├── routes/            # Rotas da aplicação
│   │   ├── hooks/             # Custom hooks
│   │   ├── api.ts             # Cliente API
│   │   └── index.tsx          # Entry point
│   ├── public/                # Assets estáticos
│   ├── package.json
│   └── vite.config.ts
├── public/                     # Assets para GitHub Pages
│   ├── index.html
│   ├── sw.js                  # Service Worker
│   └── assets/                # Arquivos compilados
├── pages/                      # Páginas HTML dos comunicados
├── scripts/                    # Scripts auxiliares
│   ├── check-spf.sh          # Verificação de configuração SPF
│   ├── setup-email.sh        # Configuração de email
│   └── verify-email-config.sh # Verificação de configuração de email
├── package.json
├── tsconfig.json
├── wrangler.toml
├── CNAME                       # Configuração de domínio customizado
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

## API/Endpoints

### Endpoints Públicos

#### GET /health

Verifica o status do Worker e conectividade com serviços externos.

**Resposta:**

```json
{
  "status": "ok",
  "timestamp": "2025-12-12T10:00:00.000Z",
  "kv": "connected",
  "github": "configured"
}
```

**Códigos de Status HTTP:**
- `200 OK`: Worker operacional
- `500 Internal Server Error`: Erro de conectividade

#### GET /test

Executa processamento RSS manualmente (útil para testes).

**Resposta:**

```json
{
  "success": true,
  "message": "RSS processado com sucesso",
  "stats": {
    "processed": 10,
    "new": 2,
    "skipped": 8
  }
}
```

**Códigos de Status HTTP:**
- `200 OK`: Processamento iniciado
- `500 Internal Server Error`: Erro no processamento

### Endpoints Administrativos

Todos os endpoints administrativos requerem header `X-ADMIN-KEY`.

#### GET /admin/list

Lista todos os comunicados salvos com suporte a paginação e busca.

**Headers:**
- `X-ADMIN-KEY`: Chave de autenticação (obrigatório)

**Query Parameters:**
- `limit` (opcional): Número de itens por página (padrão: 50, máximo: 100)
- `cursor` (opcional): Cursor para paginação
- `search` (opcional): Termo de busca (busca no título)

**Exemplo de Requisição:**

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
      "title": "Comunicado sobre Discernimentos",
      "url": "https://comshalom.org/comunicado",
      "timestamp": "2025-12-12T10:00:00.000Z",
      "githubUrl": "https://github.com/user/repo/blob/main/pages/uuid.html",
      "publicUrl": "https://go.tomina.ga/pages/uuid-slug.html"
    }
  ]
}
```

**Códigos de Status HTTP:**
- `200 OK`: Lista retornada com sucesso
- `401 Unauthorized`: Chave de autenticação inválida ou ausente
- `500 Internal Server Error`: Erro ao recuperar dados

#### GET /admin/view/:id

Visualiza HTML completo de um comunicado específico.

**Headers:**
- `X-ADMIN-KEY`: Chave de autenticação (obrigatório)

**Path Parameters:**
- `id`: ID do comunicado (hash SHA-256)

**Exemplo de Requisição:**

```bash
curl -H "X-ADMIN-KEY: sua-chave" \
     "https://worker.workers.dev/admin/view/abc123..."
```

**Resposta:**

HTML formatado com wrapper profissional incluindo:
- Headers e metadados
- Estilos CSS inline
- Conteúdo sanitizado do comunicado
- Links para fonte original e GitHub

**Códigos de Status HTTP:**
- `200 OK`: HTML retornado com sucesso
- `401 Unauthorized`: Chave de autenticação inválida
- `404 Not Found`: Comunicado não encontrado
- `500 Internal Server Error`: Erro ao recuperar comunicado

#### GET /admin/stats

Retorna estatísticas do sistema.

**Headers:**
- `X-ADMIN-KEY`: Chave de autenticação (obrigatório)

**Exemplo de Requisição:**

```bash
curl -H "X-ADMIN-KEY: sua-chave" \
     "https://worker.workers.dev/admin/stats"
```

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

**Códigos de Status HTTP:**
- `200 OK`: Estatísticas retornadas
- `401 Unauthorized`: Chave de autenticação inválida
- `500 Internal Server Error`: Erro ao calcular estatísticas

### Endpoints de Notificações Push

#### GET /api/push/check

Verifica se há nova notificação (usado pelo Service Worker para polling).

**Headers:**
- `X-Last-Check` (opcional): Timestamp da última verificação em milissegundos

**Exemplo de Requisição:**

```bash
curl -H "X-Last-Check: 1702380000000" \
     "https://worker.workers.dev/api/push/check"
```

**Resposta:**

```json
{
  "hasNew": true,
  "notification": {
    "title": "Novo Comunicado Detectado",
    "body": "Título do comunicado",
    "url": "https://go.tomina.ga/pages/uuid-slug.html",
    "icon": "/icon-192x192.png",
    "timestamp": 1702380000000
  }
}
```

**Códigos de Status HTTP:**
- `200 OK`: Resposta retornada
- `204 No Content`: Não há novas notificações (quando `hasNew: false`)

## Testes

### Estratégia de Testes

Atualmente, o projeto utiliza testes manuais devido à natureza serverless e integrações externas. A estratégia recomendada inclui:

- **Testes Unitários**: Funções utilitárias isoladas
- **Testes de Integração**: Fluxos completos com mocks
- **Testes End-to-End**: Cenários reais com ambiente de staging

### Executar Testes Manualmente

#### Teste de Conectividade

```bash
curl http://localhost:8787/health
```

#### Teste de Processamento RSS

```bash
curl http://localhost:8787/test
```

#### Teste de Autenticação

```bash
curl -H "X-ADMIN-KEY: chave-invalida" http://localhost:8787/admin/list
# Deve retornar 401
```

### Cobertura de Testes

A implementação de testes automatizados está planejada para versões futuras. Atualmente, a cobertura é garantida através de:

- Testes manuais em ambiente de desenvolvimento
- Validação de fluxos críticos em produção
- Monitoramento de logs e métricas

## Deploy

### Requisitos de Infraestrutura

- Conta Cloudflare com Workers habilitado
- Repositório GitHub configurado
- KV Namespace criado e configurado
- Secrets configurados via Wrangler CLI

### Processo de Deploy

#### Passo 1: Build do Frontend

```bash
npm run frontend:build
```

Isso compila o frontend e copia os arquivos para a pasta `public/`.

#### Passo 2: Commit e Push

```bash
git add public/ index.html assets/
git commit -m "build: atualizar frontend"
git push origin main
```

#### Passo 3: Deploy do Worker

```bash
npm run deploy
```

O Worker será deployado e estará disponível em:
`https://comshalom-rss-monitor.SUBDOMINIO.workers.dev`

### Configurações Específicas de Produção

#### Registrar Subdomínio workers.dev

Antes do primeiro deploy:

1. Acesse: https://dash.cloudflare.com
2. Navegue para Workers & Pages → Overview
3. Registre um subdomínio workers.dev

#### Configurar Secrets em Produção

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put ADMIN_KEY
wrangler secret put EMAIL_FROM
# ... outras variáveis conforme necessário
```

#### Verificar Deploy

Verifique os logs em tempo real:

```bash
npm run tail
```

### Monitoramento e Logs

#### Logs em Tempo Real

```bash
npm run tail
```

#### Logs Estruturados

Todos os logs são estruturados em JSON com:

```json
{
  "timestamp": "2025-12-12T10:00:00.000Z",
  "level": "info",
  "message": "Mensagem do log",
  "metadata": {
    "key": "value"
  }
}
```

#### Métricas

Acesse `/admin/stats` para estatísticas do sistema:
- Total de comunicados
- Comunicados com commit no GitHub
- Último processamento
- Timestamp da consulta

## Manutenção

### Procedimentos de Backup

#### Backup do KV Storage

O KV Storage é automaticamente sincronizado com o GitHub através de commits automáticos. Para backup manual:

1. Liste todas as chaves: `wrangler kv:key list --namespace-id ID`
2. Recupere valores individuais: `wrangler kv:key get CHAVE --namespace-id ID`
3. Exporte para arquivo JSON conforme necessário

#### Backup do GitHub

O repositório GitHub é a fonte de verdade principal. Para backup:

```bash
git clone https://github.com/USER/REPO.git
```

### Atualizações de Dependências

#### Atualizar Dependências do Worker

```bash
npm outdated
npm update
npm audit fix
```

#### Atualizar Dependências do Frontend

```bash
cd frontend
bun outdated
bun update
cd ..
```

#### Atualizar Wrangler CLI

```bash
npm install -g wrangler@latest
```

### Troubleshooting Comum

#### KV namespace not found

**Problema:** Erro ao acessar KV namespace.

**Solução:**
1. Verificar ID do namespace em `wrangler.toml`
2. Confirmar criação: `wrangler kv:namespace list`
3. Verificar binding: `wrangler kv:key list --namespace-id ID`

#### GitHub API error: 401

**Problema:** Token inválido ou sem permissões.

**Solução:**
1. Verificar token: `wrangler secret list`
2. Testar token:
   ```bash
   curl -H "Authorization: token TOKEN" https://api.github.com/user
   ```
3. Verificar permissões do token (deve ter `repo` ou `Contents: Read and write`)

#### GitHub API error: 404

**Problema:** Repositório não encontrado.

**Solução:**
1. Verificar `GITHUB_REPO_OWNER` e `GITHUB_REPO_NAME`
2. Confirmar existência do repositório
3. Verificar acesso do token ao repositório

#### Cron não executa

**Problema:** Cron Trigger não está executando.

**Solução:**
1. Cron Triggers operam apenas em produção
2. Verificar logs: `wrangler tail`
3. Verificar configuração no Cloudflare Dashboard
4. Confirmar formato do cron em `wrangler.toml`

#### Email não enviado

**Problema:** Notificações por email não são enviadas.

**Solução:**
1. Verificar `EMAIL_FROM` e `EMAIL_TO`
2. Consultar logs: `wrangler tail`
3. Para produção, configurar registros SPF/DKIM no domínio de origem
4. Verificar formato dos emails (devem ser válidos)

#### Notificações push não funcionam

**Problema:** Notificações push não aparecem no dispositivo.

**Solução:**
1. Verificar se está usando HTTPS (necessário para Service Workers)
2. Verificar permissão de notificações no navegador
3. Verificar se Service Worker está registrado (DevTools > Application > Service Workers)
4. Verificar console do navegador para erros
5. Confirmar que `/sw.js` está acessível

#### Erro de CORS

**Problema:** Erro de CORS ao acessar API do frontend.

**Solução:**
1. Verificar origem permitida no código
2. Verificar header `Origin` nas requisições
3. Confirmar que frontend e Worker estão no mesmo domínio ou configurados corretamente

## Contribuição

Contribuições são bem-vindas. Por favor, consulte o arquivo [CONTRIBUTING.md](CONTRIBUTING.md) para diretrizes detalhadas.

### Processo de Contribuição

1. Fork o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'feat: adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

### Padrões de Código

- Siga os padrões TypeScript definidos no projeto
- Use Conventional Commits para mensagens de commit
- Mantenha a documentação atualizada
- Adicione comentários para lógica complexa

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para mais detalhes.

## Versionamento

Este projeto segue [Semantic Versioning](https://semver.org/lang/pt-BR/) (SemVer).

Formato: `MAJOR.MINOR.PATCH`

- **MAJOR**: Mudanças incompatíveis na API
- **MINOR**: Adição de funcionalidades compatíveis
- **PATCH**: Correções de bugs compatíveis

Consulte [CHANGELOG.md](CHANGELOG.md) para histórico detalhado de versões.

## Licença

Este projeto está licenciado sob a Licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.

## Autores e Contato

### Autor

Eduardo Tominaga

### Canais de Comunicação

- **Issues**: [GitHub Issues](https://github.com/aganimoto/comshalom-mirror/issues)
- **Discussions**: [GitHub Discussions](https://github.com/aganimoto/comshalom-mirror/discussions)

### Documentação Adicional

- [CHANGELOG.md](CHANGELOG.md) - Histórico de versões
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guia de contribuição
- [LICENSE](LICENSE) - Licença do projeto

### Referências

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [GitHub API Documentation](https://docs.github.com/en/rest)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [SolidJS Documentation](https://www.solidjs.com/docs/latest)
