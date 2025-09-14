<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type RangeTuple = [number, number] | null

const props = defineProps<{ modelValue: RangeTuple }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: RangeTuple): void }>()

// —— 工具 —— //
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function ymdToTs(s: string): number {
  const [y, m, d] = s.split('-').map(n => Number.parseInt(n, 10))
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

const todayStr = toYmd(new Date())

// 支持检测：不可靠时回退为 text
const supportsDate = computed(() => {
  const i = document.createElement('input')
  i.setAttribute('type', 'date')
  i.value = '2024-09-12'
  const okType = i.type === 'date'
  const okValue = i.value === '2024-09-12'
  return okType && okValue
})

// 受控值
const startStr = ref<string>('') // YYYY-MM-DD
const endStr = ref<string>('') // YYYY-MM-DD
const startEl = ref<HTMLInputElement | null>(null)
const endEl = ref<HTMLInputElement | null>(null)

// 同步外部初值
watch(
  () => props.modelValue,
  (val) => {
    if (!val) {
      startStr.value = ''
      endStr.value = ''
      return
    }
    const [s, e] = val
    startStr.value = s ? toYmd(new Date(s)) : ''
    endStr.value = e ? toYmd(new Date(e)) : ''
  },
  { immediate: true },
)

// 同步到父层（并做单端补齐为同一天）
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

// 打开原生选择器（修复在弹窗中不弹出的情况）
function openPicker(which: 'start' | 'end') {
  const el = which === 'start' ? startEl.value : endEl.value
  requestAnimationFrame(() => {
    try {
      (el as any)?.showPicker?.()
    }
    catch {
      // ignore
    }
  })
}

// 文本回退模式：失焦时规范化
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
function clearRange() {
  startStr.value = ''
  endStr.value = ''
}
</script>

<template>
  <div class="mdrp">
    <div class="row">
      <label class="label" for="startDate">开始</label>

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
        placeholder="YYYY-MM-DD"
        inputmode="numeric"
        pattern="\\d{4}-\\d{2}-\\d{2}"
        @blur="normalizeText('start')"
      >
    </div>

    <div class="row">
      <label class="label" for="endDate">结束</label>

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
        placeholder="YYYY-MM-DD"
        inputmode="numeric"
        pattern="\\d{4}-\\d{2}-\\d{2}"
        @blur="normalizeText('end')"
      >
    </div>

    <div class="chips">
      <button class="chip" type="button" @click="setToday">今天</button>
      <button class="chip" type="button" @click="setRecent(7)">最近7天</button>
      <button class="chip" type="button" @click="setRecent(30)">最近30天</button>
      <button class="chip" type="button" @click="clearRange">全部</button>
    </div>

    <p class="hint">未选择范围时将导出全部笔记。</p>
  </div>
</template>

<style scoped>
.mdrp { display: grid; gap: 12px; min-width: 260px; max-width: 420px; }
.row { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 8px; }
.label { font-size: 14px; color: var(--c-text-secondary, #666); }

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
.dark .date-input { background: #111827; border-color: #374151; color: #e5e7eb; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.chip { font-size: 14px; padding: 8px 12px; border-radius: 999px; border: 1px solid #6366f1; background: transparent; color: #4338ca; }
.chip:active { transform: scale(0.98); }
.dark .chip { border-color: #a5b4fc; color: #c7d2fe; }

.hint { margin: 4px 0 0; font-size: 12px; color: var(--c-text-secondary, #6b7280); }
.dark .hint { color: #9ca3af; }
</style>
