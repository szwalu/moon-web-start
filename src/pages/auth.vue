<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { NDropdown, useDialog, useMessage } from 'naive-ui'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import { CACHE_KEYS, getCalendarDateCacheKey, getTagCacheKey } from '@/utils/cacheKeys'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'
import AnniversaryBanner from '@/components/AnniversaryBanner.vue'
import NoteActions from '@/components/NoteActions.vue'
import 'easymde/dist/easymde.min.css'
import { useTagMenu } from '@/composables/useTagMenu'

const { t } = useI18n()
const allTags = ref<string[]>([])
const onSelectTag = (tag: string) => fetchNotesByTag(tag)

const { mainMenuVisible, tagMenuChildren } = useTagMenu(allTags, onSelectTag, t)

const SettingsModal = defineAsyncComponent(() => import('@/components/SettingsModal.vue'))
const AccountModal = defineAsyncComponent(() => import('@/components/AccountModal.vue'))
const CalendarView = defineAsyncComponent(() => import('@/components/CalendarView.vue'))
const MobileDateRangePicker = defineAsyncComponent(() => import('@/components/MobileDateRangePicker.vue'))
const TrashModal = defineAsyncComponent(() => import('@/components/TrashModal.vue'))
const _usedAsyncComponents = [SettingsModal, AccountModal, CalendarView, MobileDateRangePicker, TrashModal]

useDark()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()

const noteListRef = ref(null)
const newNoteEditorContainerRef = ref<HTMLElement | null>(null)
const newNoteEditorRef = ref(null)
const noteActionsRef = ref<any>(null)
const showCalendarView = ref(false)
const showSettingsModal = ref(false)
const showTrashModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const showSearchBar = ref(false)
const compactWhileTyping = ref(false)
const dropdownContainerRef = ref(null)
const user = computed(() => authStore.user)
const isCreating = ref(false)
const notes = ref<any[]>([])
const newNoteContent = ref('')
const isLoadingNotes = ref(false)
const showNotesList = ref(true)
const currentPage = ref(1)
const notesPerPage = 30
const totalNotes = ref(0)
const hasMoreNotes = ref(true)
const hasPreviousNotes = ref(false)
const maxNoteLength = 20000
const searchQuery = ref('')
const isExporting = ref(false)
const isReady = ref(false)
const isEditorActive = ref(false)
const isSelectionModeActive = ref(false)
const selectedNoteIds = ref<string[]>([])
const anniversaryBannerRef = ref<InstanceType<typeof AnniversaryBanner> | null>(null)
const anniversaryNotes = ref<any[] | null>(null)
const isAnniversaryViewActive = ref(false)
const loading = ref(false)
const lastSavedId = ref<string | null>(null)
const editingNote = ref<any | null>(null)
const cachedNotes = ref<any[]>([])
const calendarViewRef = ref(null)
const activeTagFilter = ref<string | null>(null)
const filteredNotesCount = ref(0)
const isShowingSearchResults = ref(false)
let mainNotesCache: any[] = []
const LOCAL_CONTENT_KEY = 'new_note_content_draft'
const LOCAL_NOTE_ID_KEY = 'last_edited_note_id'
let authListener: any = null
const noteListKey = ref(0)

const SESSION_SEARCH_QUERY_KEY = 'session_search_query'
const SESSION_SHOW_SEARCH_BAR_KEY = 'session_show_search_bar'
const SESSION_TAG_FILTER_KEY = 'session_tag_filter'
const SESSION_SEARCH_RESULTS_KEY = 'session_search_results'
const SESSION_ANNIV_ACTIVE_KEY = 'session_anniv_active'
const SESSION_ANNIV_RESULTS_KEY = 'session_anniv_results'

watch(searchQuery, (newValue) => {
  if (newValue && newValue.trim()) {
    sessionStorage.setItem(SESSION_SEARCH_QUERY_KEY, newValue)
  }
  else {
    sessionStorage.removeItem(SESSION_SEARCH_QUERY_KEY)
    sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
  }
})
watch(showSearchBar, (newValue) => {
  sessionStorage.setItem(SESSION_SHOW_SEARCH_BAR_KEY, String(newValue))
})
watch(activeTagFilter, (newValue) => {
  if (newValue)
    sessionStorage.setItem(SESSION_TAG_FILTER_KEY, newValue)
  else
    sessionStorage.removeItem(SESSION_TAG_FILTER_KEY)
})

const mainMenuOptions = computed(() => [
  { label: '日历', key: 'calendar' },
  { label: isSelectionModeActive.value ? t('notes.cancel_selection') : t('notes.select_notes'), key: 'toggleSelection' },
  { label: t('settings.font_title'), key: 'settings' },
  { label: t('notes.export_all'), key: 'export' },
  { label: t('auth.account_title'), key: 'account' },
  { label: '回收站', key: 'trash' },
  { type: 'divider', key: 'div-tags' },
  ...tagMenuChildren.value,
])

const showAnniversaryBanner = computed(() => {
  if (compactWhileTyping.value)
    return false
  if (activeTagFilter.value)
    return false
  if (searchQuery.value && searchQuery.value.trim() !== '')
    return false
  if (isSelectionModeActive.value)
    return false
  return true
})

