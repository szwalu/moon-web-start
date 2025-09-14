<script setup lang="ts">
import { ref, watch } from 'vue'

type RangeTuple = [number, number] | null

const props = defineProps<{
  modelValue: RangeTuple
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: RangeTuple): void
}>()

// —— 工具函数 ——
// 日期 → 'YYYY-MM-DD'
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
// 'YYYY-MM-DD' → 当地时区的时间戳（毫秒）
function ymdToTs(s: string): number {
  const [y, m, d] = s.split('-').map(n => Number.parseInt(n, 10))
  // 构造本地时间（避免时区偏移）
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

const todayStr = toYmd(new Date())

// 内部可控的字符串值（和 <input type="date"> 绑定）
const startStr = ref<string>('')
const endStr = ref<string>('')

// 初始化：把外部的 [start,end] 映射到 YYYY-MM-DD
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

function syncEmit() {
  if (!startStr.value && !endStr.value) {
    emit('update:modelValue', null)
    return
  }
  const s = startStr.value ? ymdToTs(startStr.value) : 0
  const e = endStr.value ? ymdToTs(endStr.value) : 0
  // 规范化：都选了才发范围，否则发 null（交给外部“导出全部”）
  if (s && e)
    emit('update:modelValue', [s, e])
  else
    emit('update:modelValue', null)
}

function onStartChange(e: Event) {
  const v = (e.target as HTMLInputElement).value
  startStr.value = v
  syncEmit()
}
function onEndChange(e: Event) {
  const v = (e.target as HTMLInputElement).value
  endStr.value = v
  syncEmit()
}

function setToday() {
  const t = todayStr
  startStr.value = t
  endStr.value = t
  syncEmit()
}
function setRecent(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  startStr.value = toYmd(start)
  endStr.value = toYmd(end)
  syncEmit()
}
function clearRange() {
  startStr.value = ''
  endStr.value = ''
  syncEmit()
}
</script>

<template>
  <div class="mdrp">
    <div class="row">
      <label class="label" for="startDate">开始</label>
      <input
        id="startDate"
        class="date-input"
        type="date"
        :value="startStr"
        :max="endStr || todayStr"
        inputmode="none"
        @change="onStartChange"
      >
    </div>

    <div class="row">
      <label class="label" for="endDate">结束</label>
      <input
        id="endDate"
        class="date-input"
        type="date"
        :value="endStr"
        :min="startStr || ''"
        :max="todayStr"
        inputmode="none"
        @change="onEndChange"
      >
    </div>

    <div class="chips">
      <button class="chip" type="button" @click="setToday">今天</button>
      <button class="chip" type="button" @click="setRecent(7)">最近7天</button>
      <button class="chip" type="button" @click="setRecent(30)">最近30天</button>
      <button class="chip" type="button" @click="clearRange">全部</button>
    </div>

    <p class="hint">
      未选择范围时将导出全部笔记。
    </p>
  </div>
</template>

<style scoped>
.mdrp {
  display: grid;
  gap: 12px;
  min-width: 260px;
  max-width: 420px;
}

/* 行布局 */
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

/* 关键：iOS Safari 避免点击时整体缩放，把字体至少设为 16px */
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

.chip:active { transform: scale(0.98); }

.dark .chip {
  border-color: #a5b4fc;
  color: #c7d2fe;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-secondary, #6b7280);
}
.dark .hint { color: #9ca3af; }
</style>
