<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import { getCalendarDateCacheKey } from '@/utils/cacheKeys'

const props = defineProps<{
  show: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restored', payload?: any[]): void
  (e: 'purged'): void
}>()
const { t, locale } = useI18n()
const dialog = useDialog()
const message = useMessage()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

interface TrashNote {
  id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  deleted_at: string
}

const loading = ref(false)
const list = ref<TrashNote[]>([])
const selected = ref<string[]>([])

/** ===== 缓存相关 ===== */
function cacheKeyFor(uid: string) {
  return `trash_cache_${uid}`
}
interface TrashCache {
  items: TrashNote[]
  latestDeletedAt: string | null
  updatedAt: number // 本地缓存保存时间戳
}
function loadCache(uid: string): TrashCache | null {
  try {
    const raw = localStorage.getItem(cacheKeyFor(uid))
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as TrashCache
    if (!parsed || !Array.isArray(parsed.items))
      return null
    return parsed
  }
  catch {
    return null
  }
}
function saveCache(uid: string, items: TrashNote[]) {
  const latest = items.length > 0
    ? items.reduce((acc, cur) => (new Date(cur.deleted_at) > new Date(acc) ? cur.deleted_at : acc), items[0].deleted_at)
    : null
  const payload: TrashCache = {
    items,
    latestDeletedAt: latest,
    updatedAt: Date.now(),
  }
  localStorage.setItem(cacheKeyFor(uid), JSON.stringify(payload))
}

// === 新增：文件桶常量 ===
const STORAGE_BUCKET = 'note-images'
const AUDIO_BUCKET = 'note-audios'