onMounted(() => {
  (async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const currentUser = data?.session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser
    }
    catch (e) {
      // no-op
    }
  })()

  const loadCache = async () => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEYS.HOME)
      if (cachedData)
        notes.value = JSON.parse(cachedData)
    }
    catch (e) {
      console.error('Failed to load notes from cache', e)
      localStorage.removeItem(CACHE_KEYS.HOME)
    }
  }
  setTimeout(() => {
    loadCache()
  }, 0)

  document.addEventListener('visibilitychange', handleVisibilityChange)
  const result = supabase.auth.onAuthStateChange((event, session) => {
    const currentUser = session?.user ?? null
    if (authStore.user?.id !== currentUser?.id)
      authStore.user = currentUser

    if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser))) {
      nextTick(async () => {
        const savedSearchQuery = sessionStorage.getItem(SESSION_SEARCH_QUERY_KEY)
        const savedSearchResults = sessionStorage.getItem(SESSION_SEARCH_RESULTS_KEY)
        const savedTagFilter = sessionStorage.getItem(SESSION_TAG_FILTER_KEY)
        const savedAnnivActive = sessionStorage.getItem(SESSION_ANNIV_ACTIVE_KEY) === 'true'
        const savedAnnivResults = sessionStorage.getItem(SESSION_ANNIV_RESULTS_KEY)

        if (savedSearchQuery && savedSearchResults) {
          searchQuery.value = savedSearchQuery
          showSearchBar.value = sessionStorage.getItem(SESSION_SHOW_SEARCH_BAR_KEY) === 'true'
          try {
            notes.value = JSON.parse(savedSearchResults)
          }
          catch (e) {
            sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
          }
          isLoadingNotes.value = false
          hasMoreNotes.value = false
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
        }
        else if (savedSearchQuery) {
          searchQuery.value = savedSearchQuery
          showSearchBar.value = sessionStorage.getItem(SESSION_SHOW_SEARCH_BAR_KEY) === 'true'
          noteActionsRef.value?.executeSearch()
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
        }
        else if (savedTagFilter) {
          await fetchNotesByTag(savedTagFilter)
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
        }
        else if (savedAnnivActive) {
          isShowingSearchResults.value = false
          activeTagFilter.value = null
          showSearchBar.value = false
          if (savedAnnivResults) {
            try {
              const parsed = JSON.parse(savedAnnivResults)
              anniversaryNotes.value = parsed
              isAnniversaryViewActive.value = true
              hasMoreNotes.value = false
              nextTick(() => {
                anniversaryBannerRef.value?.setView(true)
              })
            }
            catch (e) {
              anniversaryBannerRef.value?.loadAnniversaryNotes()
            }
          }
          else {
            anniversaryBannerRef.value?.loadAnniversaryNotes()
          }
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
        }
        else {
          isLoadingNotes.value = true
          await fetchNotes()
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
        }
      })
    }
    else if (event === 'SIGNED_OUT') {
      notes.value = []
      allTags.value = []
      newNoteContent.value = ''
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('cached_notes_'))
          localStorage.removeItem(key)
      })
      localStorage.removeItem(LOCAL_CONTENT_KEY)
    }
    else {
      authStore.user = session?.user ?? null
    }
  })
  authListener = result.data.subscription

  const savedContent = localStorage.getItem(LOCAL_CONTENT_KEY)
  if (savedContent)
    newNoteContent.value = savedContent

  isReady.value = true
})

onUnmounted(() => {
  if (authListener)
    authListener.unsubscribe()

  document.removeEventListener('click', closeDropdownOnClickOutside)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

watch(newNoteContent, (val) => {
  if (!isReady.value)
    return
  if (val)
    localStorage.setItem(LOCAL_CONTENT_KEY, val)
  else
    localStorage.removeItem(LOCAL_CONTENT_KEY)
})

function invalidateAllSearchCaches() {
  const searchPrefix = CACHE_KEYS.SEARCH_PREFIX
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && key.startsWith(searchPrefix))
      localStorage.removeItem(key)
  }
}

function invalidateCachesOnDataChange(note: any) {
  if (!note || !note.content)
    return
  const tagRegex = /#([^\s#.,?!;:"'()\[\]{}]+)/g
  let match
  // eslint-disable-next-line no-cond-assign
  while ((match = tagRegex.exec(note.content)) !== null) {
    if (match[1]) {
      const tag = `#${match[1]}`
      localStorage.removeItem(getTagCacheKey(tag))
    }
  }
  const noteDate = new Date(note.created_at)
  localStorage.removeItem(getCalendarDateCacheKey(noteDate))
  localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  invalidateAllSearchCaches()
}

function invalidateAllTagCaches() {
  const tagPrefix = CACHE_KEYS.TAG_PREFIX
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && key.startsWith(tagPrefix))
      localStorage.removeItem(key)
  }
}

async function _reloadNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('id, content, weather, created_at, updated_at, is_pinned')
    .order('created_at', { ascending: false })
  if (error)
    throw error
  notes.value = data ?? []
}

// —— 接收 NoteEditor.vue 发来的 { content, weather }（旧输入框使用）
async function handleCreateNote(content: string, weather?: string | null) {
  isCreating.value = true
  try {
    const saved = await saveNote(content, null, { showMessage: true, weather })
    if (saved) {
      localStorage.removeItem(LOCAL_CONTENT_KEY)
      newNoteContent.value = ''
      nextTick(() => {
        const editorRefAny = newNoteEditorRef.value as any
        editorRefAny?.reset?.()
      })
    }
  }
  finally {
    isCreating.value = false
  }
}

async function handleUpdateNote({ id, content }: { id: string; content: string }, callback: (success: boolean) => void) {
  const saved = await saveNote(content, id, { showMessage: true })
  if (callback)
    callback(!!saved)
}

