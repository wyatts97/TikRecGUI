import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'lib': path.resolve(__dirname, './src/lib'),
      'components': path.resolve(__dirname, './src/components'),
      '@swc/helpers/_/_extends': path.resolve(__dirname, './node_modules/@swc/helpers/esm/_extends.js'),
      '@swc/helpers/_/_object_without_properties_loose': path.resolve(__dirname, './node_modules/@swc/helpers/esm/_object_without_properties_loose.js'),
    },
  },
  optimizeDeps: {
    include: ['react-toggle-dark-mode'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
