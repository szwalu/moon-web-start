<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { NDatePicker, NDropdown, useDialog, useMessage } from 'naive-ui'
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

const SettingsModal = defineAsyncComponent(() => import('@/components/SettingsModal.vue'))
const AccountModal = defineAsyncComponent(() => import('@/components/AccountModal.vue'))
const CalendarView = defineAsyncComponent(() => import('@/components/CalendarView.vue'))

useDark()
const { t } = useI18n()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()
const noteListRef = ref(null)
const newNoteEditorContainerRef = ref(null)
const newNoteEditorRef = ref(null)
const showCalendarView = ref(false)
const showSettingsModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const showSearchBar = ref(false)
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
const maxNoteLength = 5000
const searchQuery = ref('')
const isExporting = ref(false)
const isReady = ref(false)
const allTags = ref<string[]>([])
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
const isEditorFocused = ref(false)
let mainNotesCache: any[] = []
const LOCAL_CONTENT_KEY = 'new_note_content_draft'
const LOCAL_NOTE_ID_KEY = 'last_edited_note_id'
let authListener: any = null

const mainMenuOptions = computed(() => [
  {
    label: '标签',
    key: 'tags',
    children: allTags.value.length > 0
      ? allTags.value.map(tag => ({
        label: tag,
        key: tag,
      }))
      : [{ label: '暂无标签', key: 'no_tags', disabled: true }],
  },
  { label: '日历', key: 'calendar' },
  { label: isSelectionModeActive.value ? t('notes.cancel_selection') : t('notes.select_notes'), key: 'toggleSelection' },
  { label: t('settings.font_title'), key: 'settings' },
  { label: t('notes.export_all'), key: 'export' },
  { label: t('auth.account_title'), key: 'account' },
])

onMounted(() => {
  isLoadingNotes.value = true
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
  const result = supabase.auth.onAuthStateChange(
    (event, session) => {
      const currentUser = session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser
      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser))) {
        nextTick(async () => {
          await fetchNotes()
          fetchAllTags()
          anniversaryBannerRef.value?.loadAnniversaryNotes()
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
    },
  )
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
  if (isReady.value) {
    if (val)
      localStorage.setItem(LOCAL_CONTENT_KEY, val)
    else
      localStorage.removeItem(LOCAL_CONTENT_KEY)
  }
})

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
}

async function handleCreateNote(content: string) {
  isCreating.value = true
  const saved = await saveNote(content, null, { showMessage: true })
  if (saved) {
    localStorage.removeItem(LOCAL_CONTENT_KEY)
    newNoteContent.value = ''
    nextTick(() => {
      newNoteEditorRef.value?.reset()
    })
  }
  isCreating.value = false
}

async function handleUpdateNote({ id, content }: { id: string; content: string }, callback: (success: boolean) => void) {
  const saved = await saveNote(content, id, { showMessage: true })
  if (callback)
    callback(!!saved)
}

