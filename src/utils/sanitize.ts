// Sanitização de HTML e texto

/**
 * Escapa caracteres HTML para prevenir XSS
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Sanitiza HTML removendo scripts, iframes perigosos e normalizando URLs
 */
export function sanitizeHTML(html: string, baseUrl?: string): string {
  let sanitized = html;
  
  // Remove scripts
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');
  
  // Remove iframes perigosos (mantém apenas se necessário)
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove javascript: URLs
  sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  sanitized = sanitized.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""');
  
  // Normaliza URLs relativas para absolutas (se baseUrl fornecido)
  if (baseUrl) {
    try {
      const base = new URL(baseUrl);
      // Converte URLs relativas em absolutas para imagens e links
      sanitized = sanitized.replace(
        /(src|href)\s*=\s*["']([^"']+)["']/gi,
        (match, attr, url) => {
          if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
            return match; // Já é absoluta
          }
          if (url.startsWith('/')) {
            return `${attr}="${base.origin}${url}"`;
          }
          return `${attr}="${base.origin}${base.pathname.replace(/\/[^/]*$/, '/')}${url}"`;
        }
      );
    } catch (e) {
      // Se baseUrl for inválido, ignora
    }
  }
  
  return sanitized;
}

/**
 * Valida e limpa URL
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Permite apenas http e https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}


