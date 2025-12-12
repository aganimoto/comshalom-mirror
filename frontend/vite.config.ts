import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: '../public',
    emptyOutDir: false,
    rollupOptions: {
      input: './index.html'
    }
  },
  base: './',
  server: {
    port: 3000,
    // Em dev, serve arquivos estáticos da pasta public do projeto principal
    fs: {
      allow: ['..']
    }
  },
  // Em desenvolvimento, Vite serve arquivos estáticos de public/
  // Em build, copia para public/ e depois para raiz via script
  publicDir: '../public'
});

