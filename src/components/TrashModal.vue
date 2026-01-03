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

interface TrashCache { items: TrashNote[]; latestDeletedAt: string | null; updatedAt: number }
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
  catch { return null }
}
function saveCache(uid: string, items: TrashNote[]) {
  const latest = items.length > 0
    ? items.reduce((acc, cur) => (new Date(cur.deleted_at) > new Date(acc) ? cur.deleted_at : acc), items[0].deleted_at)
    : null
  const payload: TrashCache = { items, latestDeletedAt: latest, updatedAt: Date.now() }
  localStorage.setItem(cacheKeyFor(uid), JSON.stringify(payload))
}

const STORAGE_BUCKET = 'note-images'
const AUDIO_BUCKET = 'note-audios'

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
    catch {}

    if (rel)
      set.add(rel)
  }
  return Array.from(set)
}

async function initFromCacheThenMaybeRefresh() {
  if (!user.value)
    return
  const uid = user.value.id
  selected.value = []
  const cached = loadCache(uid)
  if (cached)
    list.value = cached.items
  else list.value = []
  try {
    const { data, error } = await supabase.from('notes_trash').select('deleted_at').eq('user_id', uid).order('deleted_at', { ascending: false }).limit(1).maybeSingle()
    if (error)
      return
    const latestOnServer: string | null = data?.deleted_at ?? null
    const latestInCache: string | null = cached?.latestDeletedAt ?? null
    const needFullFetch = !cached || (latestOnServer && (!latestInCache || new Date(latestOnServer) > new Date(latestInCache)))
    if (needFullFetch)
      await fetchTrashFromServerAndCache()
  }
  catch {}
}

async function fetchTrashFromServerAndCache() {
  if (!user.value)
    return
  loading.value = true
  selected.value = []
  try {
    const { data, error } = await supabase.from('notes_trash').select('*').eq('user_id', user.value.id).order('deleted_at', { ascending: false })
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
    else selected.value = []
  },
})

function daysLeft(n: TrashNote): number {
  const del = new Date(n.deleted_at).getTime()
  const now = Date.now()
  const passed = Math.floor((now - del) / (1000 * 60 * 60 * 24))
  const left = 30 - passed
  return left > 0 ? left : 0
}

function formatDateTime(dt: string | number | Date): string {
  const d = new Date(dt)
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  }
  catch { return d.toLocaleString() }
}

function clearCalendarCacheForNote(note: TrashNote) {
  if (!note.created_at)
    return
  try {
    const date = new Date(note.created_at)
    const cacheKey = getCalendarDateCacheKey(date)
    localStorage.removeItem(cacheKey)
  }
  catch (e) { console.error('清理日历缓存失败', e) }
}

async function restoreOne(id: string) {
  try {
    const targetNote = list.value.find(n => n.id === id)
    const { error } = await supabase.rpc('restore_note', { p_note_id: id })
    if (error)
      throw error
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
    message.error(t('notes.trash.restore_failed_with_reason', { reason: err.message || t('notes.trash.unknown_error') }))
  }
}

async function restoreSelected() {
  if (selected.value.length === 0)
    return
  const ids = [...selected.value]
  loading.value = true
  try {
    const notesToRestore = list.value.filter(n => ids.includes(n.id))
    for (const id of ids) {
      const { error } = await supabase.rpc('restore_note', { p_note_id: id })
      if (error)
        throw error
    }
    notesToRestore.forEach(note => clearCalendarCacheForNote(note))
    list.value = list.value.filter(n => !ids.includes(n.id))
    selected.value = []
    if (user.value)
      saveCache(user.value.id, list.value)
    const { data: restoredRows } = await supabase.from('notes').select('*').in('id', ids)
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
    onPositiveClick: async () => { await confirmPurge() },
  })
}

