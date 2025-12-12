# Frontend Solid.js - ComShalom RSS Monitor

Frontend moderno e responsivo desenvolvido com **Solid.js** para visualização de comunicados do ComShalom.

## 🚀 Tecnologias

- **Solid.js**: Framework reativo moderno e performático
- **Vite**: Build tool ultra-rápida
- **TypeScript**: Tipagem estática
- **CSS Modules**: Estilos organizados por componente

## ✨ Características

- **100% Responsivo**: Funciona perfeitamente em mobile, tablet e desktop
- **Design Moderno**: Interface limpa e profissional
- **Performance**: Renderização reativa eficiente do Solid.js
- **Busca em Tempo Real**: Filtro instantâneo de comunicados
- **Auto-refresh**: Atualiza automaticamente a cada 5 minutos
- **Estados de Loading**: Feedback visual durante carregamento
- **Tratamento de Erros**: Mensagens claras em caso de falha

## 📦 Instalação

```bash
# Na raiz do projeto
npm run frontend:install
# ou
cd frontend && bun install
```

## 🛠️ Desenvolvimento

```bash
# Na raiz do projeto
npm run frontend:dev
# ou
cd frontend && bun run dev
```

Servidor de desenvolvimento disponível em `http://localhost:3000`.

## 🏗️ Build para Produção

```bash
# Na raiz do projeto
npm run frontend:build
# ou
cd frontend && bun run build
```

O build gera os arquivos estáticos na pasta `../public` para deploy no GitHub Pages.

**Importante**: O build sobrescreve o `index.html` antigo na pasta `public/`. Certifique-se de fazer backup se necessário.

## ⚙️ Variáveis de Ambiente

Criar arquivo `frontend/.env.local` (opcional):

```env
VITE_WORKER_URL=https://comshalom-rss-monitor.tominaga.workers.dev
VITE_ADMIN_KEY=sh1982
```

Se não configurado, usa valores padrão:
- **Worker URL**: Detecta automaticamente (localhost em dev, produção em prod)
- **Admin Key**: `sh1982` (padrão)

## 📱 Responsividade

O frontend é totalmente responsivo com breakpoints:
- **Desktop**: Layout em grid com múltiplas colunas
- **Tablet**: Grid adaptativo
- **Mobile**: Layout em coluna única, botões full-width

## 🎨 Design System

Usa variáveis CSS para cores e espaçamentos:
- Cores neutras (cinza, preto, branco)
- Espaçamentos consistentes
- Bordas arredondadas
- Sombras sutis
- Transições suaves

## 🔄 Integração com Backend

O frontend consome a API do Cloudflare Worker:
- Endpoint: `/admin/list`
- Autenticação: Header `X-ADMIN-KEY`
- Formato: JSON com paginação

## 📂 Estrutura

```
frontend/
├── src/
│   ├── components/      # Componentes reutilizáveis
│   │   ├── CommuniqueCard.tsx
│   │   ├── Stats.tsx
│   │   ├── Loading.tsx
│   │   └── ErrorMessage.tsx
│   ├── routes/          # Rotas/páginas
│   │   └── Home.tsx
│   ├── api.ts           # Cliente API
│   ├── App.tsx          # Componente raiz
│   └── index.tsx        # Entry point
├── public/              # Assets estáticos
├── index.html           # HTML template
├── vite.config.ts       # Configuração Vite
└── package.json
```

## 🚢 Deploy

1. Build do frontend: `npm run frontend:build`
2. Commit e push: `git add public/ && git commit && git push`
3. GitHub Pages serve automaticamente da pasta `public/`

O frontend funciona como SPA (Single Page Application) e é servido estaticamente pelo GitHub Pages.

