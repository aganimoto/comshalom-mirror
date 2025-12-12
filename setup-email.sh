#!/bin/bash

# Script para configurar EMAIL_FROM e EMAIL_TO via Wrangler CLI
# Uso: ./setup-email.sh

echo "📧 Configuração de Email - Cloudflare Workers"
echo "=============================================="
echo ""

# Verifica se wrangler está disponível (local ou global)
WRANGLER_CMD=""
if command -v wrangler &> /dev/null; then
    WRANGLER_CMD="wrangler"
    echo "✅ Wrangler encontrado (global)"
elif npx wrangler --version &> /dev/null; then
    WRANGLER_CMD="npx wrangler"
    echo "✅ Wrangler encontrado (local via npx)"
else
    echo "❌ Wrangler não encontrado!"
    echo "   Instale com: npm install"
    exit 1
fi

echo ""

# Configurar EMAIL_FROM
echo "📝 Configurando EMAIL_FROM..."
echo "   Valor recomendado: noreply@go.tomina.ga"
read -p "   Digite o EMAIL_FROM (ou Enter para usar noreply@go.tomina.ga): " email_from

if [ -z "$email_from" ]; then
    email_from="noreply@go.tomina.ga"
fi

echo "   Configurando: EMAIL_FROM = $email_from"
$WRANGLER_CMD secret put EMAIL_FROM <<< "$email_from"

if [ $? -eq 0 ]; then
    echo "   ✅ EMAIL_FROM configurado com sucesso!"
else
    echo "   ❌ Erro ao configurar EMAIL_FROM"
    exit 1
fi

echo ""

# Configurar EMAIL_TO
echo "📝 Configurando EMAIL_TO..."
echo "   Digite o(s) email(s) destinatário(s)"
echo "   Para múltiplos emails, separe por vírgula"
read -p "   EMAIL_TO: " email_to

if [ -z "$email_to" ]; then
    echo "   ❌ EMAIL_TO não pode estar vazio!"
    exit 1
fi

echo "   Configurando: EMAIL_TO = $email_to"
$WRANGLER_CMD secret put EMAIL_TO <<< "$email_to"

if [ $? -eq 0 ]; then
    echo "   ✅ EMAIL_TO configurado com sucesso!"
else
    echo "   ❌ Erro ao configurar EMAIL_TO"
    exit 1
fi

echo ""

# Configurar EMAIL_REPLY_TO (opcional)
echo "📝 Configurar EMAIL_REPLY_TO? (opcional)"
read -p "   Digite o EMAIL_REPLY_TO (ou Enter para pular): " email_reply_to

if [ -n "$email_reply_to" ]; then
    echo "   Configurando: EMAIL_REPLY_TO = $email_reply_to"
    $WRANGLER_CMD secret put EMAIL_REPLY_TO <<< "$email_reply_to"
    
    if [ $? -eq 0 ]; then
        echo "   ✅ EMAIL_REPLY_TO configurado com sucesso!"
    else
        echo "   ⚠️  Erro ao configurar EMAIL_REPLY_TO (não crítico)"
    fi
else
    echo "   ⏭️  EMAIL_REPLY_TO pulado"
fi

echo ""

# Perguntar sobre provedor de email
echo "📧 Escolha o provedor de email:"
echo "   1) Resend (recomendado - fácil, sem SPF)"
echo "   2) Mailchannels (requer SPF no DNS)"
read -p "   Escolha (1 ou 2, padrão: 1): " provider_choice

if [ -z "$provider_choice" ] || [ "$provider_choice" = "1" ]; then
    provider="resend"
    echo ""
    echo "📝 Configurando Resend..."
    echo "   Você precisa de uma API Key do Resend (grátis: 3.000 emails/mês)"
    echo "   Obtenha em: https://resend.com/api-keys"
    read -p "   Digite sua RESEND_API_KEY (ou Enter para pular): " resend_key
    
    if [ -n "$resend_key" ]; then
        echo "   Configurando: RESEND_API_KEY = ${resend_key:0:10}..."
        $WRANGLER_CMD secret put RESEND_API_KEY <<< "$resend_key"
        
        if [ $? -eq 0 ]; then
            echo "   ✅ RESEND_API_KEY configurado com sucesso!"
        else
            echo "   ❌ Erro ao configurar RESEND_API_KEY"
        fi
    else
        echo "   ⏭️  RESEND_API_KEY pulado (configure depois)"
    fi
else
    provider="mailchannels"
fi

echo "   Configurando: EMAIL_PROVIDER = $provider"
$WRANGLER_CMD secret put EMAIL_PROVIDER <<< "$provider"

if [ $? -eq 0 ]; then
    echo "   ✅ EMAIL_PROVIDER configurado!"
else
    echo "   ⚠️  Erro ao configurar EMAIL_PROVIDER"
fi

echo ""
echo "=============================================="
echo "✅ Configuração concluída!"
echo ""
echo "📋 Variáveis configuradas:"
echo "   EMAIL_FROM = $email_from"
echo "   EMAIL_TO = $email_to"
if [ -n "$email_reply_to" ]; then
    echo "   EMAIL_REPLY_TO = $email_reply_to"
fi
echo "   EMAIL_PROVIDER = $provider"
if [ "$provider" = "resend" ] && [ -n "$resend_key" ]; then
    echo "   RESEND_API_KEY = ${resend_key:0:10}... (configurado)"
fi
echo ""
echo "🧪 Próximo passo: Teste o email no painel admin:"
echo "   https://comshalom-rss-monitor.tominaga.workers.dev/admin"
echo ""

