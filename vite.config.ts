// vite.config.ts (最终修正版)

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
    // ✅ PWA 插件（内联生成 manifest）
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [
        '/icons/pwa-192.png',
        '/icons/pwa-512.png',
        '/icons/maskable-512.png',
      ],
      manifest: {
        name: '我abc网址导航',
        short_name: '我abc',
        start_url: '/', // 主图标=主页
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
          { name: '直达笔记', short_name: '笔记', url: '/auth' }, // 安卓长按快捷
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // ⛔️ 关键：不要用 SPA 壳兜底 /notes.html（否则我们的静态跳转页不会被返回）
        navigateFallbackDenylist: [
          /^\/notes\.html$/i,
          // 若你以后还想保留目录版本，也一并挡掉：
          /^\/notes\/?$/i,
          /^\/notes\/index\.html$/i,
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
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
