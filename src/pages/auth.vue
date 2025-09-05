<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDark } from '@vueuse/core'
import { NDatePicker, NDropdown, useDialog, useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'
import AnniversaryBanner from '@/components/AnniversaryBanner.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import AccountModal from '@/components/AccountModal.vue'
import NoteActions from '@/components/NoteActions.vue'
import 'easymde/dist/easymde.min.css'

// --- 初始化 & 状态定义 ---
useDark()
const { t } = useI18n()
const router = useRouter()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()

const showSettingsModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const showSearchBar = ref(false)
const notesListWrapperRef = ref<HTMLElement | null>(null)
const user = computed(() => authStore.user)
const loading = ref(false)

// --- 笔记相关状态 ---
const notes = ref<any[]>([])
const content = ref('')
const editingNote = ref<any>(null)
const isLoadingNotes = ref(false)
const showNotesList = ref(true)
const expandedNote = ref<string | null>(null)
const lastSavedId = ref<string | null>(null)
const lastSavedTime = ref('')
const currentPage = ref(1)
const notesPerPage = 20
const totalNotes = ref(0)
const hasMoreNotes = ref(true)
const hasPreviousNotes = ref(false)
const maxNoteLength = 3000
const isNotesCached = ref(false)
const cachedNotes = ref<any[]>([])
const cachedPages = ref(new Map<number, { totalNotes: number; hasMoreNotes: boolean; hasPreviousNotes: boolean; notes: any[] }>())
const searchQuery = ref('')
const isExporting = ref(false)
const isReady = ref(false)
const allTags = ref<string[]>([])

// 多选
const isSelectionModeActive = ref(false)
const selectedNoteIds = ref<string[]>([])

const isRestoringFromCache = ref(false)

// 那年今日
const anniversaryBannerRef = ref<InstanceType<typeof AnniversaryBanner> | null>(null)
const anniversaryNotes = ref<any[] | null>(null)
const isAnniversaryViewActive = ref(false)

const LOCAL_CONTENT_KEY = 'note_content'
const LOCAL_NOTE_ID_KEY = 'note_id'
const CACHED_NOTES_KEY = 'cached_notes_page_1'

let authListener: any = null

const mainMenuOptions = computed(() => [
  {
    label: isSelectionModeActive.value ? t('notes.cancel_selection') : t('notes.select_notes'),
    key: 'toggleSelection',
  },
  {
    label: t('settings.font_title'),
    key: 'settings',
  },
  {
    label: t('notes.export_all'),
    key: 'export',
  },
  {
    label: t('auth.account_title'),
    key: 'account',
  },
])

// --- 核心认证逻辑 ---
onMounted(() => {
  const cachedData = localStorage.getItem(CACHED_NOTES_KEY)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (cachedData) {
    notes.value = JSON.parse(cachedData)
    isNotesCached.value = true
  }

  const result = supabase.auth.onAuthStateChange(
    (event, session) => {
      const currentUser = session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser

      if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser)) {
        nextTick(() => {
          fetchNotes()
          fetchAllTags()
        })
      }
      else if (event === 'SIGNED_OUT') {
        notes.value = []
        allTags.value = []
        content.value = ''
        editingNote.value = null
        localStorage.removeItem(CACHED_NOTES_KEY)
      }
    },
  )
  authListener = result.data.subscription

  isRestoringFromCache.value = true
  const savedContent = localStorage.getItem(LOCAL_CONTENT_KEY)
  if (savedContent)
    content.value = savedContent

  const savedNoteId = localStorage.getItem(LOCAL_NOTE_ID_KEY)
  if (savedNoteId)
    lastSavedId.value = savedNoteId

  isReady.value = true
  nextTick(() => {
    isRestoringFromCache.value = false
  })
})

const debouncedSaveNote = debounce(() => {
  if (content.value && user.value?.id && !isRestoringFromCache.value)
    saveNote({ showMessage: false })
}, 12000)

