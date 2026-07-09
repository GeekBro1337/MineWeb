import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
    fs: {
      // The client imports shared types/constants from ../shared.
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
  },
});