async function saveNote(
  contentToSave: string,
  noteIdToUpdate: string | null,
  { showMessage = false, weather = null }: { showMessage?: boolean; weather?: string | null } = {},
) {
  if (!contentToSave.trim() || !user.value?.id) {
    if (!user.value?.id)
      messageHook.error(t('auth.session_expired'))

    return null
  }
  if (contentToSave.length > maxNoteLength) {
    messageHook.error(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return null
  }

  const noteData = {
    content: contentToSave.trim(),
    updated_at: new Date().toISOString(),
    user_id: user.value.id,
  }

  let savedNote
  try {
    if (noteIdToUpdate) {
      const { data: updatedData, error: updateError } = await supabase
        .from('notes')
        .update(noteData)
        .eq('id', noteIdToUpdate)
        .eq('user_id', user.value.id)
        .select()
      if (updateError || !updatedData?.length)
        throw new Error(t('auth.update_failed'))
      savedNote = updatedData[0]
      updateNoteInList(savedNote)
      if (showMessage)
        messageHook.success(t('notes.update_success'))
    }
    else {
      const newId = uuidv4()
      const insertPayload: any = { ...noteData, id: newId }
      insertPayload.weather = weather ?? null
      const { data: insertedData, error: insertError } = await supabase
        .from('notes')
        .insert(insertPayload)
        .select()
      if (insertError || !insertedData?.length)
        throw new Error(t('auth.insert_failed_create_note'))
      savedNote = insertedData[0]
      addNoteToList(savedNote)
      if (showMessage)
        messageHook.success(t('notes.auto_saved'))
    }

    invalidateCachesOnDataChange(savedNote)
    await fetchAllTags()
    return savedNote
  }
  catch (error: any) {
    messageHook.error(`${t('notes.operation_error')}: ${error.message || '未知错误'}`)
    return null
  }
}

const displayedNotes = computed(() => {
  if (isShowingSearchResults.value)
    return notes.value
  if (isAnniversaryViewActive.value)
    return anniversaryNotes.value
  return notes.value
})

function closeDropdownOnClickOutside(event: MouseEvent) {
  if (dropdownContainerRef.value && !(dropdownContainerRef.value as HTMLElement).contains(event.target as Node))
    showDropdown.value = false
}

async function fetchAllTags() {
  if (!user.value?.id) {
    console.warn('fetchAllTags was called before user ID was available.')
    return
  }
  try {
    const { data, error } = await supabase.rpc('get_unique_tags', { p_user_id: user.value.id })
    if (error)
      throw error
    allTags.value = data || []
  }
  catch (err: any) {
    console.error('Error fetching tags via RPC:', err)
    messageHook.error(`获取标签失败: ${err.message}`)
  }
}

function restoreHomepageFromCache(): boolean {
  const cachedNotesData = localStorage.getItem(CACHE_KEYS.HOME)
  const cachedMetaData = localStorage.getItem(CACHE_KEYS.HOME_META)
  if (cachedNotesData && cachedMetaData) {
    const cachedNotes = JSON.parse(cachedNotesData)
    const meta = JSON.parse(cachedMetaData)
    notes.value = cachedNotes
    totalNotes.value = meta.totalNotes
    currentPage.value = Math.max(1, Math.ceil(cachedNotes.length / notesPerPage))
    hasMoreNotes.value = cachedNotes.length < meta.totalNotes
    return true
  }
  return false
}

function handleSearchStarted() {
  sessionStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
  sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }
  sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
  isLoadingNotes.value = true
  notes.value = []
  isShowingSearchResults.value = false
}

function handleSearchCompleted({ data, error }: { data: any[] | null; error: Error | null }) {
  if (error) {
    messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
    notes.value = []
    sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
    isShowingSearchResults.value = false
  }
  else {
    notes.value = data || []
    sessionStorage.setItem(SESSION_SEARCH_RESULTS_KEY, JSON.stringify(notes.value))
    isShowingSearchResults.value = true
  }
  hasMoreNotes.value = false
  hasPreviousNotes.value = false
  isLoadingNotes.value = false
}

function handleSearchCleared() {
  isShowingSearchResults.value = false
  if (!restoreHomepageFromCache()) {
    currentPage.value = 1
    fetchNotes()
  }
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const { data, error } = await supabase.auth.getSession()
    if ((!data.session || error) && authStore.user) {
      messageHook.warning(t('auth.session_expired_relogin'))
      authStore.user = null
      notes.value = []
      allTags.value = []
      newNoteContent.value = ''
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('cached_notes_'))
          localStorage.removeItem(key)
      })
      localStorage.removeItem(LOCAL_CONTENT_KEY)
    }
  }
}

