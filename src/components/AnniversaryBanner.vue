<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits(['toggleView'])
const { t } = useI18n()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

const anniversaryNotes = ref<any[]>([])
const isLoading = ref(true)
const isAnniversaryViewActive = ref(false)

let midnightTimer: number | null = null // 零点刷新定时器

// ===== localStorage 持久化 =====
function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function stateKey(uid: string) {
  return `anniv_state_${uid}`
}
function resultKey(uid: string, ymd: string) {
  return `anniv_results_${uid}_${ymd}`
}

function readState(uid: string): { active: boolean; forDate?: string } | null {
  try {
    const raw = localStorage.getItem(stateKey(uid))
    if (!raw)
      return null
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}
function writeState(uid: string, data: { active: boolean; forDate?: string }) {
  try {
    localStorage.setItem(stateKey(uid), JSON.stringify(data))
  }
  catch {}
}
function writeResults(uid: string, ymd: string, arr: any[]) {
  try {
    localStorage.setItem(resultKey(uid, ymd), JSON.stringify(arr))
  }
  catch {}
}
function readResults(uid: string, ymd: string): any[] | null {
  try {
    const raw = localStorage.getItem(resultKey(uid, ymd))
    if (!raw)
      return null
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}
function sweepOldResults(uid: string, keepYmd: string) {
  const prefix = `anniv_results_${uid}_`
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith(prefix) && !k.endsWith(keepYmd))
      localStorage.removeItem(k)
  })
}

// ===== 年份统计 =====
interface YearStat { year: number; count: number }
const yearStats = computed<YearStat[]>(() => {
  const map = new Map<number, number>()
  for (const n of anniversaryNotes.value) {
    const y = new Date(n.created_at).getFullYear()
    map.set(y, (map.get(y) || 0) + 1)
  }
  return Array.from(map.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year)
})
function hueForYear(y: number) {
  let x = (y * 2654435761) % 360
  if (x < 0)
    x += 360
  return x
}

// ===== 主逻辑 =====
function setView(isActive: boolean) {
  if (!user.value)
    return
  isAnniversaryViewActive.value = isActive
  writeState(user.value.id, { active: isActive, forDate: todayStr() })
  if (isActive && anniversaryNotes.value.length === 0) {
    // 不等待返回，按需加载
    loadAnniversaryNotes(true)
  }
}

async function loadAnniversaryNotes(forceRefresh = false) {
  if (!user.value)
    return
  const uid = user.value.id
  const ymd = todayStr()
  isLoading.value = true
  try {
    let data: any[] | null = null
    if (!forceRefresh)
      data = readResults(uid, ymd)

    if (!data) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const { data: rows, error } = await supabase.rpc('get_anniversary_notes_for_date', {
        p_user_id: uid,
        p_client_date: ymd,
        p_timezone: tz,
      })
      if (error)
        throw error
      const sorted = (rows || []).sort((a: any, b: any) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      data = sorted
      writeResults(uid, ymd, data)
      sweepOldResults(uid, ymd)
    }
    anniversaryNotes.value = data
    const st = readState(uid)
    const shouldEmit = isAnniversaryViewActive.value || (!!st && st.active)
    if (shouldEmit) {
      if (anniversaryNotes.value.length > 0)
        emit('toggleView', anniversaryNotes.value)
      else
        emit('toggleView', null)
    }
  }
  catch (err) {
    // 保底：失败时不改变父视图，只输出日志
    console.error('获取那年今日笔记失败:', err)
  }
  finally {
    isLoading.value = false
  }
}

function handleBannerClick() {
  if (anniversaryNotes.value.length === 0)
    return
  if (!user.value)
    return

  const uid = user.value.id
  const ymd = todayStr()

  isAnniversaryViewActive.value = !isAnniversaryViewActive.value
  writeState(uid, { active: isAnniversaryViewActive.value, forDate: ymd })

  if (isAnniversaryViewActive.value)
    emit('toggleView', anniversaryNotes.value)
  else
    emit('toggleView', null)
}

// ===== 零点自动刷新 =====
function scheduleMidnightRefresh() {
  if (midnightTimer) {
    clearTimeout(midnightTimer)
    midnightTimer = null
  }
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const msUntilMidnight = tomorrow.getTime() - now.getTime()
  midnightTimer = window.setTimeout(async () => {
    await loadAnniversaryNotes(true)
    if (user.value)
      writeState(user.value.id, { active: isAnniversaryViewActive.value, forDate: todayStr() })

    scheduleMidnightRefresh()
  }, msUntilMidnight)
}

