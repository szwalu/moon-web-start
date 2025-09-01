<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDark } from '@vueuse/core'
import { NDatePicker, useDialog, useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'

import AnniversaryBanner from '@/components/AnniversaryBanner.vue'

// 1. 引入新组件
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

const showEditorModal = ref(false)
const showSettingsModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const showSearchBar = ref(false)
const dropdownContainerRef = ref(null)
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

const isRestoringFromCache = ref(false)

// --- 那年今日功能状态 ---
const anniversaryBannerRef = ref<InstanceType<typeof AnniversaryBanner> | null>(null)
const anniversaryNotes = ref<any[] | null>(null)
const isAnniversaryViewActive = ref(false)

const LOCAL_CONTENT_KEY = 'note_content'
const LOCAL_NOTE_ID_KEY = 'note_id'
const CACHED_NOTES_KEY = 'cached_notes_page_1'

let authListener: any = null

// --- 核心认证逻辑 ---
onMounted(() => {
  const cachedData = localStorage.getItem(CACHED_NOTES_KEY)
  if (cachedData) {
    notes.value = JSON.parse(cachedData)
    isNotesCached.value = true
  }

  const result = supabase.auth.onAuthStateChange(
    (event, session) => {
      const currentUser = session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser

      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser))) {
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

  document.removeEventListener('click', closeDropdownOnClickOutside)
  debouncedSaveNote.cancel()
})

// --- 笔记相关方法 ---
const displayedNotes = computed(() => {
  return isAnniversaryViewActive.value ? anniversaryNotes.value : notes.value
})

function closeDropdownOnClickOutside(event: MouseEvent) {
  if (dropdownContainerRef.value && !(dropdownContainerRef.value as HTMLElement).contains(event.target as Node))
    showDropdown.value = false
}

watch(showDropdown, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      document.addEventListener('click', closeDropdownOnClickOutside)
    })
  }
  else {
    document.removeEventListener('click', closeDropdownOnClickOutside)
  }
})

