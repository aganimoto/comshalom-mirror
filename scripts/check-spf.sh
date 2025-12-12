#!/bin/bash

# Script para verificar configuração SPF do Mailchannels
# Uso: ./check-spf.sh tomina.ga

if [ -z "$1" ]; then
    echo "❌ Uso: ./check-spf.sh <dominio>"
    echo "Exemplo: ./check-spf.sh tomina.ga"
    exit 1
fi

DOMAIN=$1

echo "🔍 Verificando SPF para: $DOMAIN"
echo ""

# Verifica registro TXT
echo "📋 Registros TXT encontrados:"
dig +short TXT $DOMAIN | grep -i spf

echo ""
echo "🔎 Verificando se inclui relay.mailchannels.net:"

SPF_RECORD=$(dig +short TXT $DOMAIN | grep -i "relay.mailchannels.net")

if [ -z "$SPF_RECORD" ]; then
    echo "❌ SPF do Mailchannels NÃO encontrado!"
    echo ""
    echo "📝 Configure o seguinte registro TXT no DNS:"
    echo "   Tipo: TXT"
    echo "   Nome: @ (ou subdomínio)"
    echo "   Valor: v=spf1 include:relay.mailchannels.net ~all"
else
    echo "✅ SPF do Mailchannels encontrado!"
    echo "   $SPF_RECORD"
    echo ""
    echo "✅ Configuração correta! Você pode testar o email agora."
fi

echo ""
echo "💡 Dica: Se você configurou SPF em um subdomínio (ex: go.tomina.ga),"
echo "   execute: ./check-spf.sh go.tomina.ga"