async function saveNote(contentToSave: string, noteIdToUpdate: string | null, { showMessage = false } = {}) {
  if (!contentToSave.trim() || !user.value?.id) {
    if (!user.value?.id)
      messageHook.error(t('auth.session_expired'))
    return null
  }
  if (contentToSave.length > maxNoteLength) {
    messageHook.error(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return null
  }
  const noteData = { content: contentToSave.trim(), updated_at: new Date().toISOString(), user_id: user.value.id }
  let savedNote
  try {
    if (noteIdToUpdate) {
      const { data: updatedData, error: updateError } = await supabase.from('notes').update(noteData).eq('id', noteIdToUpdate).eq('user_id', user.value.id).select()
      if (updateError || !updatedData?.length)
        throw new Error(t('auth.update_failed'))
      savedNote = updatedData[0]
      updateNoteInList(savedNote)
      if (showMessage)
        messageHook.success(t('notes.update_success'))
    }
    else {
      const newId = uuidv4()
      const { data: insertedData, error: insertError } = await supabase.from('notes').insert({ ...noteData, id: newId }).select()
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
  return isAnniversaryViewActive.value ? anniversaryNotes.value : notes.value
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
    const { data, error } = await supabase.rpc('get_unique_tags', {
      p_user_id: user.value.id,
    })
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
  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }
  isLoadingNotes.value = true
  notes.value = []
}

function handleSearchCompleted({ data, error }: { data: any[] | null; error: Error | null }) {
  if (error) {
    messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
    notes.value = []
  }
  else {
    notes.value = data || []
  }
  hasMoreNotes.value = false
  hasPreviousNotes.value = false
  isLoadingNotes.value = false
}

function handleSearchCleared() {
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

function handleExportTrigger() {
  if (searchQuery.value.trim())
    handleExportResults()
  else
    handleBatchExport()
}

async function handleBatchExport() {
  showDropdown.value = false
  if (isExporting.value)
    return
  if (!user.value?.id) {
    messageHook.error(t('auth.session_expired'))
    return
  }
  const dialogDateRange = ref<[number, number] | null>(null)
  dialog.info({
    title: t('notes.export_confirm_title'),
    content: () => h(NDatePicker, {
      'value': dialogDateRange.value,
      'type': 'daterange',
      'clearable': true,
      'placeholder': t('notes.select_date_range_placeholder'),
      'class': 'dialog-date-picker',
      'onUpdate:value': (newValue) => {
        dialogDateRange.value = newValue
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
          let query = supabase.from('notes').select('content, created_at').eq('user_id', user.value!.id).order('created_at', { ascending: false }).range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)
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
        const datePart = startDate && endDate ? `${new Date(startDate).toISOString().slice(0, 10)}_to_${new Date(endDate).toISOString().slice(0, 10)}` : 'all'
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
    const { data, error, count } = await supabase.from('notes').select('*', { count: 'exact' }).eq('user_id', user.value.id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).range(from, to)
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
  catch (err) {
    messageHook.error(t('notes.fetch_error'))
  }
  finally {
    isLoadingNotes.value = false
  }
}

async function nextPage() {
  if (isLoadingNotes.value || !hasMoreNotes.value)
    return
  currentPage.value++
  await fetchNotes()
}

function handleHeaderClick() {
  noteListRef.value?.scrollToTop()
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
        const { error } = await supabase.from('notes').delete().eq('id', id).eq('user_id', user.value!.id)
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
          // @ts-expect-error // TS 无法正确推断 defineExpose 暴露出的方法类型
          calendarViewRef.value.refreshData()
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
      if (line.trim().match(/^-\s\[( |x)\]/))
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
  catch (err) {
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
  }
  else {
    anniversaryNotes.value = null
    isAnniversaryViewActive.value = false
  }
}

function toggleSelectionMode() {
  isSelectionModeActive.value = !isSelectionModeActive.value
  if (!isSelectionModeActive.value)
    selectedNoteIds.value = []
  showDropdown.value = false
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
  catch (err) {
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
    positiveText: t('dialog.confirm_button'),
    negativeText: t('dialog.cancel_button'),
    onPositiveClick: () => {
      dialog.warning({
        title: t('dialog.delete_note_title'),
        content: () =>
          h('div', { style: 'line-height:1.6' }, [
            h('p', t('notes.delete_second_confirm_tip', { count: selectedNoteIds.value.length })),
            h('p', { style: 'margin-top:8px;font-weight:600' }, t('notes.delete_second_confirm_hint')),
          ]),
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
    },
  })
}

function handleMainMenuSelect(key: string) {
  if (key.startsWith('#')) {
    fetchNotesByTag(key)
    return
  }
  switch (key) {
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
  }
}

function handleEditFromCalendar(_note: any) {
  showCalendarView.value = false
  messageHook.info('笔记编辑功能已移至主列表，请在主列表找到并编辑该笔记。')
}

function handleClosePage() {
  window.location.href = '/'
}

async function fetchNotesByTag(tag: string) {
  if (!user.value)
    return
  if (!activeTagFilter.value)
    mainNotesCache = [...notes.value]
  const cacheKey = getTagCacheKey(tag)
  const cachedData = localStorage.getItem(cacheKey)
  activeTagFilter.value = tag
  if (cachedData) {
    const cachedNotes = JSON.parse(cachedData)
    notes.value = cachedNotes
    filteredNotesCount.value = cachedNotes.length
    // 关键点：筛选时，禁用无限滚动
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
      .ilike('content', `%${tag}%`)
      .order('created_at', { ascending: false })
    if (error)
      throw error
    notes.value = data || []
    filteredNotesCount.value = notes.value.length
    localStorage.setItem(cacheKey, JSON.stringify(notes.value))
    // 关键点：筛选时，禁用无限滚动
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
  // 关键点：清除筛选后，必须根据当前状态重新计算是否还有更多笔记
  hasMoreNotes.value = notes.value.length < totalNotes.value
}
</script>

<template>
  <div class="auth-container">
    <template v-if="user">
      <div class="page-header" @click="handleHeaderClick">
        <div class="dropdown-menu-container">
          <NDropdown
            trigger="click"
            placement="bottom-start"
            :options="mainMenuOptions"
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
          <button class="header-action-btn close-page-btn" @click.stop="handleClosePage">×</button>
        </div>
      </div>

      <Transition name="slide-fade">
        <div v-if="showSearchBar" class="search-bar-container">
          <NoteActions
            v-model="searchQuery"
            class="search-actions-wrapper"
            :all-tags="allTags"
            :is-exporting="isExporting"
            :search-query="searchQuery"
            :user="user"
            @export="handleExportTrigger"
            @search-started="handleSearchStarted"
            @search-completed="handleSearchCompleted"
            @search-cleared="handleSearchCleared"
          />
          <button class="cancel-search-btn" @click="handleCancelSearch">{{ $t('notes.cancel') }}</button>
        </div>
      </Transition>

      <AnniversaryBanner ref="anniversaryBannerRef" @toggle-view="handleAnniversaryToggle" />

      <div v-if="activeTagFilter" class="active-filter-bar">
        <span>
          正在筛选标签：<strong>{{ activeTagFilter }}</strong>
          <span style="margin-left: 8px; color: #666;">
            共 {{ filteredNotesCount }} 条笔记
          </span>
        </span>
        <button class="clear-filter-btn" @click="clearTagFilter">×</button>
      </div>
      <div
        ref="newNoteEditorContainerRef"
        class="new-note-editor-container"
        :class="{ 'is-focused': isEditorFocused }"
      >
        <NoteEditor
          ref="newNoteEditorRef"
          v-model="newNoteContent"
          :is-editing="false"
          :is-loading="isCreating"
          :max-note-length="maxNoteLength"
          :placeholder="$t('notes.content_placeholder')"
          :all-tags="allTags"
          @save="handleCreateNote"
          @focus="isEditorFocused = true" @blur="isEditorFocused = false"
        />
      </div>

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
        />
      </div>

      <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />
      <AccountModal :show="showAccountModal" :email="user?.email" :total-notes="totalNotes" :user="user" @close="showAccountModal = false" />

      <Transition name="slide-up-fade">
        <div v-if="selectedNoteIds.length > 0" class="selection-actions-popup">
          <div class="selection-info">{{ $t('notes.items_selected', { count: selectedNoteIds.length }) }}</div>
          <div class="selection-buttons">
            <button class="action-btn copy-btn" @click="handleCopySelected">{{ $t('notes.copy') }}</button>
            <button class="action-btn delete-btn" @click="handleDeleteSelected">{{ $t('notes.delete') }}</button>
          </div>
        </div>
      </Transition>

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
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}
.notes-list-container {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  overflow-y: hidden;
  position: relative;
}
.new-note-editor-container {
  padding-top: 0.5rem;
  padding-bottom: 1rem;
  flex-shrink: 0;
  max-height: 40vh;
  overflow-y: auto;
  transition: max-height 0.3s ease-in-out;
}
.new-note-editor-container.is-focused {
  max-height: 80vh; /* 展开时占据屏幕70%的高度 */
}
.page-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 10;
  background: white;
  height: 44px;
  padding-top: 0.75rem;
}
.dark .page-header {
  background: #1e1e1e;
}
.page-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}
.dark .page-title {
    color: #f0f0f0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header-action-btn {
  font-size: 16px;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #555;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}
.header-action-btn:hover {
  background-color: rgba(0,0,0,0.05);
}
.dark .header-action-btn {
  color: #bbb;
}
.dark .header-action-btn:hover {
  background-color: rgba(255,255,255,0.1);
}
.close-page-btn {
  font-size: 28px;
  line-height: 1;
  font-weight: 300;
}
.selection-actions-popup {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 3rem);
  max-width: 432px;
  background-color: #333;
  color: white;
  border-radius: 8px;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  z-index: 15;
}
.dark .selection-actions-popup {
  background-color: #444;
}
.selection-info {
  font-size: 14px;
}
.selection-buttons {
  display: flex;
  gap: 3rem;
}
.action-btn {
  background: none;
  border: none;
  color: white;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  padding: 0.25rem;
}
.action-btn.delete-btn {
  color: #ff5252;
}
.slide-up-fade-enter-active,
.slide-up-fade-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-up-fade-enter-from,
.slide-up-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
.search-bar-container {
  position: -webkit-sticky;
  position: sticky;
  top: 44px;
  z-index: 9;
  background: white;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.dark .search-bar-container {
  background: #1e1e1e;
}
.search-actions-wrapper {
  flex: 1;
  min-width: 0;
}
@media (max-width: 768px) {
  .cancel-search-btn {
    font-size: 14px;
    padding: 0.6rem 1rem;
  }
}
.active-filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #eef2ff;
  color: #4338ca;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 14px;
}
.dark .active-filter-bar {
  background-color: #312e81;
  color: #c7d2fe;
}
.clear-filter-btn {
  background: none;
  border: none;
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  transition: opacity 0.2s;
}
.clear-filter-btn:hover {
  opacity: 1;
}
</style>
