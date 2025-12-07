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

// ===== localStorage 持久化工具函数 =====
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
  catch {
    // ignore
  }
}

function writeResults(uid: string, ymd: string, arr: any[]) {
  try {
    localStorage.setItem(resultKey(uid, ymd), JSON.stringify(arr))
  }
  catch {
    // ignore
  }
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
    // 强制刷新
    loadAnniversaryNotes(true)
  }
}

// 核心修复：支持“静默刷新”模式
// checkCacheFirst: 如果为 true，则先尝试读缓存显示，然后在后台发请求更新
// 简化回滚后的 loadAnniversaryNotes
async function loadAnniversaryNotes(forceRefresh = false) {
  if (!user.value)
    return
  const uid = user.value.id
  const ymd = todayStr()

  // 1. 尝试读缓存
  if (!forceRefresh) {
    const cached = readResults(uid, ymd)
    if (cached) {
      anniversaryNotes.value = cached
      isLoading.value = false
      // 发送事件同步视图
      const st = readState(uid)
      if (isAnniversaryViewActive.value || (st && st.active))
        emit('toggleView', anniversaryNotes.value)

      return // 命中缓存，直接结束
    }
  }

  // 2. 只有无缓存或强制刷新时，才发请求
  // ✨✨✨ 修复抖动核心：实现“静默刷新” ✨✨✨
  // 如果当前已经有笔记在显示了 (anniversaryNotes.value.length > 0)，
  // 我们就不把 isLoading 设为 true。
  // 这样 v-if 就不会被触发，Banner 就不会消失再出现，而是直接平滑替换数据。
  if (anniversaryNotes.value.length === 0)
    isLoading.value = true

  try {
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

    // 数据回来后瞬间替换，用户几乎无感，且不会引起布局跳动
    anniversaryNotes.value = sorted
    writeResults(uid, ymd, sorted)
    sweepOldResults(uid, ymd)

    const st = readState(uid)
    const shouldEmit = isAnniversaryViewActive.value || (!!st && st.active)
    if (shouldEmit)
      emit('toggleView', anniversaryNotes.value.length > 0 ? anniversaryNotes.value : null)
  }
  catch (err) {
    console.error(err)
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
  let msUntilMidnight = tomorrow.getTime() - now.getTime()
  if (msUntilMidnight <= 0 || msUntilMidnight > 25 * 60 * 60 * 1000)
    msUntilMidnight = 60 * 1000

  midnightTimer = window.setTimeout(async () => {
    if (!user.value) {
      scheduleMidnightRefresh()
      return
    }
    // 零点强制刷新
    await loadAnniversaryNotes(false)
    if (user.value) {
      writeState(user.value.id, {
        active: isAnniversaryViewActive.value,
        forDate: todayStr(),
      })
    }
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
  // const needRefresh = !st || st.forDate !== ymd

  // 恢复之前的视图激活状态
  if (st?.active && st.forDate === ymd)
    isAnniversaryViewActive.value = true

  await loadAnniversaryNotes(false)

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

// === 对外暴露的方法 ===

function addNote(newNote: any) {
  const todayYmd = todayStr()
  const newNoteDate = new Date(newNote.created_at)
  const y = newNoteDate.getFullYear()
  const m = String(newNoteDate.getMonth() + 1).padStart(2, '0')
  const day = String(newNoteDate.getDate()).padStart(2, '0')
  const newNoteYmd = `${y}-${m}-${day}`

  if (newNoteYmd === todayYmd) {
    // 1. 防重
    if (anniversaryNotes.value.some(n => n.id === newNote.id))
      return

    anniversaryNotes.value.unshift(newNote)

    // ✨✨✨ 关键修复：只有当数据加载完毕后，才允许写缓存
    // 这样可以防止初始化期间的“新增通知”意外覆盖掉包含往年数据的完整缓存
    if (user.value && !isLoading.value)
      writeResults(user.value.id, todayYmd, anniversaryNotes.value)
    // 如果当前正在看“那年今日”列表，必须告诉父组件数据变了，让列表也刷新
    if (isAnniversaryViewActive.value)
      emit('toggleView', anniversaryNotes.value)
  }
}

function removeNoteById(noteId: string) {
  // 1. 在内存数组中查找
  const index = anniversaryNotes.value.findIndex(n => n.id === noteId)

  if (index !== -1) {
    // 2. 移除并更新
    anniversaryNotes.value.splice(index, 1)

    // 3. 立即写回缓存（防止下次加载旧数据）
    if (user.value)
      writeResults(user.value.id, todayStr(), anniversaryNotes.value)

    // 4. 如果当前正在看这个视图，通知父组件数据变了
    if (isAnniversaryViewActive.value)
      emit('toggleView', anniversaryNotes.value.length > 0 ? anniversaryNotes.value : null)
  }
}

function updateNote(updatedNote: any) {
  if (!updatedNote || !updatedNote.id)
    return
  const index = anniversaryNotes.value.findIndex(n => n.id === updatedNote.id)
  if (index !== -1) {
    anniversaryNotes.value[index] = { ...anniversaryNotes.value[index], ...updatedNote }
    if (user.value)
      writeResults(user.value.id, todayStr(), anniversaryNotes.value)
  }
}

defineExpose({
  setView,
  loadAnniversaryNotes,
  addNote,
  removeNoteById,
  updateNote,
})
</script>

<template>
  <div
    v-if="!isLoading && anniversaryNotes.length > 0"
    class="anniversary-banner"
    @click="handleBannerClick"
  >
    <div class="banner-line">
      <span
        v-if="isAnniversaryViewActive"
        class="banner-text"
      >
        {{ t('notes.anniversary_total', { count: anniversaryNotes.length }) }}
      </span>
      <span
        v-else
        class="banner-text"
      >
        {{ t('notes.anniversary_found', { count: anniversaryNotes.length }) }}
      </span>

      <button
        type="button"
        class="banner-view-btn"
      >
        {{ isAnniversaryViewActive ? t('auth.return') : t('notes.anniversary_view') }}
      </button>
    </div>

    <div v-if="isAnniversaryViewActive" class="year-chips">
      <span
        v-for="ys in yearStats"
        :key="ys.year"
        class="chip"
        :style="{ '--chip-h': hueForYear(ys.year) }"
      >
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
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
}

.banner-text {
  flex: 1;
  text-align: center;
}

.banner-view-btn {
  margin-left: 8px;
  padding: 2px 10px;
  border-radius: 999px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background-color: rgba(79, 70, 229, 0.12);
  color: #4338ca;
}

.banner-view-btn:active {
  transform: translateY(1px);
}

.dark .banner-view-btn {
  background-color: rgba(129, 140, 248, 0.25);
  color: #e5e7eb;
}

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
