<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

defineOptions({
  name: 'TheFooter',
})

// --- 动态版权年份 ---
const currentYear = computed(() => new Date().getFullYear())

// --- 动态运行时间 ---
const runningTime = ref('')
let timerId: number | null = null
const BootDate = new Date('2025/05/25 20:00:00')

function updateRunningTime() {
  const NowDate = new Date()
  const RunDateM = NowDate.getTime() - BootDate.getTime()

  const RunDays = Math.floor(RunDateM / (24 * 3600 * 1000))
  const RunHours = Math.floor((RunDateM % (24 * 3600 * 1000)) / (3600 * 1000))
  const RunMinutes = Math.floor((RunDateM % (3600 * 1000)) / (60 * 1000))
  const RunSeconds = Math.floor((RunDateM % (60 * 1000)) / 1000)

  runningTime.value
  = `${RunDays}${t('time_units.days')}`
  + `${RunHours}${t('time_units.hours')}`
  + `${RunMinutes}${t('time_units.minutes')}`
  + `${RunSeconds}${t('time_units.seconds')}`
}

onMounted(() => {
  updateRunningTime()
  timerId = window.setInterval(updateRunningTime, 1000)
})

onUnmounted(() => {
  if (timerId)
    clearInterval(timerId)
})
</script>

<template>
  <footer class="site-footer my-8 flex flex-col items-center gap-y-4">
    <div class="text-content text-center leading-relaxed">
      <p>
        {{ $t('footer.disclaimer') }}
        <a href="https://sc81arzvs0.jiandaoyun.com/f/6844d2a9944452e16eeb5e26" target="_blank">
          {{ $t('footer.contactLink') }}
        </a>
      </p>
      <p>
        <span>{{ $t('Alreadyrunning') }}</span>
        <span class="font-mono">{{ runningTime }}</span>
      </p>
      <p>
        <span>© 2023 - {{ currentYear }} By&nbsp;</span>
        <a href="https://www.woabc.com/" target="_blank" rel="noopener noreferrer" class="footer-link">WOabc</a>
        <span>&nbsp;|&nbsp;</span>
        <a href="https://github.com/jic999/moon-web-start" target="_blank" rel="noopener noreferrer" class="footer-link">Jic999</a>
      </p>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  font-size: 14px;
  color: rgb(107 114 128);
  opacity: 0.9;
}

.dark .site-footer {
  color: rgb(156 163 175);
}

.site-footer p {
  margin: 4px 0;
}

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* 3. 新增链接样式 */
.footer-link {
  color: inherit; /* 继承父元素的颜色，看起来不像默认的蓝色链接 */
  text-decoration: none; /* 移除默认的下划线 */
  transition: color 0.2s ease, text-decoration 0.2s ease; /* 添加过渡效果 */
}

.footer-link:hover {
  text-decoration: underline; /* 鼠标悬浮时显示下划线 */
  color: var(--primary-c); /* 鼠标悬浮时变为您的主题色 */
}
</style>
