# Guia de Contribuição

Agradecemos seu interesse em contribuir para este projeto. Este documento fornece diretrizes e padrões para contribuições.

## Código de Conduta

Este projeto segue um código de conduta profissional. Ao contribuir, você concorda em manter um ambiente respeitoso e colaborativo.

## Como Contribuir

### Reportando Bugs

Antes de reportar um bug:

1. Verifique se o bug já não foi reportado nas [Issues](../../issues)
2. Verifique se o bug persiste na versão mais recente do código
3. Consulte a seção de Troubleshooting do README.md

Ao reportar um bug, inclua:

- Descrição clara e detalhada do problema
- Passos para reproduzir o comportamento
- Comportamento esperado
- Comportamento atual observado
- Ambiente (versão do Node.js, Wrangler, sistema operacional)
- Capturas de tela ou logs relevantes (quando aplicável)

### Sugerindo Melhorias

Sugestões de melhorias são bem-vindas. Ao criar uma issue:

1. Descreva claramente a funcionalidade ou melhoria proposta
2. Explique o caso de uso e benefícios
3. Forneça exemplos de como a melhoria seria utilizada
4. Considere impactos em compatibilidade e performance

### Pull Requests

#### Processo

1. Fork o repositório
2. Crie uma branch a partir de `main` com nome descritivo:
   ```bash
   git checkout -b feature/nome-da-feature
   # ou
   git checkout -b fix/descricao-do-bug
   ```
3. Faça suas alterações seguindo os padrões de código
4. Certifique-se de que o código compila sem erros
5. Teste suas alterações localmente
6. Commit seguindo o padrão Conventional Commits
7. Push para sua branch e abra um Pull Request

#### Padrões de Código

##### TypeScript

- Use TypeScript strict mode
- Defina tipos explícitos para funções e variáveis públicas
- Evite `any`, prefira tipos específicos ou `unknown`
- Use interfaces para estruturas de dados
- Documente funções complexas com JSDoc

##### Formatação

- Use indentação de 2 espaços
- Use ponto e vírgula no final de declarações
- Use aspas simples para strings
- Quebre linhas longas (>100 caracteres) quando apropriado
- Deixe uma linha em branco entre funções

##### Nomenclatura

- Variáveis e funções: `camelCase`
- Classes e Interfaces: `PascalCase`
- Constantes: `UPPER_SNAKE_CASE`
- Arquivos: `kebab-case.ts` ou `camelCase.ts` (seguir padrão do projeto)

##### Estrutura

- Organize imports: externos primeiro, depois internos
- Agrupe funções relacionadas
- Extraia lógica complexa para funções auxiliares
- Mantenha funções pequenas e focadas (< 50 linhas quando possível)

#### Conventional Commits

Siga o padrão [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Tipos:

- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `style`: Formatação, ponto e vírgula ausente, etc (não afeta código)
- `refactor`: Refatoração de código
- `perf`: Melhoria de performance
- `test`: Adição ou correção de testes
- `chore`: Mudanças em ferramentas, dependências, etc
- `ci`: Mudanças em CI/CD

Exemplos:

```
feat(api): adicionar endpoint para estatísticas por período
fix(cache): corrigir TTL de cache para requisições administrativas
docs(readme): atualizar instruções de instalação
refactor(rss): otimizar parser de feeds RSS
```

#### Mensagem de Commit

- Use modo imperativo ("adicionar" não "adicionado")
- Primeira linha deve ter no máximo 50 caracteres
- Deixe linha em branco antes do corpo (se houver)
- Corpo deve explicar o "o que" e "por quê", não o "como"
- Referencie issues relacionadas no final

#### Testes

Embora o projeto não tenha cobertura de testes automatizados completa ainda:

- Teste manualmente suas alterações
- Verifique diferentes cenários (sucesso, erro, edge cases)
- Teste em ambiente de desenvolvimento local
- Documente casos de teste complexos no PR

#### Documentação

- Atualize README.md se necessário
- Adicione comentários para lógica complexa
- Documente novas variáveis de ambiente
- Atualize CHANGELOG.md para mudanças significativas

### Revisão de Código

Todas as contribuições passam por revisão de código. O processo:

1. Mantenedores revisam o PR
2. Feedback é fornecido via comentários
3. Alterações podem ser solicitadas
4. Após aprovação, o PR é mergeado

Diretrizes para revisores:

- Seja construtivo e respeitoso
- Explique o "por quê" de sugestões
- Aprove quando estiver satisfeito
- Marque como "request changes" se necessário

## Ambiente de Desenvolvimento

### Setup Inicial

Siga as instruções de instalação no README.md.

### Executar Localmente

```bash
# Instalar dependências
npm install
cd frontend && bun install

# Executar worker em modo desenvolvimento
npm run dev

# Executar frontend em modo desenvolvimento
npm run frontend:dev

# Build do frontend
npm run frontend:build
```

### Verificar Antes de Commitar

- Código compila sem erros: `npm run build` (se disponível)
- Linter passa (quando configurado)
- Sem logs de erro no console
- Funcionalidade testada manualmente

## Questões e Suporte

Para dúvidas ou suporte:

1. Consulte primeiro a documentação (README.md, CHANGELOG.md)
2. Busque em issues existentes
3. Crie uma nova issue se necessário

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a mesma licença do projeto (MIT License).

