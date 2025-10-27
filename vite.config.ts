import path from 'node:path'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import Pages from 'vite-plugin-pages'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import VueMacros from 'unplugin-vue-macros/vite'
import Unocss from 'unocss/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import { visualizer } from 'rollup-plugin-visualizer'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  plugins: [
    Vue(),
    Unocss(),
    Pages(),
    VueMacros(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia', '@vueuse/core', 'vue/macros'],
      dts: 'src/auto-imports.d.ts',
      dirs: ['src/composables', 'src/stores'],
      vueTemplate: true,
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dirs: ['src/components/**'],
      extensions: ['vue', 'tsx'],
      dts: 'src/components.d.ts',
    }),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
    VueI18n({
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
      include: [path.resolve(__dirname, 'src/locales/**')],
    }),

    // ✅ 仅使用 injectManifest，明确 sw 源文件为 src/sw.ts
    VitePWA({
      strategies: 'injectManifest',
      injectManifest: {
        // 用绝对路径最稳，避免 CI 环境解析偏差
        swSrc: path.resolve(__dirname, 'src/sw.ts'),
        // 最终产物名（输出到 dist/）
        swDest: 'sw.js',
      },

      // 自动注册 + dev 用你的 sw.ts（非 dev-sw）
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },

      // 你的 manifest
      manifest: {
        name: '我abc网址导航',
        short_name: '云笔记',
        start_url: '/auth',
        scope: '/',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: '云笔记', short_name: 'Auth', url: '/auth' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~': path.resolve(__dirname, './'),
    },
  },
  server: {
    port: 1888,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:1889',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/api/, ''),
      },
    },
  },
})
