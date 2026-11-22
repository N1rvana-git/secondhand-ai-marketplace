import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendTarget = 'http://localhost:8000'

// react-markdown 的依赖树很长（unified / micromark / mdast / hast ...），
// 统一收进 markdown-vendor，避免散落进首屏 chunk。
const markdownChunkPatterns = [
  '/react-markdown/',
  '/remark-',
  '/rehype-',
  '/unified/',
  '/micromark',
  '/mdast-',
  '/hast-',
  '/unist-',
  '/vfile',
  '/property-information/',
  '/space-separated-tokens/',
  '/comma-separated-tokens/',
  '/decode-named-character-reference/',
  '/character-entities',
  '/trim-lines/',
  '/devlop/',
  '/bail/',
  '/trough/',
  '/is-plain-obj/',
  '/zwitch/',
  '/longest-streak/',
  '/ccount/',
  '/escape-string-regexp/',
  '/html-url-attributes/',
  '/style-to-object/',
  '/estree-',
  '/markdown-table/',
  '/github-slugger/',
  '/mdurl/',
]

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  const normalized = id.replace(/\\/g, '/')

  if (normalized.includes('/lucide-react/')) return 'lucide-vendor'
  if (
    markdownChunkPatterns.some((pattern) => normalized.includes(pattern))
  ) {
    return 'markdown-vendor'
  }
  if (normalized.includes('/@radix-ui/')) return 'radix-vendor'
  if (
    /\/react\/|\/react-dom\/|\/react-router|\/scheduler\//.test(normalized)
  ) {
    return 'react-vendor'
  }
  return 'vendor'
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/static': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