function handleEditorFocus(containerEl: HTMLElement | null) {
  compactWhileTyping.value = true
  setTimeout(() => {
    if (containerEl && typeof containerEl.scrollIntoView === 'function')
      containerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 0)
}

let editorHideTimer: number | null = null
function onEditorFocus() {
  if (editorHideTimer) {
    clearTimeout(editorHideTimer)
    editorHideTimer = null
  }
  isEditorActive.value = true
}
function onEditorBlur() {
  editorHideTimer = window.setTimeout(() => {
    isEditorActive.value = false
    compactWhileTyping.value = false
  }, 120)
}

// 包装：模板 @focus 不再写多条语句
function onComposerFocus() {
  onEditorFocus()
  handleEditorFocus(newNoteEditorContainerRef.value)
}

function handleExportTrigger() {
  if (isShowingSearchResults.value || activeTagFilter.value)
    handleExportResults()
  else
    handleBatchExport()
}

async function handleBatchExport() {
  if (isExporting.value)
    return
  if (!user.value?.id) {
    messageHook.error(t('auth.session_expired'))
    return
  }
  const dialogDateRange = ref<[number, number] | null>(null)
  dialog.info({
    title: t('notes.export_confirm_title'),
    content: () => h(MobileDateRangePicker, {
      'modelValue': dialogDateRange.value,
      'onUpdate:modelValue': (v: [number, number] | null) => {
        dialogDateRange.value = v
      },
    }),
    positiveText: t('notes.confirm_export'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      isExporting.value = true
      messageHook.info(t('notes.export_preparing'), { duration: 5000 })
      try {
        const [startDate, endDate] = dialogDateRange.value || [null, null]
        const BATCH_SIZE = 100
        let allNotes: any[] = []
        let page = 0
        let hasMore = true
        while (hasMore) {
          let query = supabase
            .from('notes')
            .select('content, created_at')
            .eq('user_id', user.value!.id)
            .order('created_at', { ascending: false })
            .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)

          if (startDate)
            query = query.gte('created_at', new Date(startDate).toISOString())

          if (endDate) {
            const endOfDay = new Date(endDate)
            endOfDay.setHours(23, 59, 59, 999)
            query = query.lte('created_at', endOfDay.toISOString())
          }

          const { data, error } = await query
          if (error)
            throw error

          if (data && data.length > 0) {
            allNotes = allNotes.concat(data)
            page++
          }
          else {
            hasMore = false
          }
          if (data && data.length < BATCH_SIZE)
            hasMore = false
        }

        if (allNotes.length === 0) {
          messageHook.warning(t('notes.no_notes_to_export_in_range'))
          return
        }

        const textContent = allNotes.map((note) => {
          const separator = '----------------------------------------'
          const date = new Date(note.created_at).toLocaleString('zh-CN')
          return `${separator}\n创建于: ${date}\n${separator}\n\n${note.content}\n\n========================================\n\n`
        }).join('')

        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const datePart = startDate && endDate
          ? `${new Date(startDate).toISOString().slice(0, 10)}_to_${new Date(endDate).toISOString().slice(0, 10)}`
          : 'all'
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
        a.download = `notes_export_${datePart}_${timestamp}.txt`
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
        }, 100)
        messageHook.success(t('notes.export_all_success', { count: allNotes.length }))
      }
      catch (error: any) {
        messageHook.error(`${t('notes.export_all_error')}: ${error.message}`)
      }
      finally {
        isExporting.value = false
      }
    },
  })
}

function handleExportResults() {
  if (isExporting.value)
    return
  isExporting.value = true
  messageHook.info('正在准备导出搜索结果...', { duration: 3000 })
  try {
    const notesToExport = displayedNotes.value
    if (!notesToExport || notesToExport.length === 0) {
      messageHook.warning('没有可导出的搜索结果。')
      return
    }
    const textContent = notesToExport.map((note: any) => {
      const separator = '----------------------------------------'
      const date = new Date(note.created_at).toLocaleString('zh-CN')
      return `${separator}\n创建于: ${date}\n${separator}\n\n${note.content}\n\n========================================\n\n`
    }).join('')
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    a.download = `notes_search_results_${timestamp}.txt`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 100)
    messageHook.success(`成功导出 ${notesToExport.length} 条笔记。`)
  }
  catch (error: any) {
    messageHook.error(`导出失败: ${error.message}`)
  }
  finally {
    isExporting.value = false
  }
}

function addNoteToList(newNote: any) {
  if (!notes.value.some(note => note.id === newNote.id)) {
    notes.value.unshift(newNote)
    totalNotes.value += 1
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
    localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
  }
}

async function handlePinToggle(note: any) {
  if (!note || !user.value)
    return
  const newPinStatus = !note.is_pinned
  try {
    const { error } = await supabase.from('notes').update({ is_pinned: newPinStatus }).eq('id', note.id).eq('user_id', user.value.id)
    if (error)
      throw error
    messageHook.success(newPinStatus ? t('notes.pinned_success') : t('notes.unpinned_success'))
    await fetchNotes()
    if (showCalendarView.value && calendarViewRef.value) {
      // @ts-expect-error exposed by defineExpose
      (calendarViewRef.value as any).refreshData()
    }
  }
  catch (err: any) {
    messageHook.error(`${t('notes.operation_error')}: ${err.message}`)
  }
}

function updateNoteInList(updatedNote: any) {
  const index = notes.value.findIndex(n => n.id === updatedNote.id)
  if (index !== -1) {
    notes.value[index] = { ...updatedNote }
    notes.value.sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
  }
}

async function fetchNotes() {
  if (!user.value)
    return
  isLoadingNotes.value = true
  try {
    const from = (currentPage.value - 1) * notesPerPage
    const to = from + notesPerPage - 1
    const { data, error, count } = await supabase
      .from('notes')
      .select('id, content, weather, created_at, updated_at, is_pinned', { count: 'exact' })
      .eq('user_id', user.value.id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
    if (error)
      throw error
    const newNotes = data || []
    totalNotes.value = count || 0
    notes.value = currentPage.value > 1 ? [...notes.value, ...newNotes] : newNotes
    if (newNotes.length > 0) {
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: count || 0 }))
    }
    hasMoreNotes.value = to + 1 < totalNotes.value
  }
  catch {
    messageHook.error(t('notes.fetch_error'))
  }
  finally {
    isLoadingNotes.value = false
  }
}

async function handleTrashRestored(restoredNotes?: any[]) {
  const inFilteredView = isAnniversaryViewActive.value || activeTagFilter.value || isShowingSearchResults.value
  if (Array.isArray(restoredNotes) && restoredNotes.length > 0 && !inFilteredView) {
    const existIds = new Set(notes.value.map(n => n.id))
    const toInsert = restoredNotes.filter(n => n && !existIds.has(n.id))
    if (toInsert.length > 0) {
      notes.value = [...toInsert, ...notes.value]
      notes.value.sort(
        (a, b) =>
          (b.is_pinned - a.is_pinned)
          || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      )
      totalNotes.value = (totalNotes.value || 0) + toInsert.length
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
    }
  }
  else {
    currentPage.value = 1
    await fetchNotes()
  }
}

