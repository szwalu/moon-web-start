<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ modelValue: RangeTuple }>()

const emit = defineEmits<{ (e: 'update:modelValue', v: RangeTuple): void }>()

const { t } = useI18n()

type RangeTuple = [number, number] | null

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function ymdToTs(s: string): number {
  const parts = s.split('-')
  const y = Number.parseInt(parts[0], 10)
  const m = Number.parseInt(parts[1], 10)
  const d = Number.parseInt(parts[2], 10)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

const todayStr = toYmd(new Date())

const supportsDate = computed(() => {
  const i = document.createElement('input')
  i.setAttribute('type', 'date')
  i.value = '2024-09-12'
  const okType = i.type === 'date'
  const okValue = i.value === '2024-09-12'
  return okType && okValue
})

/** 仅移动端显示“假占位符”的判断 */
const isMobile = computed(() => {
  const ua = navigator.userAgent || ''
  const byUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  const byMQ = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  return byUA || byMQ
})

const startStr = ref<string>('')
const endStr = ref<string>('')
const startEl = ref<HTMLInputElement | null>(null)
const endEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.modelValue,
  (val) => {
    if (!val) {
      startStr.value = ''
      endStr.value = ''
      return
    }
    const s = val[0]
    const e = val[1]
    startStr.value = s ? toYmd(new Date(s)) : ''
    endStr.value = e ? toYmd(new Date(e)) : ''
  },
  { immediate: true },
)

function syncUpstream() {
  if (startStr.value && !endStr.value)
    endStr.value = startStr.value

  if (!startStr.value && endStr.value)
    startStr.value = endStr.value

  if (!startStr.value && !endStr.value) {
    emit('update:modelValue', null)
    return
  }
  const sOk = isYmd(startStr.value)
  const eOk = isYmd(endStr.value)
  if (sOk && eOk) {
    const s = ymdToTs(startStr.value)
    const e = ymdToTs(endStr.value)
    emit('update:modelValue', [s, e])
  }
}

watch([startStr, endStr], () => {
  syncUpstream()
})

function openPicker(which: 'start' | 'end') {
  const el = which === 'start' ? startEl.value : endEl.value
  requestAnimationFrame(() => {
    try {
      const anyEl = el as any
      if (anyEl && typeof anyEl.showPicker === 'function')
        anyEl.showPicker()
    }
    catch {
      // ignore
    }
  })
}

function normalizeText(which: 'start' | 'end') {
  const el = which === 'start' ? startStr : endStr
  if (!el.value)
    return

  if (!isYmd(el.value)) {
    const norm = el.value.replace(/\//g, '-')
    if (isYmd(norm))
      el.value = norm
  }
}

function setToday() {
  const t = todayStr
  startStr.value = t
  endStr.value = t
}
function setRecent(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  startStr.value = toYmd(start)
  endStr.value = toYmd(end)
}
function _clearRange() {
  startStr.value = ''
  endStr.value = ''
}
</script>

<template>
  <div class="mdrp">
    <div class="row">
      <label class="label" for="startDate">{{ t('notes.export_picker.start_label') }}</label>

      <!-- 包一层，支持“假占位符” -->
      <div class="date-wrap">
        <!-- 支持原生 date -->
        <input
          v-if="supportsDate"
          id="startDate"
          ref="startEl"
          v-model="startStr"
          class="date-input"
          type="date"
          :max="endStr || todayStr"
          inputmode="none"
          @click="openPicker('start')"
          @focus="openPicker('start')"
        >
        <!-- 回退为 text -->
        <input
          v-else
          id="startDate"
          ref="startEl"
          v-model="startStr"
          class="date-input"
          type="text"
          :placeholder="t('notes.export_picker.date_input_placeholder')"
          inputmode="numeric"
          pattern="\\d{4}-\\d{2}-\\d{2}"
          @blur="normalizeText('start')"
        >
        <span
          v-if="!startStr && supportsDate && isMobile"
          class="fake-placeholder"
        >{{ t('notes.export_picker.fake_placeholder') }}</span>
      </div>
    </div>

    <div class="row">
      <label class="label" for="endDate">{{ t('notes.export_picker.end_label') }}</label>

      <div class="date-wrap">
        <input
          v-if="supportsDate"
          id="endDate"
          ref="endEl"
          v-model="endStr"
          class="date-input"
          type="date"
          :min="startStr || ''"
          :max="todayStr"
          inputmode="none"
          @click="openPicker('end')"
          @focus="openPicker('end')"
        >
        <input
          v-else
          id="endDate"
          ref="endEl"
          v-model="endStr"
          class="date-input"
          type="text"
          :placeholder="t('notes.export_picker.date_input_placeholder')"
          inputmode="numeric"
          pattern="\\d{4}-\\d{2}-\\d{2}"
          @blur="normalizeText('end')"
        >
        <span
          v-if="!endStr && supportsDate && isMobile"
          class="fake-placeholder"
        >{{ t('notes.export_picker.fake_placeholder') }}</span>
      </div>
    </div>

    <div class="chips">
      <button class="chip" type="button" @click="setToday">{{ t('notes.export_picker.today') }}</button>
      <button class="chip" type="button" @click="setRecent(7)">{{ t('notes.export_picker.recent_7') }}</button>
      <button class="chip" type="button" @click="setRecent(30)">{{ t('notes.export_picker.recent_30') }}</button>
    </div>
  </div>
</template>

<style scoped>
.mdrp {
  display: grid;
  gap: 12px;
  min-width: 260px;
  max-width: 420px;
}
.row {
  display: grid;
  grid-template-columns: 64px 1fr;
  align-items: center;
  gap: 8px;
}
.label {
  font-size: 14px;
  color: var(--c-text-secondary, #666);
}

/* 输入框容器，用于“假占位符” */
.date-wrap {
  position: relative;
}

.fake-placeholder {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  font-size: 16px;
  line-height: 1.2;
  color: #9ca3af;
  pointer-events: none;
}
.dark .fake-placeholder {
  color: #6b7280;
}

/* 关键：iOS 避免整体放大 */
.date-input {
  font-size: 16px;
  line-height: 1.2;
  padding: 10px 12px;
  border: 1px solid var(--c-divider, #e5e7eb);
  border-radius: 10px;
  width: 100%;
  box-sizing: border-box;
  background: var(--c-bg, #fff);
  color: var(--c-text, #111);
}
.dark .date-input {
  background: #111827;
  border-color: #374151;
  color: #e5e7eb;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.chip {
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid #6366f1;
  background: transparent;
  color: #4338ca;
}
.chip:active {
  transform: scale(0.98);
}
.dark .chip {
  border-color: #a5b4fc;
  color: #c7d2fe;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-secondary, #6b7280);
}
.dark .hint {
  color: #9ca3af;
}
</style>
