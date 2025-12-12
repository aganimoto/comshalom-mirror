// Rate limiting básico usando KV

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const RATE_LIMIT_MAX = 100; // Requisições por hora
const RATE_LIMIT_WINDOW = 3600; // 1 hora em segundos

/**
 * Verifica rate limit para um IP
 */
export async function checkRateLimit(
  kv: KVNamespace,
  identifier: string
): Promise<RateLimitResult> {
  const key = `rate_limit:${identifier}`;
  
  try {
    const data = await kv.get(key);
    const now = Math.floor(Date.now() / 1000);
    
    if (!data) {
      // Primeira requisição
      await kv.put(key, JSON.stringify({ count: 1, resetAt: now + RATE_LIMIT_WINDOW }), {
        expirationTtl: RATE_LIMIT_WINDOW
      });
      return {
        allowed: true,
        remaining: RATE_LIMIT_MAX - 1,
        resetAt: now + RATE_LIMIT_WINDOW
      };
    }
    
    const parsed = JSON.parse(data) as { count: number; resetAt: number };
    
    if (now >= parsed.resetAt) {
      // Janela expirada, resetar
      await kv.put(key, JSON.stringify({ count: 1, resetAt: now + RATE_LIMIT_WINDOW }), {
        expirationTtl: RATE_LIMIT_WINDOW
      });
      return {
        allowed: true,
        remaining: RATE_LIMIT_MAX - 1,
        resetAt: now + RATE_LIMIT_WINDOW
      };
    }
    
    if (parsed.count >= RATE_LIMIT_MAX) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: parsed.resetAt
      };
    }
    
    // Incrementar contador
    await kv.put(
      key,
      JSON.stringify({ count: parsed.count + 1, resetAt: parsed.resetAt }),
      { expirationTtl: parsed.resetAt - now }
    );
    
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - parsed.count - 1,
      resetAt: parsed.resetAt
    };
  } catch (error) {
    // Em caso de erro, permite a requisição (fail open)
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX,
      resetAt: Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW
    };
  }
}

/**
 * Extrai identificador do request (IP ou outro)
 */
export function getRequestIdentifier(request: Request): string {
  // Tenta pegar o IP do header CF-Connecting-IP (Cloudflare)
  const ip = request.headers.get('CF-Connecting-IP') || 
             request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
             'unknown';
  return ip;
}


