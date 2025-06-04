<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <AppProvider>
    <AppContainer>
      <RouterView />
    </AppContainer>
  </AppProvider>
</template>

<style>
/* 默认（浅色模式）样式 */
body, html {
  /* 我们上次选定的浅灰色底色 */
  background-color: #e9ecef;

  /* 深色的网格线 */
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.06) 1px, transparent 1px);

  background-size: 25px 25px;

  /* 添加一个平滑的颜色过渡效果 */
  transition: background-color 0.3s ease;
}

/* 夜间模式样式 (关键新增部分) */
.dark body, .dark html {
  /* 1. 为夜间模式选择一个舒适的深灰色底色 */
  background-color: #1a1a1a;

  /* 2. 将网格线变为半透明的白色，以便在深色背景上可见 */
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
}
</style>
