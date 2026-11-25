import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Vite does not copy .env values into process.env for its own config file, so
  // API_PROXY_TARGET in apps/web/.env is invisible here without loadEnv. The ''
  // prefix lets it read non-VITE_ keys; they are not exposed to client code.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxying keeps the dev server same-origin with the API, which takes CORS
      // out of the picture entirely while developing.
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
