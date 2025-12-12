#!/bin/bash

# Script para verificar configuração completa de email
# Verifica SPF, variáveis configuradas e compatibilidade

echo "🔍 Verificação Completa de Configuração de Email"
echo "================================================"
echo ""

# Verifica SPF
echo "1️⃣ Verificando SPF para go.tomina.ga..."
SPF_CHECK=$(dig +short TXT go.tomina.ga 2>/dev/null | grep -i "relay.mailchannels.net")
if [ -n "$SPF_CHECK" ]; then
    echo "   ✅ SPF configurado corretamente"
    echo "   📋 Registro: $SPF_CHECK"
else
    echo "   ❌ SPF NÃO encontrado!"
    echo "   ⚠️  Configure: v=spf1 include:relay.mailchannels.net ~all"
fi
echo ""

# Verifica variáveis configuradas
echo "2️⃣ Verificando variáveis no Cloudflare Workers..."

WRANGLER_CMD=""
if command -v wrangler &> /dev/null; then
    WRANGLER_CMD="wrangler"
elif npx wrangler --version &> /dev/null; then
    WRANGLER_CMD="npx wrangler"
else
    echo "   ❌ Wrangler não encontrado!"
    exit 1
fi

SECRETS=$($WRANGLER_CMD secret list 2>/dev/null)

if echo "$SECRETS" | grep -q "EMAIL_FROM"; then
    echo "   ✅ EMAIL_FROM configurado"
    # Tenta extrair o valor (pode não funcionar, mas tenta)
    EMAIL_FROM_DOMAIN=$(echo "$SECRETS" | grep -A 1 "EMAIL_FROM" | grep -oE '@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | head -1 | cut -d'@' -f2 || echo "não detectado")
    if [ "$EMAIL_FROM_DOMAIN" != "não detectado" ] && [ -n "$EMAIL_FROM_DOMAIN" ]; then
        echo "   📧 Domínio detectado: $EMAIL_FROM_DOMAIN"
        if [ "$EMAIL_FROM_DOMAIN" = "go.tomina.ga" ]; then
            echo "   ✅ Domínio corresponde ao SPF configurado!"
        else
            echo "   ⚠️  Domínio diferente de go.tomina.ga"
            echo "   💡 Certifique-se de que o SPF está configurado para: $EMAIL_FROM_DOMAIN"
        fi
    fi
else
    echo "   ❌ EMAIL_FROM NÃO configurado!"
    echo "   💡 Configure com: echo 'noreply@go.tomina.ga' | $WRANGLER_CMD secret put EMAIL_FROM"
fi

if echo "$SECRETS" | grep -q "EMAIL_TO"; then
    echo "   ✅ EMAIL_TO configurado"
else
    echo "   ❌ EMAIL_TO NÃO configurado!"
    echo "   💡 Configure com: echo 'seu-email@gmail.com' | $WRANGLER_CMD secret put EMAIL_TO"
fi

if echo "$SECRETS" | grep -q "EMAIL_REPLY_TO"; then
    echo "   ✅ EMAIL_REPLY_TO configurado (opcional)"
else
    echo "   ⏭️  EMAIL_REPLY_TO não configurado (opcional)"
fi

echo ""
echo "================================================"
echo "📋 Resumo:"
echo ""

# Verifica se tudo está OK
ALL_OK=true

if [ -z "$SPF_CHECK" ]; then
    echo "   ❌ SPF não configurado"
    ALL_OK=false
fi

if ! echo "$SECRETS" | grep -q "EMAIL_FROM"; then
    echo "   ❌ EMAIL_FROM não configurado"
    ALL_OK=false
fi

if ! echo "$SECRETS" | grep -q "EMAIL_TO"; then
    echo "   ❌ EMAIL_TO não configurado"
    ALL_OK=false
fi

if [ "$ALL_OK" = true ]; then
    echo "   ✅ Tudo configurado corretamente!"
    echo ""
    echo "🧪 Próximo passo: Teste o email no painel admin:"
    echo "   https://comshalom-rss-monitor.tominaga.workers.dev/admin"
else
    echo "   ⚠️  Algumas configurações estão faltando"
    echo ""
    echo "💡 Use o script setup-email.sh para configurar:"
    echo "   ./setup-email.sh"
fi

echo ""

