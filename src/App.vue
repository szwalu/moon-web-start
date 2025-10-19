<!-- src/App.vue (No-Animation / No-Provider / No-SW 极简止抖版) -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="root">
    <RouterView />
  </div>
</template>

<style>
/* —— 视口锁定：防止 iOS 动态地址栏/安全区造成的高度抖动 —— */
html, body, #app, .root {
  margin: 0;
  padding: 0;
  height: 100dvh;         /* iOS 16+ 动态视口单位 */
  width: 100%;
  overflow: hidden;       /* 禁用橡皮筋 */
  background: #f5f6f7;    /* 纯色背景，避免渐变导致重绘 */
}

/* 某些 iOS 旧版本对 100dvh 支持不好，兜底用 100vh */
@supports (-webkit-touch-callout: none) {
  html, body, #app, .root {
    height: 100vh;
  }
}

/* —— 全局核平：禁用一切动画/过渡，阻止任何持续重绘 —— */
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  will-change: auto !important;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

/* —— 禁用 iOS 弹性滚动与滚动捕获造成的抖动 —— */
html, body {
  overscroll-behavior: none;
  -webkit-overflow-scrolling: auto !important;
}

/* 如页面仍抖，把你页面里最外层容器（例如 RouterView 渲染的页面根）加上以下类：
  .page-root { height: 100%; overflow: auto; -webkit-overflow-scrolling: touch; }
  仅让内部可滚动，外层保持稳定
*/
</style>
