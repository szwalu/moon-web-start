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
      manifest: {
        name: '我abc网址导航',
        short_name: '星云笔记',
        start_url: '/auth', // ← 改这里
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
          { name: '星云笔记', short_name: 'Auth', url: '/auth' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // ⬇️ 新增：运行时缓存图片（CacheFirst）
        runtimeCaching: [
          // 1) Supabase Storage 公网地址（替换成你的项目域名即可通配）
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/note-images\/.+/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'note-images',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 2) 如果你把图片反代到同域（如 https://woabc.com/note-images/...），也缓存
          {
            urlPattern: /\/note-images\/.+/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'note-images-same-origin',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
