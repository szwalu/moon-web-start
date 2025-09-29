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
    <!-- 顶部关闭按钮（返回首页） -->
    <RouterLink to="/" class="close-btn" role="button" aria-label="Close and go home">×</RouterLink>

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
  /* 旧 iOS: constant() ；新 iOS: env() */
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
}

/* 右上角关闭按钮（保证足够大，易点） */
.close-btn {
  position: fixed;
  /* 使用 max() 确保在无刘海设备也有合适内边距 */
  top: max(10px, constant(safe-area-inset-top));
  top: max(10px, env(safe-area-inset-top));
  right: 12px;
  z-index: 1000;

  width: 44px;
  height: 44px;
  line-height: 44px;
  text-align: center;

  font-size: 28px;
  font-weight: 600;
  color: #666;
  text-decoration: none;

  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  backdrop-filter: saturate(180%) blur(8px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.close-btn:active { transform: scale(0.98); }
@media (prefers-color-scheme: dark) {
  .close-btn {
    color: #ddd;
    background: rgba(30, 30, 30, 0.9);
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
  margin: 4rem auto;
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
  .about-container {
    margin: 2rem 1rem;
    padding: 2rem 1.5rem;
    font-size: 17px;
    line-height: 1.5;
  }
  .title {
    font-size: 5.5rem;
  }
  .thanks {
    font-size: 3.0rem;
  }
}

/* 暗黑模式适配 */
@media (prefers-color-scheme: dark) {
  :global(body) {
    background-color: #1a1b1e;
  }

  .about-container {
    background-color: #2d2d2d;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    color: #c8d6e5;
  }

  .title {
    color: #ffffff;
  }

  .features li .icon::before {
    content: '🌟';
  }

  .features li:hover {
    background-color: #3a3a3a;
  }

  .thanks {
    border-top-color: #4a4a4a;
    color: #7a7a7a;
  }
}
</style>