onUnmounted(() => {
  if (authListener)
    authListener.unsubscribe()
  debouncedSaveNote.cancel()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

// 可见性切回检查
async function handleVisibilityChange() {
  if (document.visibilityState !== 'visible')
    return
  const { data, error } = await supabase.auth.getSession()
  if ((!data.session || error) && authStore.user) {
    messageHook.warning(t('auth.session_expired_relogin'))
    authStore.user = null
    notes.value = []
    allTags.value = []
    content.value = ''
    editingNote.value = null
    localStorage.removeItem(CACHED_NOTES_KEY)
    localStorage.removeItem(LOCAL_CONTENT_KEY)
    localStorage.removeItem(LOCAL_NOTE_ID_KEY)
  }
}

// --- 派生 ---
const displayedNotes = computed(() => {
  return isAnniversaryViewActive.value ? anniversaryNotes.value : notes.value
})

// --- Tags ---
async function fetchAllTags() {
  if (!user.value?.id)
    return
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('content')
      .eq('user_id', user.value.id)
    if (error)
      throw error

    const tagSet = new Set<string>()
    const tagRegex = /#([^\s#.,?!;:"'()\[\]{}]+)/g
    if (data) {
      for (const note of data) {
        let match
        // eslint-disable-next-line no-cond-assign
        while ((match = tagRegex.exec(note.content)) !== null) {
          if (match[1])
            tagSet.add(`#${match[1]}`)
        }
      }
    }
    allTags.value = Array.from(tagSet).sort()
  }
  catch (err: any) {
    messageHook.error(`Failed to fetch tags: ${err.message}`)
  }
}

// --- 搜索 ---
const debouncedSearch = debounce(async () => {
  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }

  if (!searchQuery.value.trim()) {
    currentPage.value = 1
    cachedPages.value.clear()
    await fetchNotes()
    return
  }

  isLoadingNotes.value = true
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.value.id)
      .ilike('content', `%${searchQuery.value.trim()}%`)
      .order('updated_at', { ascending: false })
      .limit(100)
    if (error)
      throw error
    notes.value = data || []
    hasMoreNotes.value = false
    hasPreviousNotes.value = false
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message}`)
  }
  finally {
    isLoadingNotes.value = false
  }
}, 500)

watch(searchQuery, () => {
  debouncedSearch()
})

// 内容本地缓存与长度校验
watch(content, (val) => {
  if (!isReady.value || isRestoringFromCache.value)
    return
  if (val)
    localStorage.setItem(LOCAL_CONTENT_KEY, val)
  else localStorage.removeItem(LOCAL_CONTENT_KEY)

  if (val.length > maxNoteLength) {
    content.value = val.slice(0, maxNoteLength)
    messageHook.warning(t('notes.max_length_exceeded', { max: maxNoteLength }))
  }

  if (!authStore.user) {
    // 仅日志/排查用途
    // console.error('Auto-save: No valid session in authStore')
  }
})

// --- 导出 ---
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

function handleExportTrigger() {
  if (searchQuery.value.trim())
    handleExportResults()
  else handleBatchExport()
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
    content: () => h(NDatePicker, {
      'value': dialogDateRange.value,
      'type': 'daterange',
      'clearable': true,
      'placeholder': t('notes.select_date_range_placeholder'),
      'class': 'dialog-date-picker',
      'onUpdate:value': (newValue: any) => {
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

// 列表操作
function addNoteToList(newNote: any) {
  if (!notes.value.some(note => note.id === newNote.id)) {
    notes.value.unshift(newNote)
    cachedNotes.value.unshift(newNote)
    if (currentPage.value === 1 && showNotesList.value)
      notes.value = notes.value.slice(0, notesPerPage)

    totalNotes.value += 1
    hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
    hasPreviousNotes.value = currentPage.value > 1
    if (!searchQuery.value) {
      cachedPages.value.set(currentPage.value, {
        totalNotes: totalNotes.value,
        hasMoreNotes: hasMoreNotes.value,
        hasPreviousNotes: hasPreviousNotes.value,
        notes: notes.value.slice(),
      })
    }
    nextTick()
  }
}

async function handlePinToggle(note: any) {
  if (!note || !user.value)
    return
  const newPinStatus = !note.is_pinned
  try {
    const { error } = await supabase
      .from('notes')
      .update({ is_pinned: newPinStatus })
      .eq('id', note.id)
      .eq('user_id', user.value.id)
    if (error)
      throw error
    messageHook.success(newPinStatus ? t('notes.pinned_success') : t('notes.unpinned_success'))
    cachedPages.value.clear()
    await fetchNotes()
  }
  catch (err: any) {
    messageHook.error(`${t('notes.operation_error')}: ${err.message}`)
  }
}

function updateNoteInList(updatedNote: any) {
  const updateInArray = (arr: any[]) => {
    const index = arr.findIndex(n => n.id === updatedNote.id)
    if (index !== -1)
      arr[index] = { ...updatedNote }
  }
  updateInArray(notes.value)
  updateInArray(cachedNotes.value)
  if (!searchQuery.value) {
    const cachedPage = cachedPages.value.get(currentPage.value)
    if (cachedPage) {
      updateInArray(cachedPage.notes)
      cachedPages.value.set(currentPage.value, { ...cachedPage })
    }
  }
  nextTick()
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
      .select('*', { count: 'exact' })
      .eq('user_id', user.value.id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
    if (error) {
      messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
      return
    }
    const newNotes = data || []
    totalNotes.value = count || 0
    if (currentPage.value > 1)
      notes.value = [...notes.value, ...newNotes]
    else notes.value = newNotes

    if (currentPage.value === 1 && newNotes.length > 0)
      localStorage.setItem(CACHED_NOTES_KEY, JSON.stringify(newNotes))

    hasMoreNotes.value = to + 1 < totalNotes.value
    hasPreviousNotes.value = currentPage.value > 1
    cachedPages.value.set(currentPage.value, {
      totalNotes: totalNotes.value,
      hasMoreNotes: hasMoreNotes.value,
      hasPreviousNotes: hasPreviousNotes.value,
      notes: notes.value.slice(),
    })
    isNotesCached.value = true
  }
  catch (err) {
    messageHook.error(t('notes.fetch_error'))
  }
  finally {
    isLoadingNotes.value = false
    nextTick()
  }
}

async function nextPage() {
  if (isLoadingNotes.value || !hasMoreNotes.value)
    return
  currentPage.value++
  await fetchNotes()
}

function generateUniqueId() {
  return uuidv4()
}

async function toggleExpand(noteId: string) {
  if (expandedNote.value === noteId) {
    const noteElement = document.querySelector(`[data-note-id="${noteId}"]`)
    expandedNote.value = null
    await nextTick()
    if (noteElement)
      noteElement.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }
  else {
    expandedNote.value = noteId
  }
}

async function saveNote({ showMessage = false } = {}) {
  if (!content.value || !user.value?.id) {
    if (!user.value?.id)
      messageHook.error(t('auth.session_expired'))
    return null
  }
  if (content.value.length > maxNoteLength) {
    messageHook.error(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return null
  }
  const now = Date.now()
  const note = {
    content: content.value.trim(),
    updated_at: new Date().toISOString(),
    user_id: user.value.id,
  }
  let savedNote: any
  try {
    const noteId = lastSavedId.value || editingNote.value?.id
    if (noteId) {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('id', noteId)
        .eq('user_id', user.value.id)
        .single()
      if (data && !error) {
        const { data: updatedData, error: updateError } = await supabase
          .from('notes')
          .update(note)
          .eq('id', noteId)
          .eq('user_id', user.value.id)
          .select()
        if (updateError || !updatedData?.length)
          throw new Error(t('auth.update_failed'))
        savedNote = updatedData[0]
        updateNoteInList(savedNote)
      }
      else {
        const newId = generateUniqueId()
        const { data: insertedData, error: insertError } = await supabase
          .from('notes')
          .insert({ ...note, id: newId })
          .select()
        if (insertError || !insertedData?.length)
          throw new Error(t('auth.insert_failed_create_note'))
        savedNote = insertedData[0]
        addNoteToList(savedNote)
        lastSavedId.value = savedNote.id
      }
    }
    else {
      const newId = generateUniqueId()
      const { data: insertedData, error: insertError } = await supabase
        .from('notes')
        .insert({ ...note, id: newId })
        .select()
      if (insertError || !insertedData?.length)
        throw new Error(t('auth.insert_failed_create_note'))
      savedNote = insertedData[0]
      addNoteToList(savedNote)
      lastSavedId.value = savedNote.id
    }

    localStorage.setItem(LOCAL_NOTE_ID_KEY, savedNote.id)
    lastSavedTime.value = new Date(now)
      .toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .replace(/\//g, '.')

    if (showMessage)
      messageHook.success(editingNote.value ? t('notes.update_success') : t('notes.auto_saved', '保存成功'))

    if (savedNote)
      await fetchAllTags()
    return savedNote
  }
  catch (error: any) {
    messageHook.error(`${t('notes.operation_error')}: ${error.message || '未知错误'}`)
    return null
  }
}

function resetEditorAndState() {
  content.value = ''
  editingNote.value = null
  lastSavedId.value = null
  lastSavedTime.value = ''
  localStorage.removeItem(LOCAL_NOTE_ID_KEY)
  localStorage.removeItem(LOCAL_CONTENT_KEY)
}

function handleHeaderClick() {
  if (!notesListWrapperRef.value)
    return
  notesListWrapperRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}

async function handleSubmit() {
  debouncedSaveNote.cancel()
  const timeout = setTimeout(() => {
    messageHook.error(t('auth.session_expired_or_timeout'))
    loading.value = false
  }, 30000)

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.user) {
      messageHook.error(t('auth.session_expired'))
      clearTimeout(timeout)
      return
    }
    if (!content.value) {
      messageHook.warning(t('notes.content_required'))
      clearTimeout(timeout)
      return
    }
    loading.value = true
    const saved = await saveNote({ showMessage: true })
    if (saved)
      resetEditorAndState() // 顶部编辑器模式：保存后清空进入新建态
  }
  catch (err: any) {
    messageHook.error(`${t('notes.operation_error')}: ${err.message || '未知错误'}`)
  }
  finally {
    clearTimeout(timeout)
    loading.value = false
  }
}

function handleEdit(note: any) {
  if (!note?.id)
    return
  content.value = note.content
  editingNote.value = { ...note }
  lastSavedId.value = note.id
  localStorage.setItem(LOCAL_NOTE_ID_KEY, note.id)
}

// 常驻编辑器的 close 事件（此模式下无实际关闭动作）
function handleEditorClose() {
  // 可选择：resetEditorAndState()
}

async function triggerDeleteConfirmation(id: string) {
  if (!id || !user.value?.id)
    return
  dialog.warning({
    title: t('notes.delete_confirm_title'),
    content: t('notes.delete_confirm_content'),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      debouncedSaveNote.cancel()
      try {
        loading.value = true
        const { error } = await supabase
          .from('notes')
          .delete()
          .eq('id', id)
          .eq('user_id', user.value!.id)
        if (error)
          throw new Error(error.message || '删除失败')

        notes.value = notes.value.filter(note => note.id !== id)
        cachedNotes.value = cachedNotes.value.filter(note => note.id !== id)

        if (id === lastSavedId.value)
          resetEditorAndState()

        totalNotes.value = Math.max(0, (totalNotes.value || 0) - 1)
        hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
        hasPreviousNotes.value = currentPage.value > 1
        cachedPages.value.clear()

        messageHook.success(t('notes.delete_success'))
      }
      catch (err: any) {
        messageHook.error(`删除失败: ${err.message || '请稍后重试'}`)
      }
      finally {
        loading.value = false
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
      lines[lineIndexToChange] = lineContent.includes('[ ]')
        ? lineContent.replace('[ ]', '[x]')
        : lineContent.replace('[x]', '[ ]')

      const newContent = lines.join('\n')
      noteToUpdate.content = newContent
      await supabase
        .from('notes')
        .update({ content: newContent, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('user_id', user.value!.id)
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

// 多选
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
  else selectedNoteIds.value.push(noteId)
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
            const { error } = await supabase
              .from('notes')
              .delete()
              .in('id', idsToDelete)
              .eq('user_id', user.value!.id)
            if (error)
              throw new Error(error.message)

            notes.value = notes.value.filter(n => !idsToDelete.includes(n.id))
            cachedNotes.value = cachedNotes.value.filter(n => !idsToDelete.includes(n.id))

            if (lastSavedId.value && idsToDelete.includes(lastSavedId.value))
              resetEditorAndState()

            totalNotes.value = Math.max(0, (totalNotes.value || 0) - idsToDelete.length)
            hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
            hasPreviousNotes.value = currentPage.value > 1
            cachedPages.value.clear()

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
  switch (key) {
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
        <h1 class="page-title">
          {{ $t('notes.notes') }}
        </h1>

        <div class="header-actions">
          <button class="header-action-btn" @click.stop="toggleSearchBar">
            🔍
          </button>
          <button class="header-action-btn close-page-btn" @click.stop="router.push('/')">
            ×
          </button>
        </div>
      </div>

      <Transition name="slide-fade">
        <div v-if="showSearchBar" class="search-bar-container">
          <NoteActions
            v-model="searchQuery"
            :all-tags="allTags"
            :is-exporting="isExporting"
            :search-query="searchQuery"
            @export="handleExportTrigger"
          />
          <button class="cancel-search-btn" @click="handleCancelSearch">
            {{ $t('notes.cancel') }}
          </button>
        </div>
      </Transition>

      <AnniversaryBanner ref="anniversaryBannerRef" @toggle-view="handleAnniversaryToggle" />

      <div v-if="showNotesList" ref="notesListWrapperRef" class="notes-list-wrapper">
        <!-- 顶端常驻编辑器（仿 Memos） -->
        <NoteEditor
          v-model="content"
          :editing-note="editingNote"
          :is-loading="loading"
          :all-tags="allTags"
          :max-note-length="maxNoteLength"
          :last-saved-time="lastSavedTime"
          @submit="handleSubmit"
          @trigger-auto-save="debouncedSaveNote"
          @close="handleEditorClose"
        />

        <!-- 笔记列表 -->
        <NoteList
          :notes="displayedNotes"
          :is-loading="isLoadingNotes"
          :expanded-note-id="expandedNote"
          :has-more="!isAnniversaryViewActive && hasMoreNotes"
          :scroll-container="notesListWrapperRef"
          :is-selection-mode-active="isSelectionModeActive"
          :selected-note-ids="selectedNoteIds"
          @load-more="nextPage"
          @toggle-expand="toggleExpand"
          @edit="handleEdit"
          @copy="handleCopy"
          @pin="handlePinToggle"
          @delete="triggerDeleteConfirmation"
          @task-toggle="handleNoteContentClick"
          @toggle-select="handleToggleSelect"
        />
      </div>

      <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />

      <AccountModal
        :show="showAccountModal"
        :email="user?.email"
        :total-notes="totalNotes"
        :user="user"
        @close="showAccountModal = false"
      />

      <Transition name="slide-up-fade">
        <div v-if="selectedNoteIds.length > 0" class="selection-actions-popup">
          <div class="selection-info">
            {{ $t('notes.items_selected', { count: selectedNoteIds.length }) }}
          </div>
          <div class="selection-buttons">
            <button class="action-btn copy-btn" @click="handleCopySelected">
              {{ $t('notes.copy') }}
            </button>
            <button class="action-btn delete-btn" @click="handleDeleteSelected">
              {{ $t('notes.delete') }}
            </button>
          </div>
        </div>
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
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.page-header {
  flex-shrink: 0;
  padding: 0.75rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  position: relative;
  height: 44px;
}

.page-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.dark .page-title { color: #f0f0f0; }

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
.header-action-btn:hover { background-color: rgba(0,0,0,0.05); }
.dark .header-action-btn { color: #bbb; }
.dark .header-action-btn:hover { background-color: rgba(255,255,255,0.1); }

.close-page-btn {
  font-size: 28px;
  line-height: 1;
  font-weight: 300;
}

.dropdown-menu-container { position: relative; }

.search-bar-container {
  position: absolute;
  top: 60px;
  left: 6.5rem;
  right: 6.5rem;
  z-index: 5;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.search-bar-container > :first-child {
  flex: 1;
  min-width: 0;
}

.cancel-search-btn {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  padding: 0.5rem;
  border-radius: 6px;
  transition: background-color 0.2s ease;
  white-space: nowrap;
}
.dark .cancel-search-btn { color: #bbb; }
.cancel-search-btn:hover { background-color: rgba(0,0,0,0.05); }
.dark .cancel-search-btn:hover { background-color: rgba(255,255,255,0.1); }

.notes-list-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 0.5rem;
}

/* 选择浮条 */
.selection-actions-popup {
  position: absolute;
  bottom: 2.5rem;
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
.dark .selection-actions-popup { background-color: #444; }

.selection-info { font-size: 14px; }
.selection-buttons { display: flex; gap: 3rem; }
.action-btn { background: none; border: none; color: white; font-size: 14px; cursor: pointer; font-weight: 500; padding: 0.25rem; }
.action-btn.delete-btn { color: #ff5252; }

/* 过渡 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease-out;
  max-height: 100px;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
  max-height: 0;
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
</style>
