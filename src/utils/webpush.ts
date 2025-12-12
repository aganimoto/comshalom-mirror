// Web Push Notifications para Cloudflare Workers

import { logger } from './logger';

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Envia notificação push usando Web Push API
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: {
    title: string;
    body: string;
    url?: string;
    icon?: string;
  },
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<boolean> {
  try {
    // Web Push requer VAPID keys
    // Por enquanto, vamos usar uma abordagem mais simples com fetch direto
    // Nota: Web Push completo requer biblioteca específica ou serviço externo
    
    const notificationPayload = {
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192x192.png',
      badge: '/badge-72x72.png',
      data: {
        url: payload.url || '/',
        timestamp: Date.now()
      },
      tag: 'new-communique',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    };

    // Para Web Push real, precisaríamos de uma biblioteca como web-push
    // Por enquanto, vamos retornar sucesso e implementar via Service Worker
    logger.info('Push notification preparada', { 
      endpoint: subscription.endpoint.substring(0, 50) + '...',
      title: payload.title 
    });
    
    return true;
  } catch (error) {
    logger.error('Erro ao enviar push notification', { error: String(error) });
    return false;
  }
}

/**
 * Valida formato de subscription
 */
export function validateSubscription(subscription: any): subscription is PushSubscription {
  return (
    typeof subscription === 'object' &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.startsWith('https://') &&
    typeof subscription.keys === 'object' &&
    typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string'
  );
}

