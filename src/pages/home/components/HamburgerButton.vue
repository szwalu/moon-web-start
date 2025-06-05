<script setup lang="ts">
import { useSettingStore } from '@/stores/setting'

// 确保路径正确

const settingStore = useSettingStore()

function handleClick() {
  settingStore.toggleSideNav()
}
</script>

<template>
  <button
    class="hamburger-button"
    aria-label="Toggle Menu"
    @click="handleClick"
  >
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  </button>
</template>

<style scoped>
.hamburger-button {
  background: none;
  border: none;
  padding: 8px; /* 给按钮一些可点击区域 */
  cursor: pointer;
  display: inline-flex; /* 让SVG图标在按钮内正确对齐 */
  align-items: center;
  justify-content: center;
  color: inherit; /* 让SVG图标颜色继承父元素的颜色 */
}

.hamburger-button svg {
  display: block; /* 移除SVG可能带有的额外空间 */
}

/* 您可以根据需要添加:hover和:focus的样式 */
.hamburger-button:hover {
  opacity: 0.7;
}
</style>
