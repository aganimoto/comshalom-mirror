# 📧 Configuração do Resend (Alternativa Gratuita)

## Por que Resend?

- ✅ **3.000 emails/mês grátis** (suficiente para a maioria dos casos)
- ✅ **Sem configuração DNS** (não precisa de SPF)
- ✅ **Fácil de configurar** (apenas API Key)
- ✅ **Confiável e rápido**
- ✅ **Funciona imediatamente**

---

## Passo 1: Criar Conta no Resend

1. Acesse: https://resend.com
2. Clique em **Sign Up** (gratuito)
3. Crie sua conta (pode usar GitHub, Google, etc.)
4. Confirme seu email

---

## Passo 2: Obter API Key

1. Após fazer login, vá em **API Keys**
2. Clique em **Create API Key**
3. Dê um nome (ex: "ComShalom Monitor")
4. Selecione permissões: **Sending access**
5. Clique em **Add**
6. **Copie a API Key** (ela só aparece uma vez!)

A API Key começa com `re_` (ex: `re_1234567890abcdef...`)

---

## Passo 3: Configurar no Cloudflare Workers

### Via Terminal (Recomendado):

```bash
# Configurar API Key do Resend
echo "re_SUA_API_KEY_AQUI" | npx wrangler secret put RESEND_API_KEY

# Configurar provedor de email
echo "resend" | npx wrangler secret put EMAIL_PROVIDER

# Verificar se foi configurado
npx wrangler secret list
```

### Via Dashboard:

1. Acesse: https://dash.cloudflare.com
2. Workers & Pages → `comshalom-rss-monitor`
3. Settings → Variables → Add variable
4. Configure:
   - **Variable name:** `RESEND_API_KEY`
   - **Value:** Sua API Key do Resend
   - **Encrypt:** ✅
5. Adicione outra variável:
   - **Variable name:** `EMAIL_PROVIDER`
   - **Value:** `resend`
   - **Encrypt:** ❌ (não precisa criptografar)

---

## Passo 4: Configurar EMAIL_FROM

O Resend permite usar qualquer email, mas recomenda-se usar um domínio verificado.

### Opção 1: Usar domínio verificado (Recomendado)

1. No Resend Dashboard, vá em **Domains**
2. Clique em **Add Domain**
3. Digite seu domínio (ex: `tomina.ga`)
4. Siga as instruções para verificar o domínio (adicionar registros DNS)
5. Após verificar, use: `noreply@tomina.ga` ou `noreply@go.tomina.ga`

### Opção 2: Usar email de teste (Rápido)

Para testar rapidamente, você pode usar:
- `onboarding@resend.dev` (apenas para testes)
- Ou qualquer email do seu domínio verificado

Configure:
```bash
echo "noreply@go.tomina.ga" | npx wrangler secret put EMAIL_FROM
```

---

## Passo 5: Testar

1. Acesse: https://comshalom-rss-monitor.tominaga.workers.dev/admin
2. Faça login
3. Clique em **📧 Testar Email**
4. Verifique sua caixa de entrada!

---

## Variáveis Necessárias

### Obrigatórias:
- ✅ `RESEND_API_KEY` - Sua API Key do Resend
- ✅ `EMAIL_PROVIDER` - Deve ser `resend`
- ✅ `EMAIL_FROM` - Email de origem
- ✅ `EMAIL_TO` - Email(s) destinatário(s)

### Opcionais:
- `EMAIL_REPLY_TO` - Email para respostas
- `EMAIL_ENABLED` - `false` para desabilitar

---

## Comparação: Resend vs Mailchannels

| Característica | Resend | Mailchannels |
|----------------|--------|--------------|
| **Gratuito** | 3.000/mês | Ilimitado |
| **Configuração DNS** | Opcional (apenas para domínio verificado) | Obrigatório (SPF) |
| **Facilidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **API Key** | Sim | Não |
| **Funciona imediatamente** | ✅ Sim | ⚠️ Precisa configurar SPF |

---

## Troubleshooting

### Erro: "RESEND_API_KEY não configurado"

Verifique se a API Key foi configurada:
```bash
npx wrangler secret list | grep RESEND
```

### Erro: "Invalid API key"

- Verifique se copiou a API Key completa
- Certifique-se de que começa com `re_`
- Gere uma nova API Key se necessário

### Email não chega?

1. Verifique a pasta de **Spam**
2. Verifique os logs: `npm run tail`
3. Verifique se o domínio está verificado no Resend (se usar domínio próprio)

---

## Limites Gratuitos

- **3.000 emails/mês** (100 emails/dia)
- Suficiente para a maioria dos casos
- Se precisar de mais, planos começam em $20/mês

---

## Próximos Passos

1. ✅ Crie conta no Resend
2. ✅ Obtenha API Key
3. ✅ Configure no Cloudflare Workers
4. ✅ Teste o envio
5. ✅ Verifique sua caixa de entrada

**Pronto!** Seu sistema de email estará funcionando! 🎉