// ===== 生命周期 =====
onMounted(async () => {
  if (!user.value)
    return

  const uid = user.value.id
  const st = readState(uid)
  const ymd = todayStr()
  const needRefresh = !st || st.forDate !== ymd

  if (needRefresh) {
    if (st?.active)
      isAnniversaryViewActive.value = true
    await loadAnniversaryNotes(true)
    writeState(uid, { active: !!st?.active, forDate: ymd })
  }
  else {
    isAnniversaryViewActive.value = !!st?.active
    await loadAnniversaryNotes(false)
  }

  if (!isAnniversaryViewActive.value)
    emit('toggleView', null)

  scheduleMidnightRefresh()
})

onUnmounted(() => {
  if (midnightTimer) {
    clearTimeout(midnightTimer)
    midnightTimer = null
  }
})

function addNote(newNote: any) {
  // 复用已有的 todayStr 函数来获取今天的日期字符串，例如 "2025-10-14"
  const todayYmd = todayStr()

  // 获取新笔记的日期字符串
  const newNoteDate = new Date(newNote.created_at)
  const y = newNoteDate.getFullYear()
  const m = String(newNoteDate.getMonth() + 1).padStart(2, '0')
  const day = String(newNoteDate.getDate()).padStart(2, '0')
  const newNoteYmd = `${y}-${m}-${day}`

  // 只有当新笔记是今天创建的，才执行操作
  if (newNoteYmd === todayYmd) {
    // 1. 更新内存中的列表 (UI会实时响应)
    anniversaryNotes.value.unshift(newNote)

    // 2. 将更新后的完整列表写回到 localStorage (这是关键的修复)
    if (user.value)
      writeResults(user.value.id, todayYmd, anniversaryNotes.value)
  }
}

function removeNoteById(noteId: string) {
  // 找到被删除笔记在当前列表中的位置
  const index = anniversaryNotes.value.findIndex(n => n.id === noteId)

  // 如果找到了，就将它从列表中移除
  if (index !== -1) {
    anniversaryNotes.value.splice(index, 1)

    // 关键：移除后，必须立刻用更新后的、变短了的列表去覆盖旧的本地缓存
    if (user.value)
      writeResults(user.value.id, todayStr(), anniversaryNotes.value)

    // 如果当前正处于“那年今日”视图，则需要通知父组件更新界面
    if (isAnniversaryViewActive.value)
      emit('toggleView', anniversaryNotes.value.length > 0 ? anniversaryNotes.value : null)
  }
}

// 暴露方法
defineExpose({
  setView,
  loadAnniversaryNotes,
  addNote,
  removeNoteById,
})
</script>

<template>
  <div
    v-if="!isLoading && anniversaryNotes.length > 0"
    class="anniversary-banner"
    @click="handleBannerClick"
  >
    <div class="banner-line">
      <span v-if="isAnniversaryViewActive">
        {{ t('notes.anniversary_total', { count: anniversaryNotes.length }) }}
      </span>
      <span v-else>
        {{ t('notes.anniversary_found', { count: anniversaryNotes.length }) }}
      </span>
    </div>

    <!-- 只有在“那年今日视图”时显示年份徽章 -->
    <div v-if="isAnniversaryViewActive" class="year-chips">
      <span
        v-for="ys in yearStats"
        :key="ys.year"
        class="chip"
        :style="{ '--chip-h': hueForYear(ys.year) }"
      >
        <!-- 例：2019(2) -->
        <span class="chip-year">
          {{ ys.year }}<span v-if="ys.count > 1">({{ ys.count }})</span>
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.anniversary-banner {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 1rem;
  transition: all 0.2s ease-in-out;
}
.anniversary-banner:hover {
  background-color: #e0e7ff;
  transform: translateY(-1px);
}
.dark .anniversary-banner {
  background-color: #312e81;
  color: #c7d2fe;
}
.dark .anniversary-banner:hover {
  background-color: #3730a3;
}

.banner-line {
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

/* 年份徽章区 */
.year-chips {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.chip {
  --chip-h: 210;
  --chip-s: 70%;
  --chip-l: 92%;
  --chip-border-l: 78%;
  background: hsl(var(--chip-h), var(--chip-s), var(--chip-l));
  color: #1f2937;
  border: 1px solid hsl(var(--chip-h), 35%, var(--chip-border-l));
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}
.dark .chip {
  --chip-l: 28%;
  --chip-border-l: 42%;
  color: #e5e7eb;
}
.chip-year {
  font-weight: 700;
  letter-spacing: 0.3px;
}
</style>
