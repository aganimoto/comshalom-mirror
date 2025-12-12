# 📧 Comandos para Configurar Email via Terminal

## Configuração Rápida via Terminal

### Opção 1: Script Automatizado (Recomendado)

```bash
# Dar permissão de execução (primeira vez)
chmod +x setup-email.sh

# Executar o script
./setup-email.sh
```

O script vai perguntar:
- `EMAIL_FROM` (padrão: `noreply@go.tomina.ga`)
- `EMAIL_TO` (seu email pessoal)
- `EMAIL_REPLY_TO` (opcional)

---

### Opção 2: Comandos Manuais

#### 1. Configurar EMAIL_FROM

```bash
wrangler secret put EMAIL_FROM
```

Quando solicitado, digite:
```
noreply@go.tomina.ga
```

**Ou em uma linha:**
```bash
echo "noreply@go.tomina.ga" | wrangler secret put EMAIL_FROM
```

---

#### 2. Configurar EMAIL_TO

```bash
wrangler secret put EMAIL_TO
```

Quando solicitado, digite seu email:
```
seu-email@gmail.com
```

**Para múltiplos emails (separados por vírgula):**
```bash
echo "email1@gmail.com,email2@outlook.com" | wrangler secret put EMAIL_TO
```

---

#### 3. (Opcional) Configurar EMAIL_REPLY_TO

```bash
wrangler secret put EMAIL_REPLY_TO
```

Quando solicitado, digite:
```
contato@tomina.ga
```

**Ou em uma linha:**
```bash
echo "contato@tomina.ga" | wrangler secret put EMAIL_REPLY_TO
```

---

## Verificar Variáveis Configuradas

### Listar todas as variáveis secretas:

```bash
wrangler secret list
```

Isso mostra todas as variáveis configuradas (mas não os valores, por segurança).

---

## Exemplo Completo (Uma Linha)

```bash
# Configurar tudo de uma vez
echo "noreply@go.tomina.ga" | wrangler secret put EMAIL_FROM
echo "seu-email@gmail.com" | wrangler secret put EMAIL_TO
echo "contato@tomina.ga" | wrangler secret put EMAIL_REPLY_TO
```

---

## Remover Variáveis (se necessário)

```bash
# Remover EMAIL_FROM
wrangler secret delete EMAIL_FROM

# Remover EMAIL_TO
wrangler secret delete EMAIL_TO

# Remover EMAIL_REPLY_TO
wrangler secret delete EMAIL_REPLY_TO
```

---

## Troubleshooting

### Erro: "Not logged in"

Você precisa fazer login no Wrangler:

```bash
wrangler login
```

Isso abrirá o navegador para autenticação.

---

### Erro: "No account ID found"

Verifique se você está no diretório correto do projeto e se o `wrangler.toml` está presente.

---

### Verificar se está funcionando

Após configurar, teste:

1. Acesse: https://comshalom-rss-monitor.tominaga.workers.dev/admin
2. Faça login
3. Clique em **📧 Testar Email**
4. Verifique sua caixa de entrada

---

## Resumo dos Comandos

```bash
# Login (se necessário)
wrangler login

# Configurar emails
echo "noreply@go.tomina.ga" | wrangler secret put EMAIL_FROM
echo "seu-email@gmail.com" | wrangler secret put EMAIL_TO

# Verificar
wrangler secret list

# Testar
# Acesse o painel admin e clique em "Testar Email"
```

---

## ⚠️ Importante

- As variáveis são **secretas** e **criptografadas** no Cloudflare
- Os valores não aparecem em logs ou no código
- Use `wrangler secret put` para variáveis sensíveis
- Use variáveis normais no `wrangler.toml` apenas para valores não-sensíveis

---

## Próximos Passos

1. ✅ Configure SPF no DNS (já feito para go.tomina.ga)
2. ✅ Configure EMAIL_FROM e EMAIL_TO (via terminal)
3. ✅ Teste o envio no painel admin

**Pronto!** 🎉

