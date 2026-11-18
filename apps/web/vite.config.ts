import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { versaoBuild } from './versao-build.mjs';

export default defineConfig({
  plugins: [react()],
  // caminhos relativos: funciona em localhost e em usuario.github.io/AnaliseFut/
  base: './',
  server: { host: true },
  // versão real do build (commit e data), gravada em cada evidência (evidencias.ts)
  define: { __VERSAO_BUILD__: JSON.stringify(versaoBuild()) },
});
