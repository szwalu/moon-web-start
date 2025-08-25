<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { NDatePicker, useDialog, useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import NoteActions from '@/components/NoteActions.vue'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'
import 'easymde/dist/easymde.min.css'

// --- 初始化 & 状态定义 ---
useDark()
const { t } = useI18n()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()

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
const lastSavedAt = ref<number | null>(null)
const currentPage = ref(1)
const notesPerPage = 20
const totalNotes = ref(0)
const hasMoreNotes = ref(true)
const hasPreviousNotes = ref(false)
const maxNoteLength = 3000
const isNotesCached = ref(false)
const cachedNotes = ref<any[]>([])
const cachedPages = ref(new Map<number, { totalNotes: number; hasMoreNotes: boolean; hasPreviousNotes: boolean; notes: any[] }>())
const isRestoringFromCache = ref(false)
const searchQuery = ref('')
const isExporting = ref(false)
const isReady = ref(false)
const allTags = ref<string[]>([])

const LOCAL_CONTENT_KEY = 'note_content'
const LOCAL_NOTE_ID_KEY = 'note_id'
const CACHED_NOTES_KEY = 'cached_notes_page_1'

// --- 核心认证逻辑 ---
onMounted(() => {
  const { data: authListener } = supabase.auth.onAuthStateChange(
    (event, session) => {
      const currentUser = session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser

      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser)) && notes.value.length === 0) {
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
      }
    },
  )

  onUnmounted(() => {
    authListener.subscription.unsubscribe()
  })

  const savedContent = localStorage.getItem(LOCAL_CONTENT_KEY)
  if (savedContent)
    content.value = savedContent

  isReady.value = true
})

// --- 笔记相关方法 ---
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

const debouncedSaveNote = debounce(() => {
  if (content.value && user.value?.id && !isRestoringFromCache.value)
    saveNote({ showMessage: false })
}, 12000)

onUnmounted(() => {
  debouncedSaveNote.cancel()
})

watch(content, async (val, oldVal) => {
  if (!isReady.value)
    return
  if (val)
    localStorage.setItem(LOCAL_CONTENT_KEY, val)
  else localStorage.removeItem(LOCAL_CONTENT_KEY)
  if (val.length > maxNoteLength) {
    content.value = val.slice(0, maxNoteLength)
    messageHook.warning(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return
  }
  if (!authStore.user) {
    console.error('Auto-save: No valid session in authStore')
    return
  }
  if (val && val !== oldVal && !isRestoringFromCache.value)
    debouncedSaveNote()
})

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
          let query = supabase.from('notes').select('content, updated_at').eq('user_id', user.value!.id).order('updated_at', { ascending: false }).range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)
          if (startDate)
            query = query.gte('updated_at', new Date(startDate).toISOString())
          if (endDate) {
            const endOfDay = new Date(endDate)
            endOfDay.setHours(23, 59, 59, 999)
            query = query.lte('updated_at', endOfDay.toISOString())
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
          const date = new Date(note.updated_at).toLocaleString('zh-CN')
          return `${separator}\n更新于: ${date}\n${separator}\n\n${note.content}\n\n========================================\n\n`
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
  try {
    isLoadingNotes.value = true
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
    lastSavedAt.value = now
    lastSavedTime.value = new Date(now).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(/\//g, '.')
    if (showMessage)
      messageHook.success(editingNote.value ? t('notes.update_success') : t('notes.save_success', '保存成功'))

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

async function handleSubmit() {
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
      resetEditorAndState()
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

async function triggerDeleteConfirmation(id: string) {
  if (!id || !user.value?.id)
    return
  dialog.warning({
    title: t('notes.delete_confirm_title'),
    content: t('notes.delete_confirm_content'),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
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
async function handleLogout() {
  loading.value = true
  await supabase.auth.signOut()
  window.location.href = '/'
  loading.value = false
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
</script>

<template>
  <div class="auth-container">
    <div v-if="user" class="account-info">
      <MyAccount
        :user-email="user.email"
        :last-login-time="lastLoginTime"
        :last-backup-time="lastBackupTime"
        :is-loading="loading"
        @logout="handleLogout"
      />
      <div class="notes-container">
        <NoteEditor
          v-model="content"
          :editing-note="editingNote"
          :is-loading="loading"
          :all-tags="allTags"
          :max-note-length="maxNoteLength"
          :last-saved-time="lastSavedTime"
          @submit="handleSubmit"
        />

        <div v-if="showNotesList">
          <NoteActions
            v-model="searchQuery"
            :is-exporting="isExporting"
            :all-tags="allTags"
            @export-all="handleBatchExport"
          />
          <NoteList
            :notes="notes"
            :is-loading="isLoadingNotes"
            :expanded-note-id="expandedNote"
            :has-more="hasMoreNotes"
            @load-more="nextPage"
            @toggle-expand="toggleExpand"
            @edit="handleEdit"
            @copy="handleCopy"
            @pin="handlePinToggle"
            @delete="triggerDeleteConfirmation"
            @task-toggle="handleNoteContentClick"
          />
        </div>
      </div>
    </div>
    <div v-else>
      <Authentication />
    </div>
  </div>
</template>

<style scoped>
.auth-container {
  max-width: 480px;
  margin: 2rem auto;
  padding: 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #333;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.account-info {
  /* 恢复: 移除 flex 布局，回归简单块状布局 */
  text-align: center;
}

.notes-container {
  text-align: left;
  /* 恢复: 移除 flex 布局 */
}

/* 全局 message 样式保留 */
.message {
  margin-top: 1rem;
  text-align: center;
  font-weight: bold;
}
</style>