async function handleTrashPurged() {
  await fetchNotes()
}

function handleHeaderClick() {
  (noteListRef.value as any)?.scrollToTop?.()
}

async function nextPage() {
  if (isLoadingNotes.value || !hasMoreNotes.value)
    return
  currentPage.value++
  await fetchNotes()
}

async function triggerDeleteConfirmation(id: string) {
  if (!id || !user.value?.id)
    return
  const noteToDelete = notes.value.find(note => note.id === id)
  dialog.warning({
    title: t('notes.delete_confirm_title'),
    content: t('notes.delete_confirm_content'),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      try {
        const { error } = await supabase
          .from('notes')
          .delete()
          .eq('id', id)
          .eq('user_id', user.value!.id)
        if (error)
          throw new Error(error.message)

        const homeCacheRaw = localStorage.getItem(CACHE_KEYS.HOME)
        if (homeCacheRaw) {
          const homeCache = JSON.parse(homeCacheRaw)
          const updatedHomeCache = homeCache.filter((note: any) => note.id !== id)
          localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(updatedHomeCache))
        }

        totalNotes.value -= 1
        localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
        if (activeTagFilter.value) {
          mainNotesCache = mainNotesCache.filter(note => note.id !== id)
          notes.value = notes.value.filter(note => note.id !== id)
        }
        else {
          notes.value = notes.value.filter(note => note.id !== id)
        }

        messageHook.success(t('notes.delete_success'))
        if (noteToDelete)
          invalidateCachesOnDataChange(noteToDelete)

        if (showCalendarView.value && calendarViewRef.value) {
          // @ts-expect-error defineExpose
          (calendarViewRef.value as any).refreshData?.()
        }
      }
      catch (err: any) {
        messageHook.error(`删除失败: ${err.message || '请稍后重试'}`)
      }
    },
  })
}

async function handleNoteContentClick({ noteId, itemIndex }: { noteId: string; itemIndex: number }) {
  const noteToUpdate = notes.value.find(n => n.id === noteId)
  if (!noteToUpdate)
    return
  const originalContent = noteToUpdate.content
  try {
    const lines = originalContent.split('\n')
    const taskLineIndexes: number[] = []
    lines.forEach((line, index) => {
      if (line.trim().match(/^\-\s\[( |x)\]/))
        taskLineIndexes.push(index)
    })
    if (itemIndex < taskLineIndexes.length) {
      const lineIndexToChange = taskLineIndexes[itemIndex]
      const lineContent = lines[lineIndexToChange]
      lines[lineIndexToChange] = lineContent.includes('[ ]') ? lineContent.replace('[ ]', '[x]') : lineContent.replace('[x]', '[ ]')
      const newContent = lines.join('\n')
      noteToUpdate.content = newContent
      await supabase.from('notes').update({ content: newContent, updated_at: new Date().toISOString() }).eq('id', noteId).eq('user_id', user.value!.id)
    }
  }
  catch (err: any) {
    noteToUpdate.content = originalContent
    messageHook.error(`更新失败: ${err.message}`)
  }
}

async function handleCopy(noteContent: string) {
  if (!noteContent)
    return
  try {
    await navigator.clipboard.writeText(noteContent)
    messageHook.success(t('notes.copy_success'))
  }
  catch {
    messageHook.error(t('notes.copy_error'))
  }
}

function toggleSearchBar() {
  showSearchBar.value = !showSearchBar.value
  showDropdown.value = false
}

function handleCancelSearch() {
  searchQuery.value = ''
  showSearchBar.value = false
  handleSearchCleared()
}

function handleAnniversaryToggle(data: any[] | null) {
  if (data) {
    anniversaryNotes.value = data
    isAnniversaryViewActive.value = true
    hasMoreNotes.value = false
    sessionStorage.setItem(SESSION_ANNIV_ACTIVE_KEY, 'true')
    try {
      sessionStorage.setItem(SESSION_ANNIV_RESULTS_KEY, JSON.stringify(data))
    }
    catch {
      sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
    }
  }
  else {
    anniversaryNotes.value = null
    isAnniversaryViewActive.value = false
    hasMoreNotes.value = notes.value.length < totalNotes.value
    sessionStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
    sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
  }
}

function toggleSelectionMode() {
  const willEnable = !isSelectionModeActive.value
  isSelectionModeActive.value = willEnable
  if (willEnable)
    showSearchBar.value = false
  else
    selectedNoteIds.value = []

  showDropdown.value = false
}

function finishSelectionMode() {
  isSelectionModeActive.value = false
  selectedNoteIds.value = []
}

function handleToggleSelect(noteId: string) {
  if (!isSelectionModeActive.value)
    return
  const index = selectedNoteIds.value.indexOf(noteId)
  if (index > -1)
    selectedNoteIds.value.splice(index, 1)
  else
    selectedNoteIds.value.push(noteId)
}

async function handleCopySelected() {
  if (selectedNoteIds.value.length === 0)
    return
  const notesToCopy = notes.value.filter(note => selectedNoteIds.value.includes(note.id))
  const textContent = notesToCopy.map(note => note.content).join('\n\n---\n\n')
  try {
    await navigator.clipboard.writeText(textContent)
    messageHook.success(t('notes.copy_success_multiple', { count: notesToCopy.length }))
  }
  catch {
    messageHook.error(t('notes.copy_error'))
  }
  finally {
    isSelectionModeActive.value = false
    selectedNoteIds.value = []
  }
}

