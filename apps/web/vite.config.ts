import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // caminhos relativos: funciona em localhost e em usuario.github.io/AnaliseFut/
  base: './',
  server: { host: true },
});
