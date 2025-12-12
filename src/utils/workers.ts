// Utilities específicas para Cloudflare Workers

/**
 * Otimiza Levenshtein Distance para Workers (limita CPU time)
 */
export function optimizedLevenshtein(str1: string, str2: string, maxDistance?: number): number {
  const m = str1.length;
  const n = str2.length;
  
  // Early return se diferença de tamanho for muito grande
  if (maxDistance && Math.abs(m - n) > maxDistance) {
    return maxDistance + 1;
  }
  
  // Usa apenas duas linhas ao invés de matriz completa (otimização de memória)
  let prev: number[] = Array(n + 1).fill(0).map((_, i) => i);
  let curr: number[] = Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = Math.min(
          prev[j] + 1,      // deletion
          curr[j - 1] + 1,  // insertion
          prev[j - 1] + 1   // substitution
        );
      }
      
      // Early exit se distância já exceder maxDistance
      if (maxDistance && curr[j] > maxDistance) {
        return maxDistance + 1;
      }
    }
    
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Processa array em chunks para evitar sobrecarga de memória
 */
export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processor: (chunk: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await processor(chunk);
    results.push(...chunkResults);
  }
  
  return results;
}

/**
 * Valida tamanho de dados antes de processar (limite Workers: 128MB memória)
 */
export function validateSize(data: string | ArrayBuffer, maxSizeMB: number = 10): boolean {
  const sizeBytes = typeof data === 'string' 
    ? new TextEncoder().encode(data).length 
    : data.byteLength;
  const sizeMB = sizeBytes / (1024 * 1024);
  return sizeMB <= maxSizeMB;
}

/**
 * Cria resposta com headers otimizados para Workers
 */
export function createOptimizedResponse(
  body: string | ReadableStream | null,
  options: ResponseInit = {}
): Response {
  const headers = new Headers(options.headers);
  
  // Headers de performance
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  
  // Cache headers para conteúdo estático
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=300'); // 5 minutos
  }
  
  return new Response(body, {
    ...options,
    headers
  });
}

/**
 * Monitora CPU time usado (aproximado)
 */
export class CPUTimeMonitor {
  private startTime: number;
  private maxTime: number;

  constructor(maxTimeMs: number = 50000) { // 50s (limite Workers: 50ms CPU time por request)
    this.startTime = Date.now();
    this.maxTime = maxTimeMs;
  }

  check(): boolean {
    const elapsed = Date.now() - this.startTime;
    return elapsed < this.maxTime;
  }

  getElapsed(): number {
    return Date.now() - this.startTime;
  }
}

