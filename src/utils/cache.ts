// Cache API utilities para Cloudflare Workers

/**
 * Cachea uma resposta usando Cache API do Workers
 */
export async function cacheResponse(
  cache: Cache | null,
  request: Request,
  response: Response,
  ttl: number = 300 // 5 minutos padrão
): Promise<Response> {
  if (!cache) {
    return response;
  }

  try {
    // Cria uma nova resposta clonável
    const responseToCache = response.clone();
    
    // Adiciona headers de cache
    const headers = new Headers(responseToCache.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.set('CF-Cache-Status', 'MISS'); // Será atualizado pelo Workers
    
    const cachedResponse = new Response(responseToCache.body, {
      status: responseToCache.status,
      statusText: responseToCache.statusText,
      headers
    });

    // Cachea a resposta (não bloqueia)
    cache.put(request, cachedResponse).catch(err => {
      console.error('Erro ao cachear resposta:', err);
    });

    return response;
  } catch (error) {
    // Se falhar, retorna resposta original
    return response;
  }
}

/**
 * Tenta buscar do cache primeiro
 */
export async function getCachedResponse(
  cache: Cache | null,
  request: Request
): Promise<Response | null> {
  if (!cache) {
    return null;
  }

  try {
    const cached = await cache.match(request);
    if (cached) {
      // Adiciona header indicando que veio do cache
      const headers = new Headers(cached.headers);
      headers.set('CF-Cache-Status', 'HIT');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
  } catch (error) {
    // Ignora erros de cache
  }

  return null;
}

/**
 * Cria uma chave de cache baseada em URL e headers relevantes
 */
export function createCacheKey(url: string, headers?: Record<string, string>): Request {
  const cacheUrl = new URL(url);
  
  // Adiciona headers relevantes à URL para criar chave única
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      cacheUrl.searchParams.append(`_h_${key}`, value);
    });
  }

  return new Request(cacheUrl.toString(), {
    method: 'GET',
    headers: headers || {}
  });
}

