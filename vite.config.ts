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

// ✅ 新增

export default defineConfig({
  /**
   * 👇 当为项目配置了自定义域名后，网站将从该域名的根目录提供服务。
   * 因此 base 应该设置为 '/'。
   */
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
    // ✅ PWA 插件（最小可用配置）
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // 使用 public/manifest.webmanifest，避免双处配置冲突
      includeAssets: [
        'favicon.ico',
        'logo.jpg',
        'icons/apple-touch-icon-180.png',
        'icons/pwa-192.png',
        'icons/pwa-512.png',
        'icons/maskable-512.png',
      ],
      workbox: {
        // SPA 回退，确保直接打开 /auth 等路由能返回 index.html
        navigateFallback: '/index.html',
      },
      devOptions: {
        enabled: false, // 仅生产启用 SW，避免本地调试被缓存影响
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
