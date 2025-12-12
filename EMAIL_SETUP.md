# 📧 Guia de Configuração de Email - Passo a Passo

## Pré-requisitos
- Domínio próprio (ex: `tomina.ga` ou subdomínio)
- Acesso ao painel DNS do seu provedor de domínio
- Acesso ao Cloudflare Workers Dashboard

---

## Passo 1: Escolher o domínio para EMAIL_FROM

Você precisa escolher um domínio ou subdomínio para usar no `EMAIL_FROM`. Exemplos:
- `noreply@tomina.ga`
- `notificacoes@tomina.ga`
- `comshalom@tomina.ga`
- `noreply@go.tomina.ga`

**Recomendação:** Use um subdomínio específico como `noreply@go.tomina.ga` ou crie um novo subdomínio como `mail@tomina.ga`

---

## Passo 2: Configurar SPF no DNS

### 2.1. Acessar o painel DNS

1. Acesse o painel do seu provedor de DNS (Cloudflare, Namecheap, GoDaddy, etc.)
2. Localize a seção de **DNS Records** ou **Registros DNS**

### 2.2. Adicionar registro TXT (SPF)

**Se você usa Cloudflare:**
1. Vá em **DNS** → **Records**
2. Clique em **Add record**
3. Configure:
   - **Type:** `TXT`
   - **Name:** `@` (para o domínio raiz) ou o subdomínio (ex: `go` para `go.tomina.ga`)
   - **Content:** `v=spf1 include:relay.mailchannels.net ~all`
   - **TTL:** `Auto` ou `3600`
4. Clique em **Save**

**Se você usa outro provedor:**
1. Adicione um registro **TXT**
2. **Host/Name:** `@` (domínio raiz) ou subdomínio
3. **Value/Content:** `v=spf1 include:relay.mailchannels.net ~all`
4. Salve o registro

### 2.3. Verificar propagação

Aguarde 5-15 minutos e verifique se o SPF está propagado:

```bash
# No terminal, execute:
dig TXT tomina.ga
# ou
nslookup -type=TXT tomina.ga
```

Você deve ver algo como:
```
"v=spf1 include:relay.mailchannels.net ~all"
```

---

## Passo 3: Configurar variáveis no Cloudflare Workers

### 3.1. Acessar o Dashboard

1. Acesse: https://dash.cloudflare.com
2. Vá em **Workers & Pages**
3. Selecione seu Worker: `comshalom-rss-monitor`

### 3.2. Configurar EMAIL_FROM

1. Vá em **Settings** → **Variables**
2. Clique em **Add variable**
3. Configure:
   - **Variable name:** `EMAIL_FROM`
   - **Value:** `noreply@go.tomina.ga` (ou o email que você escolheu)
4. Clique em **Save**

### 3.3. Configurar EMAIL_TO

1. Clique em **Add variable** novamente
2. Configure:
   - **Variable name:** `EMAIL_TO`
   - **Value:** Seu email pessoal (ex: `seu-email@gmail.com`)
   - **Múltiplos emails:** Separe por vírgula (ex: `email1@gmail.com,email2@outlook.com`)
3. Clique em **Save**

### 3.4. (Opcional) Configurar EMAIL_REPLY_TO

1. Clique em **Add variable**
2. Configure:
   - **Variable name:** `EMAIL_REPLY_TO`
   - **Value:** Email para respostas (ex: `contato@tomina.ga`)
3. Clique em **Save**

---

## Passo 4: Verificar configuração

### 4.1. Verificar variáveis

No Dashboard do Cloudflare Workers, verifique se todas as variáveis estão configuradas:
- ✅ `EMAIL_FROM`
- ✅ `EMAIL_TO`
- ✅ (Opcional) `EMAIL_REPLY_TO`

### 4.2. Testar envio

1. Acesse: https://comshalom-rss-monitor.tominaga.workers.dev/admin
2. Faça login
3. Clique em **📧 Testar Email**
4. Verifique sua caixa de entrada

---

## Passo 5: Troubleshooting

### Erro 401 ainda aparece?

1. **Verifique se o SPF está propagado:**
   ```bash
   dig TXT tomina.ga
   ```

2. **Aguarde mais tempo:** DNS pode levar até 48h (geralmente 5-30 minutos)

3. **Verifique o domínio do EMAIL_FROM:**
   - O domínio do `EMAIL_FROM` deve ser o mesmo onde você configurou o SPF
   - Exemplo: Se `EMAIL_FROM=noreply@go.tomina.ga`, configure SPF em `go.tomina.ga`

### Email não chega?

1. Verifique a pasta de **Spam/Lixo Eletrônico**
2. Verifique os logs do Worker:
   ```bash
   npm run tail
   ```
3. Verifique se `EMAIL_TO` está correto

### SPF não funciona?

Se você não tem acesso ao DNS ou não pode configurar SPF, considere:
- Usar um serviço alternativo (SendGrid, Resend, etc.)
- Usar um email de um provedor que já tem SPF configurado

---

## Exemplo Completo

### DNS (Cloudflare):
```
Type: TXT
Name: go
Content: v=spf1 include:relay.mailchannels.net ~all
TTL: Auto
```

### Cloudflare Workers Variables:
```
EMAIL_FROM = noreply@go.tomina.ga
EMAIL_TO = seu-email@gmail.com
EMAIL_REPLY_TO = contato@tomina.ga (opcional)
```

---

## Próximos Passos

Após configurar:
1. ✅ Aguarde propagação DNS (5-30 minutos)
2. ✅ Configure as variáveis no Cloudflare Workers
3. ✅ Teste o envio via painel admin
4. ✅ Verifique sua caixa de entrada

**Pronto!** Seu sistema de email estará funcionando. 🎉