async function handleDeleteSelected() {
  if (selectedNoteIds.value.length === 0)
    return
  dialog.warning({
    title: t('dialog.delete_note_title'),
    content: t('dialog.delete_note_content2', { count: selectedNoteIds.value.length }),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      try {
        loading.value = true
        const idsToDelete = [...selectedNoteIds.value]

        idsToDelete.forEach((id) => {
          const noteToDelete = notes.value.find(n => n.id === id)
          if (noteToDelete)
            invalidateCachesOnDataChange(noteToDelete)
        })

        const { error } = await supabase
          .from('notes')
          .delete()
          .in('id', idsToDelete)
          .eq('user_id', user.value!.id)
        if (error)
          throw new Error(error.message)

        invalidateAllSearchCaches()

        notes.value = notes.value.filter(n => !idsToDelete.includes(n.id))
        cachedNotes.value = cachedNotes.value.filter(n => !idsToDelete.includes(n.id))

        if (lastSavedId.value && idsToDelete.includes(lastSavedId.value)) {
          newNoteContent.value = ''
          lastSavedId.value = null
          editingNote.value = null
          localStorage.removeItem(LOCAL_NOTE_ID_KEY)
          localStorage.removeItem(LOCAL_CONTENT_KEY)
        }

        totalNotes.value = Math.max(0, (totalNotes.value || 0) - idsToDelete.length)
        hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
        hasPreviousNotes.value = currentPage.value > 1

        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
        localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))

        isSelectionModeActive.value = false
        selectedNoteIds.value = []

        messageHook.success(t('notes.delete_success_multiple', { count: idsToDelete.length }))
      }
      catch (err: any) {
        messageHook.error(`${t('notes.delete_error')}: ${err.message || t('notes.try_again')}`)
      }
      finally {
        loading.value = false
      }
    },
  })
}

function handleMainMenuSelect(rawKey: string) {
  const toHashTag = (k: string) => {
    let kk = k || ''
    if (kk.startsWith('tag:'))
      kk = kk.slice(4)
    kk = kk.trim()
    if (!kk)
      return ''
    if (!kk.startsWith('#'))
      kk = `#${kk}`
    return kk
  }

  if (rawKey.startsWith('tag:') || rawKey.startsWith('#')) {
    const tag = toHashTag(rawKey)
    if (tag) {
      fetchNotesByTag(tag)
      mainMenuVisible.value = false
    }
    return
  }

  switch (rawKey) {
    case 'calendar':
      showCalendarView.value = true
      break
    case 'toggleSelection':
      toggleSelectionMode()
      break
    case 'settings':
      showSettingsModal.value = true
      break
    case 'export':
      handleBatchExport()
      break
    case 'account':
      showAccountModal.value = true
      break
    case 'tags':
      break
    case 'trash':
      showTrashModal.value = true
      mainMenuVisible.value = false
      break
    default:
      break
  }
}

async function handleEditFromCalendar(noteToFind: any) {
  showCalendarView.value = false
  if (isAnniversaryViewActive.value)
    handleAnniversaryToggle(null)
  if (activeTagFilter.value)
    clearTagFilter()
  if (searchQuery.value || isShowingSearchResults.value)
    handleCancelSearch()
  await nextTick()

  const noteExists = notes.value.some(n => n.id === noteToFind.id)
  if (!noteExists)
    notes.value.unshift(noteToFind)

  await nextTick()

  if (noteListRef.value)
    (noteListRef.value as any).focusAndEditNote(noteToFind.id)
  else
    messageHook.error('无法与笔记列表通信，请重试。')
}