async function confirmPurge() {
  if (selected.value.length === 0 || !user.value)
    return
  const ids = [...selected.value]
  loading.value = true
  try {
    const notesToPurge = list.value.filter(n => ids.includes(n.id))
    const imagePaths = new Set<string>()
    const audioPaths = new Set<string>()
    notesToPurge.forEach((n) => {
      extractStoragePathsFromContent(n.content).forEach(p => imagePaths.add(p))
      extractAudioPathsFromContent(n.content).forEach(p => audioPaths.add(p))
    })
    const tasks: Promise<any>[] = []
    if (imagePaths.size > 0)
      tasks.push(supabase.storage.from(STORAGE_BUCKET).remove(Array.from(imagePaths)))

    if (audioPaths.size > 0)
      tasks.push(supabase.storage.from(AUDIO_BUCKET).remove(Array.from(audioPaths)))

    await Promise.all(tasks)
    const { error } = await supabase.from('notes_trash').delete().in('id', ids).eq('user_id', user.value.id)
    if (error)
      throw error

    selected.value = []
    list.value = list.value.filter(n => !ids.includes(n.id))

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

watch(() => props.show, (v) => {
  if (v)
    initFromCacheThenMaybeRefresh()
})
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
          <label class="check-all" :class="{ disabled: list.length === 0 }">
            <input
              type="checkbox"
              :disabled="list.length === 0"
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

        <div class="content-area">
          <div v-if="loading && list.length === 0" class="state-box loading">
            <div class="spinner" />
            <span>{{ t('notes.trash.loading') }}</span>
          </div>

          <div v-else-if="list.length === 0" class="state-box empty">
            <div class="empty-icon">🗑️</div>
            <p>{{ t('notes.trash.empty') }}</p>
          </div>

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
                  @change="($event.target as HTMLInputElement).checked ? selected.push(n.id) : selected.splice(selected.indexOf(n.id), 1)"
                >
              </label>

              <div class="item-main">
                <div class="content">{{ n.content }}</div>
                <div class="meta">
                  <span>{{ formatDateTime(n.created_at) }}</span>
                  <span class="left danger-text">{{ t('notes.trash.days_left', { days: daysLeft(n) }) }}</span>
                </div>
              </div>

              <div class="item-actions">
                <button class="btn-link" :title="t('notes.trash.restore_button_title')" @click="restoreOne(n.id)">
                  {{ t('notes.trash.restore') }}
                </button>
              </div>
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
/* 模态框整体布局 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4000;
}

.modal-content {
  background: #fff;
  color: #111;
  width: 92%;
  max-width: 560px;
  /* 高度固定优化 */
  height: 70vh;
  min-height: 400px;
  max-height: 700px;
  border-radius: 12px;
  box-shadow: 0 15px 40px rgba(0,0,0,.3);
  padding: 1rem;

  /* Flex 列布局 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dark .modal-content { background: #2a2a2a; color: #e0e0e0; }

/* 头部 */
.modal-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: .8rem;
  border-bottom: 1px solid #eee;
}
.dark .modal-header { border-bottom-color: #444; }
.modal-title { margin: 0; font-size: 19px; font-weight: 700; }
.close-button {
  background: none; border: 0; font-size: 28px; line-height: 1; cursor: pointer; color: #888;
  padding: 0 4px;
}
.close-button:hover { color: #555; }

/* 工具栏 */
.toolbar {
  flex-shrink: 0;
  margin: .8rem 0;
  display: flex;
  align-items: center;
  gap: .6rem;
}
.check-all { display: inline-flex; align-items: center; gap: .4rem; cursor: pointer; font-size: 15px; }
.spacer { flex: 1; }

/* 内容区域 */
.content-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.trash-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: .75rem;
}
.trash-list::-webkit-scrollbar { width: 6px; }
.trash-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
.dark .trash-list::-webkit-scrollbar-thumb { background: #555; }

/* 状态展示 */
.state-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  gap: 1rem;
}
.empty-icon { font-size: 48px; opacity: 0.5; }
.loading .spinner {
  width: 24px; height: 24px; border: 3px solid #ddd; border-top-color: #666; border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 列表项 */
.trash-item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: .6rem .8rem;
  padding: .85rem;
  border-radius: 10px;
  background: #f9fafb;
  border: 1px solid #eee;
  transition: background .2s;
}
.trash-item:hover { background: #f3f4f6; }
.dark .trash-item { background: #1f2937; border-color: #374151; }
.dark .trash-item:hover { background: #252f3f; }

.item-check { display: flex; align-items: start; padding-top: .2rem; }
.item-main .content {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 15px;
  line-height: 1.6;
  color: #333;
}
.dark .item-main .content { color: #d1d5db; }

.item-main .meta {
  margin-top: .4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #9ca3af;
}
.danger-text { color: #ef4444; background: rgba(239,68,68,0.08); padding: 1px 5px; border-radius: 4px; }

/* 底部 */
.modal-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding-top: .8rem;
  margin-top: .5rem;
  border-top: 1px solid #eee;
}
.dark .modal-footer { border-top-color: #444; }

/* 按钮 */
.btn-secondary, .btn-danger {
  padding: .5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: opacity .2s;
  border: 1px solid transparent;
}
.btn-secondary { background: #f3f4f6; color: #333; border-color: #e5e7eb; }
.dark .btn-secondary { background: #374151; color: #e5e7eb; border-color: #4b5563; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:disabled, .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
.check-all.disabled { opacity: 0.5; pointer-events: none; }
.btn-link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 16px; font-weight: 500; padding: 4px; }
.dark .btn-link { color: #93c5fd; }

.wide { min-width: 100px; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
