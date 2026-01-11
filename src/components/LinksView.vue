<script setup lang="ts">
import { useRouter } from 'vue-router'

// 1. 引入 useI18n
import { useI18n } from 'vue-i18n'

const router = useRouter()
// 2. 解构出 t 函数
const { t } = useI18n()

function goBack() {
  // 使用 Vue 路由跳转，保持在 capacitor://localhost 环境内
  router.push('/auth')
}
</script>

<template>
  <div class="iframe-container">
    <div class="floating-back-btn" @click="goBack">
      <span class="icon">⬅️</span>
      <span class="text">{{ t('notes.back') }}</span>
    </div>

    <iframe
      src="https://www.woabc.com/"
      class="full-iframe"
      frameborder="0"
    />
  </div>
</template>

<style scoped>
.iframe-container {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #fff;
  display: flex;
  flex-direction: column;
}

/* 悬浮按钮样式 */
.floating-back-btn {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  left: 12px;
  z-index: 2000;

  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;

  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
  backdrop-filter: blur(4px);
  transition: transform 0.1s;
}

.floating-back-btn:active {
  transform: scale(0.95);
  background-color: rgba(0, 0, 0, 0.9);
}

.full-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