async function fetchAllTags() {
  if (!user.value?.id)
    return
  try {
    const { data, error } = await supabase.from('notes').select('content').eq('user_id', user.value.id)
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
    const { data, error } = await supabase.from('notes').select('*').eq('user_id', user.value.id).ilike('content', `%${searchQuery.value.trim()}%`).order('updated_at', { ascending: false }).limit(100)
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

watch(content, async (val, _oldVal) => {
  // 增加对 isRestoringFromCache.value 的判断
  if (!isReady.value || isRestoringFromCache.value)
    return
  if (val)
    localStorage.setItem(LOCAL_CONTENT_KEY, val)
  else localStorage.removeItem(LOCAL_CONTENT_KEY)
  if (val.length > maxNoteLength) {
    content.value = val.slice(0, maxNoteLength)
    messageHook.warning(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return
  }
  if (!authStore.user)
    console.error('Auto-save: No valid session in authStore')
})

// [ADDED] 新函数：用于导出当前显示的笔记（即搜索结果）
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

// [ADDED] 新的调度函数，根据情况决定执行哪个导出逻辑
function handleExportTrigger() {
  if (searchQuery.value.trim())
    handleExportResults()

  else
    handleBatchExport() // 如果没有搜索词，依然执行导出全部的逻辑
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
    const { error } = await supabase.from('notes').update({ is_pinned: newPinStatus }).eq('id', note.id).eq('user_id', user.value.id)
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
  if (!isNotesCached.value)
    isLoadingNotes.value = true

  try {
    const from = (currentPage.value - 1) * notesPerPage
    const to = from + notesPerPage - 1
    const { data, error, count } = await supabase.from('notes').select('*', { count: 'exact' }).eq('user_id', user.value.id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).range(from, to)
    if (error) {
      messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
      return
    }
    const newNotes = data || []
    totalNotes.value = count || 0

    if (currentPage.value > 1)
      notes.value = [...notes.value, ...newNotes]
    else
      notes.value = newNotes

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
  let savedNote
  try {
    const noteId = lastSavedId.value || editingNote.value?.id
    if (noteId) {
      const { data, error } = await supabase.from('notes').select('*').eq('id', noteId).eq('user_id', user.value.id).single()
      if (data && !error) {
        const { data: updatedData, error: updateError } = await supabase.from('notes').update(note).eq('id', noteId).eq('user_id', user.value.id).select()
        if (updateError || !updatedData?.length)
          throw new Error('更新失败')
        savedNote = updatedData[0]
        updateNoteInList(savedNote)
      }
      else {
        const newId = generateUniqueId()
        const { data: insertedData, error: insertError } = await supabase.from('notes').insert({ ...note, id: newId }).select()
        if (insertError || !insertedData?.length)
          throw new Error('插入失败：无法创建新笔记')
        savedNote = insertedData[0]
        addNoteToList(savedNote)
        lastSavedId.value = savedNote.id
      }
    }
    else {
      const newId = generateUniqueId()
      const { data: insertedData, error: insertError } = await supabase.from('notes').insert({ ...note, id: newId }).select()
      if (insertError || !insertedData?.length)
        throw new Error('插入失败：无法创建新笔记')
      savedNote = insertedData[0]
      addNoteToList(savedNote)
      lastSavedId.value = savedNote.id
    }
    localStorage.setItem(LOCAL_NOTE_ID_KEY, savedNote.id)
    lastSavedTime.value = new Date(now).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(/\//g, '.')
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
  if (notesListWrapperRef.value) {
    notesListWrapperRef.value.scrollTo({
      top: 0,
      behavior: 'smooth', // 使用 'smooth' 可以实现平滑的滚动效果
    })
  }
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
    if (saved) {
      resetEditorAndState()
      showEditorModal.value = false
    }
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
  showEditorModal.value = true
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
        const { error } = await supabase.from('notes').delete().eq('id', id).eq('user_id', user.value!.id)
        if (error)
          throw new Error(error.message || '删除失败')
        notes.value = notes.value.filter(note => note.id !== id)
        cachedNotes.value = cachedNotes.value.filter(note => note.id !== id)
        totalNotes.value -= 1
        hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
        hasPreviousNotes.value = currentPage.value > 1
        if (cachedPages.value.has(currentPage.value)) {
          const pageData = cachedPages.value.get(currentPage.value)
          if (pageData) {
            cachedPages.value.set(currentPage.value, {
              ...pageData,
              totalNotes: totalNotes.value,
              hasMoreNotes: hasMoreNotes.value,
              hasPreviousNotes: hasPreviousNotes.value,
              notes: notes.value.filter(n => n.id !== id),
            })
          }
        }
        if (id === lastSavedId.value) {
          content.value = ''
          lastSavedId.value = null
          editingNote.value = null
          localStorage.removeItem(LOCAL_NOTE_ID_KEY)
        }
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
/*
async function handleLogout() {
  showDropdown.value = false
  loading.value = true
  await supabase.auth.signOut()
  window.location.href = '/'
  loading.value = false
}
*/

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

function handleAddNewNoteClick() {
  debouncedSaveNote.cancel()
  if (editingNote.value)
    resetEditorAndState()

  showEditorModal.value = true
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

function closeEditorModal() {
  showEditorModal.value = false
  debouncedSaveNote.cancel()
}
</script>

<template>
  <div class="auth-container">
    <template v-if="user">
      <div class="page-header" @click="handleHeaderClick">
        <div ref="dropdownContainerRef" class="dropdown-menu-container">
          <button class="header-action-btn" @click.stop="showDropdown = !showDropdown">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M4 6h16v2H4zm0 5h12v2H4zm0 5h8v2H4z"
              />
            </svg>
          </button>
          <Transition name="fade">
            <div v-if="showDropdown" class="dropdown-menu">
              <div class="dropdown-item" @click.stop="showSettingsModal = true; showDropdown = false">
                {{ $t('settings.font_title') }}
              </div>
              <div class="dropdown-item" @click.stop="handleBatchExport">
                {{ $t('notes.export_all') }}
              </div>
              <div class="dropdown-item" @click.stop="showAccountModal = true; showDropdown = false">
                {{ $t('auth.account_title') }}
              </div>
            </div>
          </Transition>
        </div>
        <h1 class="page-title">
          {{ $t('notes.notes') }}
        </h1>

        <div class="header-actions">
          <button class="header-action-btn" @click.stop="toggleSearchBar">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d="m19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5q0-2.725 1.888-4.612T9.5 3q2.725 0 4.612 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.313T14 9.5q0-1.875-1.313-3.188T9.5 5Q7.625 5 6.312 6.313T5 9.5q0 1.875 1.313 3.188T9.5 14" />
            </svg>
          </button>
          <button class="header-action-btn close-page-btn" @click="router.push('/')">
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
        <NoteList
          :notes="displayedNotes"
          :is-loading="isLoadingNotes"
          :expanded-note-id="expandedNote"
          :has-more="!isAnniversaryViewActive && hasMoreNotes"
          :scroll-container="notesListWrapperRef"
          @load-more="nextPage"
          @toggle-expand="toggleExpand"
          @edit="handleEdit"
          @copy="handleCopy"
          @pin="handlePinToggle"
          @delete="triggerDeleteConfirmation"
          @task-toggle="handleNoteContentClick"
        />
      </div>

      <button class="fab" @click="handleAddNewNoteClick">
        +
      </button>

      <div v-if="showEditorModal" class="editor-overlay" @click.self="closeEditorModal">
        <NoteEditor
          v-model="content"
          :editing-note="editingNote"
          :is-loading="loading"
          :all-tags="allTags"
          :max-note-length="maxNoteLength"
          :last-saved-time="lastSavedTime"
          @submit="handleSubmit"
          @trigger-auto-save="debouncedSaveNote"
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
    </template>
    <template v-else>
      <Authentication />
    </template>
  </div>
</template>

<style scoped>
.auth-container {
  max-width: 480px;
  margin: 2rem auto;
  padding: 1rem 1.5rem 0.75rem 1.5rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #333;
  transition: background-color 0.3s ease, color 0.3s ease;
  position: relative;
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.page-header {
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
.dark .page-title {
    color: #f0f0f0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-action-btn {
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
  font-size: 24px;
  line-height: 1;
  font-weight: 300;
}

.dropdown-menu-container {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  border: 1px solid #eee;
  padding: 0.5rem 0;
  z-index: 100;
  width: 120px;
}
.dark .dropdown-menu {
  background: #2c2c2e;
  border-color: #444;
}

.dropdown-item {
  padding: 1.5rem 1rem;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s ease;
}
.dropdown-item:hover {
  background-color: #f0f0f0;
}
.dark .dropdown-item:hover {
  background-color: #3a3a3c;
}

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

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
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
.dark .cancel-search-btn {
  color: #bbb;
}
.cancel-search-btn:hover {
  background-color: rgba(0,0,0,0.05);
}
.dark .cancel-search-btn:hover {
  background-color: rgba(255,255,255,0.1);
}

.fab {
  position: absolute;
  bottom: 2.5rem;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: #00b386;
  color: white;
  border: none;
  font-size: 24px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
}
.fab:hover {
  transform: translateX(-50%) scale(1.05);
  background-color: #009a74;
}
.dark .fab {
    background-color: #00b386;
}
.dark .fab:hover {
    background-color: #00c291;
}

editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 1000;

  /* --- 新增/修改的样式 开始 --- */
  /* 1. 将蒙层变为 Flexbox 容器 */
  display: flex;
  flex-direction: column;
  /* 2. 将其唯一的子元素（NoteEditor）推到底部 */
  justify-content: flex-end;
  /* --- 新增/修改的样式 结束 --- */
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

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
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  padding-right: 2.5rem;
  border-radius: 6px;
  border: 1px solid #ddd;
  font-size: 16px;
}

.clear-search-btn {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 22px;
  color: #999;
  padding: 0 0.5rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dark .clear-search-btn {
  color: #777;
}
.search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  display: none;
}

/* 1. 修改 auth-container，使其成为一个 flex 容器 */
.auth-container {
  max-width: 480px;
  margin: 0 auto; /* 移除上下 margin，让容器可以占满全高 */
  padding: 0 1.5rem 0.75rem 1.5rem; /* 调整 padding 以适应新布局 */
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;

  /* --- 关键改动 --- */
  display: flex;
  flex-direction: column;
  height: 100dvh; /* 让容器占满整个屏幕的高度 */

}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

/* 2. 让 Header 不要被压缩 */
.page-header {
  /* ... 您已有的样式 ... */
  flex-shrink: 0;
  padding: 0.75rem 0; /* 把 auth-container 的上部 padding 移到这里 */
}

/* 3. 让 NoteList 的容器填满剩余空间 */
.notes-list-wrapper {
  flex: 1; /* flex: 1; 是 flex-grow: 1; flex-shrink: 1; flex-basis: 0%; 的缩写 */
  min-height: 0; /* 防止内容过多时撑破容器，这是 flex 布局的关键技巧 */
  overflow-y: auto; /* 让这个容器内部可以滚动 */
  margin-top: 0.5rem; /* 和 Header 之间留出一些间距 */
}

/* [新增] 为右上角的按钮组添加 flex 布局 */
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem; /* 让图标之间有一点间距 */
}
</style>
