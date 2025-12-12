// Parser RSS melhorado com tratamento de edge cases

import type { RSSItem } from '../types';
import { logger } from './logger';
import { sanitizeUrl } from './sanitize';

/**
 * Remove CDATA e decodifica entidades HTML
 */
function cleanText(text: string): string {
  // Remove CDATA
  let cleaned = text.replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1');
  
  // Decodifica entidades HTML básicas
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
  
  return cleaned.trim();
}

/**
 * Extrai conteúdo de tag XML, suportando múltiplos formatos
 */
function extractTagContent(xml: string, tagName: string): string | null {
  // Tenta diferentes variações de formato
  const patterns = [
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*\\/>`, 'i'), // Self-closing
  ];
  
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match && match[1]) {
      return cleanText(match[1]);
    }
  }
  
  return null;
}

/**
 * Parse RSS feed com tratamento robusto de erros
 */
export async function parseRSSFeed(url: string, retries = 2): Promise<RSSItem[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ComShalomRSSMonitor/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty RSS feed response');
      }

      const items: RSSItem[] = [];
      
      // Suporta tanto RSS quanto Atom
      const isAtom = text.includes('<feed') || text.includes('xmlns="http://www.w3.org/2005/Atom"');
      
      if (isAtom) {
        // Parse Atom feed
        const entryMatches = text.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi);
        for (const match of entryMatches) {
          const entryContent = match[1];
          const title = extractTagContent(entryContent, 'title');
          const link = extractTagContent(entryContent, 'link') || 
                      entryContent.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ||
                      extractTagContent(entryContent, 'id');
          const pubDate = extractTagContent(entryContent, 'published') || 
                         extractTagContent(entryContent, 'updated');
          const description = extractTagContent(entryContent, 'summary') || 
                             extractTagContent(entryContent, 'content');
          
          if (title && link) {
            const sanitizedLink = sanitizeUrl(link);
            if (sanitizedLink) {
              items.push({
                title: cleanText(title),
                link: sanitizedLink,
                pubDate: pubDate || '',
                description: description || ''
              });
            }
          }
        }
      } else {
        // Parse RSS feed (formato tradicional)
        const itemMatches = text.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
        
        for (const match of itemMatches) {
          const itemContent = match[1];
          
          const title = extractTagContent(itemContent, 'title');
          const link = extractTagContent(itemContent, 'link') || 
                      extractTagContent(itemContent, 'guid');
          const pubDate = extractTagContent(itemContent, 'pubDate') || 
                         extractTagContent(itemContent, 'date');
          const description = extractTagContent(itemContent, 'description') || 
                             extractTagContent(itemContent, 'content:encoded');
          
          if (title && link) {
            const sanitizedLink = sanitizeUrl(link);
            if (sanitizedLink) {
              items.push({
                title: cleanText(title),
                link: sanitizedLink,
                pubDate: pubDate || '',
                description: description || ''
              });
            } else {
              logger.warn('Invalid URL in RSS item', { link, title });
            }
          }
        }
      }

      if (items.length === 0) {
        logger.warn('No items found in RSS feed', { url, attempt });
      }

      return items;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('RSS parse attempt failed', { url, attempt, error: errorMessage });
      
      if (attempt === retries) {
        throw new Error(`Failed to fetch RSS after ${retries + 1} attempts: ${errorMessage}`);
      }
      
      // Backoff exponencial
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  
  throw new Error('Failed to fetch RSS after retries');
}



