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
    <div class="about-container">
      <!-- 关闭按钮：放在页面（卡片）内部右上角 -->
      <RouterLink to="/" class="close-btn-in-card" role="button" aria-label="Close and go home">×</RouterLink>

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

  /* ✅ 新增：让这一页自己撑满全屏，并使用全站主题背景色 */
  min-height: 100vh;
  background-color: var(--main-bg-c);
}

/* 让按钮能相对卡片绝对定位 */
.about-container {
  position: relative;
}

/* 放在卡片内部右上角的关闭按钮（非 fixed，不会飘在页面外） */
.close-btn-in-card {
  position: absolute;
  top: 12px;
  right: 12px;

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
.close-btn-in-card:active { transform: scale(0.98); }
@media (prefers-color-scheme: dark) {
  .close-btn-in-card {
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
  margin: 4rem auto; /* 增加上下边距，让卡片更居中 */
  padding: 2.5rem 3rem; /* 调整内边距 */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.8;

  /* 2. 将内容区设计成卡片 */
  background-color: #ffffff;
  border-radius: 12px; /* 圆角 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); /* 微妙的阴影 */
  transition: background-color 0.3s ease, color 0.3s ease;

  /* 3. 优化基础字体 */
  font-size: 15px; /* 提高基础字号，增强可读性 */
  color: #34495e; /* 使用更柔和的深灰色 */
}

.title {
  display: block;
  text-align: center;
  font-weight: 700;
  font-size: 4.5rem; /* <<-- 已将主标题调大 */
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
  padding: 1rem; /* 为列表项增加内边距 */
  border-radius: 8px; /* 列表项也加圆角 */
  transition: background-color 0.2s ease;
}

.features li:hover {
  background-color: #f8f9fa;
}

.features li .icon::before {
  content: '•';
  font-size: 1.2em;
  line-height: 1.5;
  margin-right: 2.5rem; /* 调整为更合理的间距 */
  position: relative;
  top: 0.15em; /* 微调图标垂直位置，使其与文本更对齐 */
}

.features li .text {
  flex: 1;
}

.thanks {
  text-align: center; /* 居中 */
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e9ecef; /* 分割线 */
  font-size: 3.5rem; /* <<-- 已将“特别感谢”区域字体调大 */
  font-weight: 500;
  color: #868e96;
}

.thanks div {
  display: inline-block;
  margin: 0 0.5em; /* 调整致谢名单的间距 */
}

/* 移动端适配 */
@media (max-width: 600px) {
  .about-container {
    margin: 2rem 1rem;
    padding: 2rem 1.5rem;
    font-size: 17px; /* <<-- 在这里调整移动端正文基础字体大小 */
    line-height: 1.5; /* <<-- 在这里调整移动端行距 */
  }
  .title {
    font-size: 5.5rem; /* <<-- 同样增大了移动端的主标题 */
  }
  .thanks {
    font-size: 3.0rem; /* <<-- 调整移动端“特别感谢”字体大小 */
  }
}

/* 暗黑模式适配 */
@media (prefers-color-scheme: dark) {
  :global(body) {
    background-color: #1a1b1e; /* 更深的背景 */
  }

  .about-container {
    background-color: #2d2d2d; /* 卡片背景 */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    color: #c8d6e5; /* 更柔和的亮灰色文字 */
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
