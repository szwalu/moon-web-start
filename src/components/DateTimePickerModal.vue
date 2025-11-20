<script setup lang="ts">
import { ref } from 'vue'
import { DatePicker } from 'v-calendar'
import 'v-calendar/dist/style.css'
import { useDark } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  initialDate: {
    type: Date,
    default: () => new Date(),
  },
})

const emit = defineEmits(['close', 'confirm'])

const selectedDate = ref(new Date(props.initialDate))
const isDark = useDark()
const { locale } = useI18n()

function formatCalendarHeaderTitle(rawTitle: string) {
  if (!rawTitle)
    return rawTitle

  const parts = rawTitle.split(' ')
  if (parts.length !== 2)
    return rawTitle

  const [monthText, yearText] = parts
  if (!/^\d{4}$/.test(yearText))
    return rawTitle

  // 支持把“十一月 2025”解析出月份数字
  const zhMonthMap: Record<string, number> = {
    一月: 1,
    二月: 2,
    三月: 3,
    四月: 4,
    五月: 5,
    六月: 6,
    七月: 7,
    八月: 8,
    九月: 9,
    十月: 10,
    十一月: 11,
    十二月: 12,
  }

  const monthNum = zhMonthMap[monthText]
  if (!monthNum)
    return rawTitle

  const yearNum = Number(yearText)
  const d = new Date(yearNum, monthNum - 1, 1)
  const lang = String(locale.value || '').toLowerCase()

  // 中文：固定成“2025年11月”
  if (lang.startsWith('zh'))
    return `${yearText}年${monthNum}月`

  // 非中文：用当前语言格式化（英文就是“November 2025” 等）
  try {
    return new Intl.DateTimeFormat(
      lang || undefined,
      { year: 'numeric', month: 'long' },
    ).format(d)
  }
  catch {
    return rawTitle
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content">
        <DatePicker
          v-model="selectedDate"
          mode="dateTime"
          is-expanded
          is24hr
          hide-time-header
          :is-dark="isDark"
        >
          <!-- 覆盖顶部“十一月 2025”标题 -->
          <template #header-title="{ title }">
            <span class="calendar-nav-title">
              {{ formatCalendarHeaderTitle(title) }}
            </span>
          </template>
        </DatePicker>

        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('close')"> {{ t('button.cancel') }}</button>
          <button class="btn-primary" @click="emit('confirm', selectedDate)">{{ t('button.confirm') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.dark .modal-content {
  background: #2c2c2e;
}

:deep(.vc-container) {
  border: none;
  font-family: inherit;
}
.dark :deep(.vc-container) {
  background: transparent;
  color: #f0f0f0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
/* -- Reusing button styles from your app -- */
.btn-primary,
.btn-secondary {
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s;
}
.btn-primary {
  background-color: #00b386;
  color: #fff;
}
.btn-primary:hover {
  background-color: #009a74;
}
.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
}
.btn-secondary:hover {
  background-color: #e0e0e0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 顶部“2025年11月 / August 2025”等 */
.calendar-nav-title {
  font-weight: 600;
}
</style>

<style>
/* 顶部导航标题：2025年11月 / August 2025 等 */
.modal-content .vc-container .vc-header .vc-title {
  background-color: transparent !important;
  box-shadow: none !important;
}
/* 所有 v-calendar 顶部“年月 / 年份 / 中间大号 2025”统一去掉胶囊背景 */
.vc-nav-title,
.vc-nav-title.is-active {
  background-color: transparent !important;
  box-shadow: none !important;
}

/* 暗色模式下把文字调亮，避免看不清 */
.dark .vc-nav-title,
.dark .vc-nav-title.is-active {
  color: #f9fafb !important;
}
</style>