async function fetchNotesByTag(tag: string) {
  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }
  if (!tag)
    return
  const normalize = (k: string) => (k.startsWith('#') ? k : `#${k}`)
  const hashTag = normalize(tag)

  isShowingSearchResults.value = false
  showSearchBar.value = false
  searchQuery.value = ''
  sessionStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
  sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
  if (!user.value)
    return

  if (!activeTagFilter.value)
    mainNotesCache = [...notes.value]

  const cacheKey = getTagCacheKey(hashTag)
  activeTagFilter.value = hashTag

  const cachedData = localStorage.getItem(cacheKey)
  if (cachedData) {
    const cachedNotes0 = JSON.parse(cachedData)
    notes.value = cachedNotes0
    filteredNotesCount.value = cachedNotes0.length
    hasMoreNotes.value = false
    return
  }

  isLoadingNotes.value = true
  notes.value = []
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.value.id)
      .ilike('content', `%${hashTag}%`)
      .order('created_at', { ascending: false })
    if (error)
      throw error
    notes.value = data || []
    filteredNotesCount.value = notes.value.length
    localStorage.setItem(cacheKey, JSON.stringify(notes.value))
    hasMoreNotes.value = false
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message}`)
  }
  finally {
    isLoadingNotes.value = false
  }
}

function clearTagFilter() {
  activeTagFilter.value = null
  notes.value = mainNotesCache
  mainNotesCache = []
  hasMoreNotes.value = notes.value.length < totalNotes.value
  noteListKey.value++
}

const _usedTemplateFns = [handleCopySelected, handleDeleteSelected, handleEditFromCalendar]

// 包装：模板里避免多语句
function onTrashRestoredWrapper() {
  invalidateAllTagCaches()
  handleTrashRestored()
}
function onTrashPurgedWrapper() {
  invalidateAllTagCaches()
  handleTrashPurged()
}
function handleRequestScroll() {
  if (noteListRef.value) {
    // 调用 NoteList.vue 中已经存在的 scrollComposerIntoView 方法
    // 传入 40 是为了对齐 .scroller 样式中的 padding-top: 40px，使输入框正好贴到悬浮月份条下方
    noteListRef.value.scrollComposerIntoView(40)
  }
}
</script>

<template>
  <div class="auth-container" :class="{ 'is-typing': compactWhileTyping }" :aria-busy="!isReady">
    <template v-if="user">
      <div v-show="!isEditorActive" class="page-header" @click="handleHeaderClick">
        <div class="dropdown-menu-container">
          <NDropdown
            v-model:show="mainMenuVisible"
            trigger="click"
            placement="bottom-start"
            :options="mainMenuOptions"
            :show-arrow="false"
            :width="240"
            @select="handleMainMenuSelect"
          >
            <button class="header-action-btn" @click.stop>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M4 6h16v2H4zm0 5h12v2H4zm0 5h8v2H4z" />
              </svg>
            </button>
          </NDropdown>
        </div>
        <h1 class="page-title">{{ $t('notes.notes') }}</h1>
        <div class="header-actions">
          <button class="header-action-btn" @click.stop="toggleSearchBar">🔍</button>
        </div>
      </div>

      <Transition name="slide-fade">
        <div
          v-if="isSelectionModeActive"
          class="selection-actions-banner"
          role="region"
          aria-live="polite"
        >
          <div class="banner-left">
            <strong>{{ $t('notes.select_notes') }}</strong>
            <span class="sep">·</span>
            <span>{{ $t('notes.items_selected', { count: selectedNoteIds.length }) }}</span>
          </div>
          <div class="banner-right">
            <button
              class="action-btn copy-btn"
              :disabled="selectedNoteIds.length === 0"
              @click="handleCopySelected"
            >
              {{ $t('notes.copy') }}
            </button>
            <button
              class="action-btn delete-btn"
              :disabled="selectedNoteIds.length === 0"
              @click="handleDeleteSelected"
            >
              {{ $t('notes.delete') }}
            </button>
            <button class="finish-btn" @click="finishSelectionMode">
              {{ $t('notes.cancel') || '完成' }}
            </button>
          </div>
        </div>
      </Transition>

      <Transition name="slide-fade">
        <div v-if="showSearchBar" v-show="!isEditorActive && !isSelectionModeActive" class="search-bar-container">
          <NoteActions
            ref="noteActionsRef"
            v-model="searchQuery"
            class="search-actions-wrapper"
            :all-tags="allTags"
            :is-exporting="isExporting"
            :search-query="searchQuery"
            :user="user"
            :show-export-button="!isShowingSearchResults"
            @export="handleExportTrigger"
            @search-started="handleSearchStarted"
            @search-completed="handleSearchCompleted"
            @search-cleared="handleSearchCleared"
          />
          <button class="cancel-search-btn" @click="handleCancelSearch">{{ $t('notes.cancel') }}</button>
        </div>
      </Transition>

      <AnniversaryBanner v-show="showAnniversaryBanner" ref="anniversaryBannerRef" @toggle-view="handleAnniversaryToggle" />

      <div v-if="activeTagFilter" v-show="!isEditorActive && !isSelectionModeActive" class="active-filter-bar">
        <span class="banner-info">
          <span class="banner-text-main">
            正在筛选标签：<strong>{{ activeTagFilter }}</strong>
          </span>
          <span class="banner-text-count">
            共 {{ filteredNotesCount }} 条笔记
          </span>
        </span>
        <div class="banner-actions">
          <button class="export-results-btn" @click="handleExportTrigger">导出</button>
          <button class="clear-filter-btn" @click="clearTagFilter">×</button>
        </div>
      </div>

      <div v-if="isShowingSearchResults" v-show="!isEditorActive && !isSelectionModeActive" class="active-filter-bar search-results-bar">
        <span class="banner-info">
          <span class="banner-text-main">
            搜索“<strong>{{ searchQuery }}</strong>”的结果
          </span>
          <span class="banner-text-count">
            共 {{ notes.length }} 条笔记
          </span>
        </span>
        <div class="banner-actions">
          <button class="export-results-btn" @click="handleExportTrigger">
            导出
          </button>
        </div>
      </div>

      <!-- ⚠️ 已移除：顶部独立的新输入框（不再放在列表外） -->

      <div v-if="showNotesList" class="notes-list-container">
        <NoteList
          ref="noteListRef" :key="noteListKey"
          :notes="displayedNotes"
          :is-loading="isLoadingNotes"
          :has-more="hasMoreNotes"
          :is-selection-mode-active="isSelectionModeActive"
          :selected-note-ids="selectedNoteIds"
          :all-tags="allTags"
          :max-note-length="maxNoteLength"
          :search-query="searchQuery"
          @load-more="nextPage"
          @update-note="handleUpdateNote"
          @delete-note="triggerDeleteConfirmation"
          @pin-note="handlePinToggle"
          @copy-note="handleCopy"
          @task-toggle="handleNoteContentClick"
          @toggle-select="handleToggleSelect"
          @date-updated="fetchNotes"
        >
          <!-- 🔌 通过插槽把“旧的输入框”插进 NoteList 的滚动容器顶部 -->
          <template #composer>
            <div v-show="!isSelectionModeActive" ref="newNoteEditorContainerRef" class="new-note-editor-container">
              <NoteEditor
                ref="newNoteEditorRef"
                v-model="newNoteContent"
                :is-editing="false"
                :is-loading="isCreating"
                :max-note-length="maxNoteLength"
                :placeholder="$t('notes.content_placeholder')"
                :all-tags="allTags"
                @save="handleCreateNote"
                @focus="onComposerFocus"
                @blur="onEditorBlur"
                @request-scroll-into-view="handleRequestScroll"
              />
            </div>
          </template>
        </NoteList>
      </div>

      <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />
      <AccountModal :show="showAccountModal" :email="user?.email" :total-notes="totalNotes" :user="user" @close="showAccountModal = false" />
      <TrashModal
        v-if="showTrashModal"
        :show="showTrashModal"
        @close="showTrashModal = false"
        @restored="onTrashRestoredWrapper"
        @purged="onTrashPurgedWrapper"
      />

      <Transition name="slide-up-fade">
        <CalendarView
          v-if="showCalendarView" ref="calendarViewRef"
          @close="showCalendarView = false"
          @edit-note="handleEditFromCalendar"
          @copy="handleCopy"
          @pin="handlePinToggle"
          @delete="triggerDeleteConfirmation"
        />
      </Transition>
    </template>
    <template v-else>
      <Authentication />
    </template>
  </div>
</template>

<style scoped>
.auth-container {
  max-width: 480px;
  margin: 0 auto;
  padding: 0 1.5rem 0.75rem 1.5rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  position: relative;
}
.dark .auth-container { background: #1e1e1e; color: #e0e0e0; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); }

.notes-list-container {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  overflow-y: hidden;
  position: relative;
}

/* 旧输入框复用原样式；现在它通过插槽位于 NoteList 的滚动容器顶部，会跟随滚动 */
.new-note-editor-container {
  padding-top: 0.5rem;
  padding-bottom: 1rem;
  flex-shrink: 0;
}

.page-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 3000;
  background: white;
  height: 44px;
  padding-top: 0.75rem;
}
.dark .page-header { background: #1e1e1e; }
.page-title {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: 22px; font-weight: 600; margin: 0;
}
.dark .page-title { color: #f0f0f0; }
.header-actions { display: flex; align-items: center; gap: 0.5rem; }
.header-action-btn {
  font-size: 16px; background: none; border: none; padding: 4px; cursor: pointer; color: #555;
  border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s ease;
}
.header-action-btn:hover { background-color: rgba(0,0,0,0.05); }
.dark .header-action-btn { color: #bbb; }
.dark .header-action-btn:hover { background-color: rgba(255,255,255,0.1); }

/* 选择模式横幅、搜索条、过滤条等样式保持不变（略）… */
.selection-actions-banner { position: sticky; top: 44px; z-index: 2500; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background-color: #eef2ff; color: #4338ca; padding: 8px 12px; border-radius: 8px; margin: 8px 0 10px 0; font-size: 14px; }
.dark .selection-actions-banner { background-color: #312e81; color: #c7d2fe; }
.selection-actions-banner .banner-left { display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.selection-actions-banner .sep { opacity: 0.6; }
.selection-actions-banner .banner-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.selection-actions-banner .action-btn, .selection-actions-banner .finish-btn { background: none; border: 1px solid #6366f1; color: #4338ca; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
.selection-actions-banner .action-btn:disabled, .selection-actions-banner .finish-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.selection-actions-banner .action-btn:hover, .selection-actions-banner .finish-btn:hover { background-color: #4338ca; color: #fff; }
.dark .selection-actions-banner .action-btn, .dark .selection-actions-banner .finish-btn { border-color: #a5b4fc; color: #c7d2fe; }
.dark .selection-actions-banner .action-btn:hover, .dark .selection-actions-banner .finish-btn:hover { background-color: #a5b4fc; color: #312e81; }
.selection-actions-banner .delete-btn { border-color: #ef4444; color: #b91c1c; }
.dark .selection-actions-banner .delete-btn { border-color: #fca5a5; color: #fecaca; }

.slide-up-fade-enter-active,.slide-up-fade-leave-active { transition: transform 0.3s ease, opacity 0.3s ease; }
.slide-up-fade-enter-from,.slide-up-fade-leave-to { opacity: 0; transform: translate(-50%, 20px); }

.search-bar-container { position: -webkit-sticky; position: sticky; top: 44px; z-index: 9; background: white; padding-top: 0.5rem; padding-bottom: 0.5rem; display: flex; gap: 0.5rem; align-items: center; }
.dark .search-bar-container { background: #1e1e1e; }
.search-actions-wrapper { flex: 1; min-width: 0; }
@media (max-width: 768px) { .cancel-search-btn { font-size: 14px; padding: 0.6rem 1rem; } }

.clear-filter-btn { background: none; border: none; font-size: 20px; font-weight: bold; cursor: pointer; color: inherit; opacity: 0.7; transition: opacity 0.2s; }
.clear-filter-btn:hover { opacity: 1; }

.active-filter-bar .export-results-btn { background: none; border: 1px solid #6366f1; color: #4338ca; padding: 4px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
.search-results-bar .export-results-btn:hover { background-color: #4338ca; color: white; }
.dark .search-results-bar .export-results-btn { border-color: #a5b4fc; color: #c7d2fe; }
.dark .search-results-bar .export-results-btn:hover { background-color: #a5b4fc; color: #312e81; }

.active-filter-bar { display: flex; align-items: center; gap: 1rem; background-color: #eef2ff; color: #4338ca; padding: 8px 12px; border-radius: 8px; margin-bottom: 1rem; font-size: 14px; }
.banner-info { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: space-between; }
.banner-text-main { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner-text-count { flex-shrink: 0; margin-left: 1rem; color: #6c757d; }
.dark .banner-text-count { color: #adb5bd; }
.banner-actions { flex-shrink: 0; display: flex; align-items: center; gap: 0.75rem; }

.dark .active-filter-bar { background-color: #312e81; color: #c7d2fe; }

.auth-container.is-typing .new-note-editor-container { padding-top: 0.25rem; }
</style>

<style>
/* 下拉菜单全局样式（保留） */
.n-dropdown-menu { max-height: min(70vh, 520px) !important; overflow: auto !important; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.n-dropdown-menu .n-dropdown-menu { max-height: min(60vh, 420px) !important; overflow: auto !important; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-right: 4px; }
.n-dropdown-menu .n-dropdown-menu .n-dropdown-option { line-height: 1.2; }
@media (max-width: 768px) { .n-dropdown-menu .n-dropdown-menu { max-height: 70vh !important; } }
</style>
