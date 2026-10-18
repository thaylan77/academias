import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Ativa HTTPS autoassinado apenas no servidor de desenvolvimento (para acesso seguro à câmera no smartphone)
    ...(command === 'serve' ? [basicSsl()] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Vários testes esperam ciclos reais (totem, renovação de sessão, telas
    // carregadas sob demanda). Com a máquina carregada, 5 s não bastavam; o
    // limite maior não esconde erro, porque cada teste confere o resultado.
    testTimeout: 15_000,
  },
}));
