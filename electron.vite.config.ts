import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { '@assets': resolve(__dirname, 'assets') }
    },
    server: { fs: { allow: [resolve(__dirname)] } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          bubble: resolve(__dirname, 'src/renderer/bubble.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