// === 新增：提取图片路径函数 (从 auth.vue 复制过来) ===
function extractStoragePathsFromContent(content: string | null | undefined): string[] {
  if (!content)
    return []

  const rx = /https?:\/\/[^\s)"]+\/note-images\/([^)\s"']+)/g
  const set = new Set<string>()
  let m: RegExpExecArray | null = null

  while (true) {
    m = rx.exec(content)
    if (m === null)
      break

    let rel = (m[1] || '').trim()
    if (!rel)
      continue

    rel = rel.split(/[?#]/)[0]

    if (rel.startsWith('/'))
      rel = rel.slice(1)

    try {
      rel = decodeURIComponent(rel)
    }
    catch {}

    if (rel)
      set.add(rel)
  }

  return Array.from(set)
}

// === 新增：提取音频路径函数 ===
function extractAudioPathsFromContent(content: string | null | undefined): string[] {
  if (!content)
    return []

  const rx = /https?:\/\/[^\s)"]+\/note-audios\/([^)\s"']+)/g
  const set = new Set<string>()
  let m: RegExpExecArray | null = null

  while (true) {
    m = rx.exec(content)
    if (m === null)
      break

    let rel = (m[1] || '').trim()
    if (!rel)
      continue

    rel = rel.split(/[?#]/)[0]

    if (rel.startsWith('/'))
      rel = rel.slice(1)

    try {
      rel = decodeURIComponent(rel)
    }
    catch {
      // ignore
    }

    if (rel)
      set.add(rel)
  }

  return Array.from(set)
}

/** 先用缓存显示，如有需要再刷新 */
async function initFromCacheThenMaybeRefresh() {
  if (!user.value)
    return

  const uid = user.value.id
  selected.value = []

  // 1) 优先加载缓存
  const cached = loadCache(uid)

  if (cached)
    list.value = cached.items
  else
    list.value = []

  // 2) 轻量探测服务器是否有更新（只取最新一条的 deleted_at）
  try {
    const { data, error } = await supabase
      .from('notes_trash')
      .select('deleted_at')
      .eq('user_id', uid)
      .order('deleted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      // 探测失败不影响已有缓存显示
      return
    }

    const latestOnServer: string | null = data?.deleted_at ?? null
    const latestInCache: string | null = cached?.latestDeletedAt ?? null

    // 条件：服务器最新 > 本地最新  -> 才拉全量
    const needFullFetch
      = !cached
      || (latestOnServer && (!latestInCache || new Date(latestOnServer) > new Date(latestInCache)))

    if (needFullFetch)
      await fetchTrashFromServerAndCache()
  }
  catch {
    // 忽略探测异常，不打断 UI
  }
}

/** 真正向服务器拉全量并写缓存 */
async function fetchTrashFromServerAndCache() {
  if (!user.value)
    return
  loading.value = true
  selected.value = []
  try {
    const { data, error } = await supabase
      .from('notes_trash')
      .select('*')
      .eq('user_id', user.value.id)
      .order('deleted_at', { ascending: false })
    if (error)
      throw error

    const arr = (data || []) as TrashNote[]
    list.value = arr
    saveCache(user.value.id, arr)
  }
  catch (err: any) {
    console.error(err)
    message.error(t('notes.trash.fetch_failed_with_reason', { reason: err.message || t('notes.trash.unknown_error') }))
  }
  finally {
    loading.value = false
  }
}

const allChecked = computed({
  get: () => list.value.length > 0 && selected.value.length === list.value.length,
  set: (val: boolean) => {
    if (val)
      selected.value = list.value.map(n => n.id)
    else
      selected.value = []
  },
})

function daysLeft(n: TrashNote): number {
  const del = new Date(n.deleted_at).getTime()
  const now = Date.now()
  const passed = Math.floor((now - del) / (1000 * 60 * 60 * 24))
  const left = 30 - passed
  return left > 0 ? left : 0
}

/** 多语言日期格式化（跟随当前 locale） */
function formatDateTime(dt: string | number | Date): string {
  const d = new Date(dt)
  try {
    // 使用当前语言地区；dateStyle/timeStyle 跨浏览器兼容性良好
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
  }
  catch {
    // 兜底
    return d.toLocaleString()
  }
}

function clearCalendarCacheForNote(note: TrashNote) {
  if (!note.created_at)
    return
  try {
    const date = new Date(note.created_at)
    const cacheKey = getCalendarDateCacheKey(date)
    localStorage.removeItem(cacheKey)
    // 可选：同时也清除“所有日期集合”的缓存，强迫日历重新计算小蓝点
    // localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  }
  catch (e) {
    console.error('清理日历缓存失败', e)
  }
}

async function restoreOne(id: string) {
  try {
    // ✅ 在调用 RPC 之前，先从 list 中找到这个笔记对象（为了拿 created_at）
    const targetNote = list.value.find(n => n.id === id)

    const { error } = await supabase.rpc('restore_note', { p_note_id: id })
    if (error)
      throw error

    // ✅ 恢复成功后，精准清除那一天的日历缓存
    if (targetNote)
      clearCalendarCacheForNote(targetNote)

    list.value = list.value.filter(n => n.id !== id)
    selected.value = selected.value.filter(s => s !== id)

    if (user.value)
      saveCache(user.value.id, list.value)
    localStorage.setItem('NOTES_DB_VERSION', Date.now().toString())
    message.success(t('notes.trash.restore_success_one'))
    emit('restored')
  }
  catch (err: any) {
    console.error(err)
    message.error(
      t('notes.trash.restore_failed_with_reason', {
        reason: err.message || t('notes.trash.unknown_error'),
      }),
    )
  }
}

async function restoreSelected() {
  if (selected.value.length === 0)
    return
  const ids = [...selected.value]
  loading.value = true
  try {
    // ✅ 先把要恢复的笔记对象找出来（为了拿 created_at）
    const notesToRestore = list.value.filter(n => ids.includes(n.id))

    for (const id of ids) {
      const { error } = await supabase.rpc('restore_note', { p_note_id: id })
      if (error)
        throw error
    }

    // ✅ 循环清除这些笔记对应的日历缓存
    notesToRestore.forEach((note) => {
      clearCalendarCacheForNote(note)
    })

    list.value = list.value.filter(n => !ids.includes(n.id))
    selected.value = []
    if (user.value)
      saveCache(user.value.id, list.value)

    // 查出这些恢复后的笔记，向父组件回传（可选）
    const { data: restoredRows } = await supabase
      .from('notes')
      .select('*')
      .in('id', ids)
    localStorage.setItem('NOTES_DB_VERSION', Date.now().toString())
    message.success(t('notes.trash.restore_success_many', { count: ids.length }))
    emit('restored', Array.isArray(restoredRows) ? restoredRows : [])
  }
  catch (err: any) {
    console.error(err)
    message.error(t('notes.trash.restore_failed_with_reason', { reason: err.message || t('notes.trash.unknown_error') }))
  }
  finally {
    loading.value = false
  }
}

function openPurgeConfirm() {
  if (selected.value.length === 0)
    return
  const count = selected.value.length
  dialog.warning({
    title: t('notes.trash.purge_confirm_title'),
    content: t('notes.trash.purge_confirm_content', { count }),
    negativeText: t('notes.trash.cancel'),
    positiveText: t('notes.trash.confirm_delete'),
    onPositiveClick: async () => {
      await confirmPurge()
    },
  })
}

/** 批量彻底删除：本地列表 + 缓存同步 */
/** 批量彻底删除：本地列表 + 缓存同步 + 删除云端文件 */
async function confirmPurge() {
  if (selected.value.length === 0 || !user.value)
    return

  const ids = [...selected.value]
  loading.value = true

  try {
    // 1. === 新增：在删除 DB 记录前，先收集并删除关联的图片/音频 ===
    const notesToPurge = list.value.filter(n => ids.includes(n.id))

    // 收集所有涉及的图片路径
    const imagePaths = new Set<string>()
    const audioPaths = new Set<string>()

    notesToPurge.forEach((n) => {
      extractStoragePathsFromContent(n.content).forEach(p => imagePaths.add(p))
      extractAudioPathsFromContent(n.content).forEach(p => audioPaths.add(p))
    })

    // 执行 Storage 删除 (使用 Promise.all 并行处理，不阻塞)
    const tasks: Promise<any>[] = []

    if (imagePaths.size > 0) {
      tasks.push(
        supabase.storage.from(STORAGE_BUCKET).remove(Array.from(imagePaths))
          .then(({ error }) => {
            if (error)
              console.warn('Purge: Failed to remove images', error)
          }),
      )
    }

    if (audioPaths.size > 0) {
      tasks.push(
        supabase.storage.from(AUDIO_BUCKET).remove(Array.from(audioPaths))
          .then(({ error }) => {
            if (error)
              console.warn('Purge: Failed to remove audios', error)
          }),
      )
    }

    // 等待文件删除请求发出（可选：也可以不 await tasks，让它后台跑，加快 UI 响应）
    await Promise.all(tasks)

    // 2. === 原有逻辑：删除数据库记录 ===
    const { error } = await supabase
      .from('notes_trash')
      .delete()
      .in('id', ids)
      .eq('user_id', user.value.id)

    if (error)
      throw error

    list.value = list.value.filter(n => !ids.includes(n.id))
    selected.value = []

    // 更新缓存
    saveCache(user.value.id, list.value)
    localStorage.setItem('NOTES_DB_VERSION', Date.now().toString())

    message.success(t('notes.trash.purge_success_many', { count: ids.length }))
    emit('purged')
  }
  catch (err: any) {
    console.error(err)
    message.error(t('notes.trash.purge_failed_with_reason', { reason: err.message || t('notes.trash.unknown_error') }))
  }
  finally {
    loading.value = false
  }
}

/** 打开弹窗时：先用缓存展示，再做轻量探测，有更新再全量拉取 */
watch(
  () => props.show,
  (v) => {
    if (v)
      initFromCacheThenMaybeRefresh()
  },
)
onMounted(() => {
  if (props.show)
    initFromCacheThenMaybeRefresh()
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content" role="dialog" aria-modal="true" :aria-label="t('notes.trash.aria_label')">
        <div class="modal-header">
          <h2 class="modal-title">{{ t('notes.trash.title') }}</h2>
          <button class="close-button" @click="emit('close')">&times;</button>
        </div>

        <div class="toolbar">
          <label class="check-all">
            <input
              type="checkbox"
              :checked="allChecked"
              @change="allChecked = ($event.target as HTMLInputElement).checked"
            >
            <span>{{ t('notes.trash.select_all') }}</span>
          </label>
          <div class="spacer" />
          <button class="btn-secondary" :disabled="selected.length === 0 || loading" @click="restoreSelected">
            {{ t('notes.trash.restore') }}
          </button>
          <button class="btn-danger" :disabled="selected.length === 0 || loading" @click="openPurgeConfirm">
            {{ t('notes.trash.purge_forever') }}
          </button>
        </div>

        <div v-if="loading && list.length === 0" class="loading">{{ t('notes.trash.loading') }}</div>
        <div v-else-if="list.length === 0" class="empty">{{ t('notes.trash.empty') }}</div>

        <div v-else class="trash-list">
          <div
            v-for="n in list"
            :key="n.id"
            class="trash-item"
          >
            <label class="item-check">
              <input
                type="checkbox"
                :checked="selected.includes(n.id)"
                @change="
                  ($event.target as HTMLInputElement).checked
                    ? selected.push(n.id)
                    : selected.splice(selected.indexOf(n.id), 1)
                "
              >
            </label>

            <div class="item-main">
              <!-- 仅显示前三行 -->
              <div class="content">{{ n.content }}</div>
              <div class="meta">
                <span>{{ t('notes.trash.created_at_label') }}{{ formatDateTime(n.created_at) }}</span>
                <span>{{ t('notes.trash.deleted_at_label') }}{{ formatDateTime(n.deleted_at) }}</span>
                <span class="left">{{ t('notes.trash.days_left', { days: daysLeft(n) }) }}</span>
              </div>
            </div>

            <div class="item-actions">
              <button class="btn-link" :title="t('notes.trash.restore_button_title')" @click="restoreOne(n.id)">
                {{ t('notes.trash.restore') }}
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary wide" @click="emit('close')">{{ t('notes.trash.back') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #fff;
  color: #111;
  width: 92%;
  max-width: 520px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
  padding: 1rem 1rem 0.75rem;
}
.dark .modal-content { background: #2a2a2a; color: #e0e0e0; }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: .5rem;
  border-bottom: 1px solid #eee;
}
.dark .modal-header { border-bottom-color: #444; }
.modal-title { margin: 0; font-size: 18px; font-weight: 600; }
.close-button {
  background: none; border: 0; font-size: 28px; line-height: 1; cursor: pointer; color: #888;
}
.dark .close-button { color: #bbb; }

.toolbar {
  margin: .75rem 0;
  display: flex;
  align-items: center;
  gap: .5rem;
}
.check-all { display: inline-flex; align-items: center; gap: .4rem; }
.spacer { flex: 1; }
.btn-secondary,
.btn-danger {
  padding: .5rem .9rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 14px;
}
.btn-secondary { background: #f3f4f6; color: #111; border-color: #ddd; }
.dark .btn-secondary { background: #3a3a3c; color: #e0e0e0; border-color: #555; }
.btn-danger { background: #ef4444; color: #fff; border-color: #ef4444; }

.loading, .empty {
  text-align: center;
  color: #6b7280;
  padding: 1.25rem 0 .5rem;
}
.dark .loading, .dark .empty { color: #a3a3a3; }

.trash-list { display: flex; flex-direction: column; gap: .75rem; max-height: 60vh; overflow: auto; }
.trash-item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: .5rem .75rem;
  padding: .75rem;
  border-radius: 10px;
  background: #f9fafb;
  border: 1px solid #eee;
}
.dark .trash-item { background: #1f2937; border-color: #374151; }
.item-check { display: flex; align-items: start; padding-top: .2rem; }

/* 仅显示前三行：line-clamp 方案 */
.item-main .content {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  word-break: break-word;
  white-space: normal;
  color: inherit;
  font-size: 15px;   /* ← 内容略放大 */
  line-height: 1.7;  /* ← 行距稍微加一点，便于阅读 */
}

.item-main .meta {
  margin-top: .35rem;
  display: flex;
  flex-wrap: wrap;
  gap: .5rem .75rem;
  font-size: 13px;   /* ← 时间/剩余天数也放大一点 */
  color: #6b7280;
}
.dark .item-main .meta { color: #9ca3af; }
.item-main .meta .left { margin-left: auto; }
.item-actions { display: flex; align-items: center; }
.btn-link {
  background: none; border: none; color: #2563eb; cursor: pointer; padding: .25rem .4rem; border-radius: 4px;
}
.btn-link:hover { background: rgba(37,99,235,.08); }
.dark .btn-link { color: #93c5fd; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: .75rem;
  margin-top: .75rem;
  border-top: 1px solid #eee;
}
.dark .modal-footer { border-top-color: #444; }
.wide { min-width: 120px; }
.fade-enter-active,.fade-leave-active { transition: opacity .25s }
.fade-enter-from,.fade-leave-to { opacity: 0 }

/* 顶部工具栏（全选、恢复、彻底删除）按钮文字稍微放大 */
.check-all span {
  font-size: 15px;  /* 默认大约 14，现在 +1 */
}

.btn-secondary,
.btn-danger {
  font-size: 15px;  /* 原来 14px，现在 +1 */
}

/* 底部“返回”按钮字号 */
.modal-footer .btn-secondary {
  font-size: 15px;
}
/* ===== 列表中每条笔记右边的蓝色“恢复”字号调大 ===== */
.item-actions .btn-link {
  font-size: 16px !important;
  font-weight: 500;
}
</style>
