<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const { t } = useI18n()

const features = computed(() => {
  const keys = [
    'efficientNav',
    'freedomEdit',
    'dragSort',
    'smartSearch',
    'responsive',
    'themeSwitch',
    'darkMode',
    'i18nSupport',
    'importExport',
    'browserPlugin',
    'dockerSupport',
  ]
  return keys.map(key => t(`about.${key}`))
})
</script>

<template>
  <div class="page-safearea">
    <!-- 页眉：固定在卡片右上角的关闭按钮 -->
    <div class="about-header">
      <div class="header-spacer" />
      <RouterLink to="/" class="close-btn" role="button" aria-label="Close and go home">×</RouterLink>
    </div>

    <div class="about-container">
      <h1 class="title">{{ t('about.title') }}</h1>

      <ul class="features">
        <li v-for="(item, index) in features" :key="index">
          <span class="icon" />
          <span class="text" v-html="item.replace(/\n/g, '<br>')" />
        </li>
      </ul>

      <div class="thanks">
        <div>{{ t('about.thanks') }}：</div>
        <div>jic999</div>
        <div>Gemini</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 顶部安全区容器：避免内容顶进刘海区 */
.page-safearea {
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
}

/* 页眉：右上角固定在布局里（非悬浮覆盖） */
.about-header {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 3rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  /* 与 about-container 的左右内边距保持一致，使按钮对齐卡片右侧 */
}

/* 关闭按钮样式（不使用 position: fixed） */
.close-btn {
  display: inline-block;
  width: 44px;
  height: 44px;
  line-height: 44px;
  text-align: center;

  font-size: 28px;
  font-weight: 600;
  color: #666;
  text-decoration: none;

  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
.close-btn:active { transform: scale(0.98); }
@media (prefers-color-scheme: dark) {
  .close-btn {
    color: #ddd;
    background: #2a2a2a;
    border-color: rgba(255,255,255,0.08);
  }
}

/* 1. 给整个页面设置一个背景色 */
:global(body) {
  background-color: #f0f2f5;
  transition: background-color 0.3s ease;
}

.about-container {
  max-width: 720px;
  margin: 1rem auto 4rem; /* 顶部留一点距离给 header */
  padding: 2.5rem 3rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.8;

  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: background-color 0.3s ease, color 0.3s ease;

  font-size: 15px;
  color: #34495e;
}

.title {
  display: block;
  text-align: center;
  font-weight: 700;
  font-size: 4.5rem;
  margin-bottom: 3.5rem;
  color: #2c3e50;
  transition: color 0.3s ease;
}

.features {
  list-style: none;
  padding: 0;
  margin-bottom: 2rem;
}

.features li {
  display: flex;
  align-items: flex-start;
  margin-bottom: 1rem;
  padding: 1rem;
  border-radius: 8px;
  transition: background-color 0.2s ease;
}

.features li:hover {
  background-color: #f8f9fa;
}

.features li .icon::before {
  content: '•';
  font-size: 1.2em;
  line-height: 1.5;
  margin-right: 2.5rem;
  position: relative;
  top: 0.15em;
}

.features li .text {
  flex: 1;
}

.thanks {
  text-align: center;
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e9ecef;
  font-size: 3.5rem;
  font-weight: 500;
  color: #868e96;
}

.thanks div {
  display: inline-block;
  margin: 0 0.5em;
}

/* 移动端适配 */
@media (max-width: 600px) {
  .about-header { padding: 0 1.5rem; }
  .about-container {
    margin: 1rem 1rem 2rem;
    padding: 2rem 1.5rem;
    font-size: 17px;
    line-height: 1.5;
  }
  .title { font-size: 5.5rem; }
  .thanks { font-size: 3.0rem; }
}

/* 暗黑模式适配 */
@media (prefers-color-scheme: dark) {
  :global(body) { background-color: #1a1b1e; }
  .about-container {
    background-color: #2d2d2d;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    color: #c8d6e5;
  }
  .title { color: #ffffff; }
  .features li .icon::before { content: '🌟'; }
  .features li:hover { background-color: #3a3a3a; }
  .thanks { border-top-color: #4a4a4a; color: #7a7a7a; }
}
</style>
