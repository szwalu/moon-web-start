<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { NDatePicker, useDialog, useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

// --- 初始化 & 状态定义 ---
useDark()
const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()
const { autoLoadData } = useAutoSave()

const user = computed(() => authStore.user)

// 其他非认证相关的本地状态
const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const inviteCode = ref('')
const message = ref('')
const loading = ref(false)
const resetEmailSent = ref(false)
const lastBackupTime = ref('N/A')

let autoSaveInterval: NodeJS.Timeout | null = null
const notes = ref<any[]>([])
const content = ref('')
const editingNote = ref<any>(null)
const isLoadingNotes = ref(false)
const showNotesList = ref(false)
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

const LOCAL_CONTENT_KEY = 'note_content'
const LOCAL_NOTE_ID_KEY = 'note_id'

const debouncedSaveNote = debounce(() => {
  if (content.value && user.value?.id && !isRestoringFromCache.value)
    saveNote({ showMessage: false })
}, 12000)

onUnmounted(() => {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval)
    autoSaveInterval = null
  }
  debouncedSaveNote.cancel()
})

// 【新增】使用 watch 实现全局实时搜索
const debouncedSearch = debounce(async () => {
  // 如果搜索框被清空，则恢复正常的分页列表
  if (!searchQuery.value.trim()) {
    // 重新获取当前页的笔记
    await fetchNotes()
    return
  }

  isLoadingNotes.value = true
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.value.id)
      // 使用 ilike 进行不区分大小写的模糊搜索
      .ilike('content', `%${searchQuery.value.trim()}%`)
      .order('updated_at', { ascending: false })
      // 限制最多返回100条搜索结果，避免返回内容过多
      .limit(100)

    if (error)
      throw error

    // 直接将搜索结果更新到笔记列表
    notes.value = data || []

    // 在搜索模式下，我们隐藏分页按钮
    hasMoreNotes.value = false
    hasPreviousNotes.value = false
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message}`)
  }
  finally {
    isLoadingNotes.value = false
  }
}, 500) // 添加 500ms 的防抖，停止输入半秒后才开始搜索

watch(searchQuery, () => {
  debouncedSearch()
})

onMounted(async () => {
  await authStore.refreshUser()
  const savedContent = localStorage.getItem(LOCAL_CONTENT_KEY)
  const savedNoteId = localStorage.getItem(LOCAL_NOTE_ID_KEY)
  if (savedContent) {
    isRestoringFromCache.value = true
    content.value = savedContent
    if (savedNoteId && user.value) {
      lastSavedId.value = savedNoteId
      const { data: noteData } = await supabase
        .from('notes')
        .select('*')
        .eq('id', savedNoteId)
        .eq('user_id', user.value.id)
        .single()
      if (noteData)
        editingNote.value = noteData
      else
        localStorage.removeItem(LOCAL_NOTE_ID_KEY)
    }
    isRestoringFromCache.value = false
  }
})

const lastLoginTime = computed(() => {
  if (user.value?.last_sign_in_at)
    return new Date(user.value.last_sign_in_at).toLocaleString()
  return 'N/A'
})

const pageTitle = computed(() => {
  if (mode.value === 'login')
    return t('auth.login')
  if (mode.value === 'register')
    return t('auth.register')
  return t('auth.forgot_password')
})

const charCount = computed(() => {
  return content.value.length
})

watchEffect(async () => {
  if (user.value) {
    const { data } = await supabase
      .from('profiles')
      .select('updated_at')
      .eq('id', user.value.id)
      .single()
    lastBackupTime.value = data?.updated_at
      ? new Date(`${data.updated_at}Z`).toLocaleString()
      : '暂无备份'
    if (!isRestoringFromCache.value && !isNotesCached.value)
      await fetchNotes()
  }
  else {
    lastBackupTime.value = 'N/A'
    notes.value = []
    cachedNotes.value = []
    isNotesCached.value = false
    cachedPages.value.clear()
    editingNote.value = null
  }
})

watch(content, async (val, oldVal) => {
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

  // 1. 在函数内部创建一个临时的 ref，专门给弹窗内的日期选择器使用
  const dialogDateRange = ref<[number, number] | null>(null)

  dialog.info({
    title: t('notes.export_confirm_title'),

    // 2. 使用 h 函数动态创建 VNode 作为弹窗内容
    // 这样就可以在弹窗里渲染任何 Vue 组件
    content: () => h(NDatePicker, {
      'value': dialogDateRange.value,
      'type': 'daterange',
      'clearable': true,
      'placeholder': t('notes.select_date_range_placeholder'),
      'class': 'dialog-date-picker',
      // 监听组件的更新事件，并将新值赋给我们的临时 ref
      'onUpdate:value': (newValue) => {
        dialogDateRange.value = newValue
      },
    }),

    positiveText: t('notes.confirm_export'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      isExporting.value = true
      messageHook.info(t('notes.export_preparing'), { duration: 5000 })

      // 3. 内部的导出逻辑不变，只是数据源从全局 ref 变成了弹窗内的临时 ref
      try {
        const [startDate, endDate] = dialogDateRange.value || [null, null]
        const BATCH_SIZE = 100
        let allNotes: any[] = []
        let page = 0
        let hasMore = true

        while (hasMore) {
          let query = supabase
            .from('notes')
            .select('content, updated_at')
            .eq('user_id', user.value!.id)
            .order('updated_at', { ascending: false })
            .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)

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

function addNoteToList(newNote: any) {
  if (!notes.value.some(note => note.id === newNote.id)) {
    notes.value.unshift(newNote)
    cachedNotes.value.unshift(newNote)
    if (currentPage.value === 1 && showNotesList.value)
      notes.value = notes.value.slice(0, notesPerPage)
    totalNotes.value += 1
    hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
    hasPreviousNotes.value = currentPage.value > 1
    cachedPages.value.set(currentPage.value, {
      totalNotes: totalNotes.value,
      hasMoreNotes: hasMoreNotes.value,
      hasPreviousNotes: hasPreviousNotes.value,
      notes: notes.value.slice(),
    })
    nextTick()
  }
}

// 【新增】置顶/取消置顶笔记的函数
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

    // 【核心修正】在重新获取数据前，清空所有页面的缓存
    // 这会强制 fetchNotes 去数据库拉取最新、正确排序的数据
    cachedPages.value.clear()

    // 现在，这个 fetchNotes 调用将获取到最新的数据
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
  const cachedPage = cachedPages.value.get(currentPage.value)
  if (cachedPage) {
    updateInArray(cachedPage.notes)
    cachedPages.value.set(currentPage.value, { ...cachedPage })
  }
  nextTick()
}
async function fetchNotes() {
  try {
    isLoadingNotes.value = true
    const from = (currentPage.value - 1) * notesPerPage
    const to = from + notesPerPage - 1
    const cachedPage = cachedPages.value.get(currentPage.value)
    if (cachedPage) {
      notes.value = cachedPage.notes.slice()
      totalNotes.value = cachedPage.totalNotes
      hasMoreNotes.value = cachedPage.hasMoreNotes
      hasPreviousNotes.value = cachedPage.hasPreviousNotes
      isNotesCached.value = true
      isLoadingNotes.value = false
      nextTick()
      return
    }
    const { data, error, count } = await supabase
      .from('notes')
      .select('*', { count: 'exact' })
      .eq('user_id', user.value.id)
      .order('is_pinned', { ascending: false }) // 【新增】优先按 is_pinned 降序排（true在前）
      .order('updated_at', { ascending: false }) // 然后再按更新时间降序排
      .range(from, to)
    if (error) {
      messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
      notes.value = []
      cachedNotes.value = []
      hasMoreNotes.value = false
      hasPreviousNotes.value = false
      isNotesCached.value = false
      cachedPages.value.clear()
      return
    }
    const newNotes = data || []
    totalNotes.value = count || 0
    notes.value = newNotes.slice(0, notesPerPage)
    hasMoreNotes.value = to + 1 < totalNotes.value
    hasPreviousNotes.value = currentPage.value > 1
    const existingIds = new Set(cachedNotes.value.map(n => n.id))
    cachedNotes.value = [
      ...cachedNotes.value.filter(n => !newNotes.some(nn => nn.id === n.id)),
      ...newNotes.filter(n => !existingIds.has(n.id)),
    ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
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
    notes.value = []
    cachedNotes.value = []
    hasMoreNotes.value = false
    hasPreviousNotes.value = false
    isNotesCached.value = false
    cachedPages.value.clear()
  }
  finally {
    isLoadingNotes.value = false
    nextTick()
  }
}
async function nextPage() {
  const targetPage = currentPage.value + 1
  const cachedPage = cachedPages.value.get(targetPage)
  if (cachedPage) {
    currentPage.value = targetPage
    notes.value = cachedPage.notes.slice()
    totalNotes.value = cachedPage.totalNotes
    hasMoreNotes.value = cachedPage.hasMoreNotes
    hasPreviousNotes.value = cachedPage.hasPreviousNotes
    nextTick()
  }
  else {
    currentPage.value = targetPage
    await fetchNotes()
  }
}
async function previousPage() {
  if (currentPage.value > 1) {
    const targetPage = currentPage.value - 1
    const cachedPage = cachedPages.value.get(targetPage)
    if (cachedPage) {
      currentPage.value = targetPage
      notes.value = cachedPage.notes.slice()
      totalNotes.value = cachedPage.totalNotes
      hasMoreNotes.value = cachedPage.hasMoreNotes
      hasPreviousNotes.value = cachedPage.hasPreviousNotes
      nextTick()
    }
    else {
      currentPage.value = targetPage
      await fetchNotes()
    }
  }
}
function truncateContent(text: string, maxLength: number = 150) {
  if (text.length <= maxLength)
    return text
  return `${text.slice(0, maxLength)}...`
}
function generateUniqueId() {
  return uuidv4()
}
function toggleExpand(noteId: string) {
  expandedNote.value = expandedNote.value === noteId ? null : noteId
}
async function saveNote({ showMessage = false } = {}) {
  if (!content.value || !user.value?.id) {
    if (!user.value?.id) {
      messageHook.error(t('auth.session_expired'))
      setMode('login')
    }
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
          throw new Error('更新失败')
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
          throw new Error('插入失败：无法创建新笔记')
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
    if (showMessage) {
      messageHook.success(editingNote.value ? t('notes.update_success') : t('notes.auto_saved'))
      content.value = ''
      lastSavedId.value = null
      editingNote.value = null
      localStorage.removeItem(LOCAL_NOTE_ID_KEY)
      localStorage.removeItem(LOCAL_CONTENT_KEY)
    }
    return savedNote
  }
  catch (error: any) {
    messageHook.error(`${t('notes.operation_error')}: ${error.message || '未知错误'}`)
    return null
  }
}

async function handleSubmit() {
  const timeout = setTimeout(() => {
    messageHook.error(t('auth.session_expired_or_timeout'))
    loading.value = false
    setMode('login')
  }, 30000)
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.user) {
      messageHook.error(t('auth.session_expired'))
      setMode('login')
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
      content.value = ''
      editingNote.value = null
      lastSavedId.value = null
      lastSavedAt.value = null
      localStorage.removeItem(LOCAL_NOTE_ID_KEY)
      localStorage.removeItem(LOCAL_CONTENT_KEY)
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
function toggleNotesList() {
  showNotesList.value = !showNotesList.value
  if (showNotesList.value && !isNotesCached.value) {
    currentPage.value = 1
    fetchNotes()
  }
  searchQuery.value = ''
}
function handleEdit(note: any) {
  if (!note?.id)
    return
  editingNote.value = { ...note }
  content.value = note.content
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
        const { error } = await supabase
          .from('notes')
          .delete()
          .eq('id', id)
          .eq('user_id', user.value!.id)
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
  await router.push('/')
  loading.value = false
}
function setMode(newMode: 'login' | 'register' | 'forgotPassword') {
  mode.value = newMode
  message.value = ''
  password.value = ''
  passwordConfirm.value = ''
  inviteCode.value = ''
  resetEmailSent.value = false
}
async function handleSubmitAuth() {
  if (mode.value === 'register') {
    if (password.value !== passwordConfirm.value) {
      message.value = t('auth.messages.passwords_do_not_match')
      return
    }
    const { data, error } = await supabase
      .from('invite_codes')
      .select('code')
      .eq('code', inviteCode.value)
      .single()
    if (error || !data) {
      message.value = t('auth.messages.invalid_invite_code')
      return
    }
  }
  loading.value = true
  message.value = ''
  try {
    if (mode.value === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
      if (error)
        throw error
      await authStore.refreshUser()
      await autoLoadData({ $message: messageHook, t })
      await router.replace('/')
    }
    else if (mode.value === 'register') {
      const { error } = await supabase.auth.signUp({ email: email.value, password: password.value })
      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
    else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, { redirectTo: `${window.location.origin}/update-password` })
      if (error)
        throw error
      message.value = t('auth.messages.reset_success')
      resetEmailSent.value = true
    }
  }
  catch (err: any) {
    message.value = err.message || t('auth.messages.reset_failed')
  }
  finally {
    loading.value = false
  }
}
function goHomeAndRefresh() {
  router.push('/').then(() => window.location.reload())
}
</script>

<template>
  <div class="auth-container">
    <div v-if="user" class="account-info">
      <h1 class="account-title">{{ $t('auth.account_title') }}</h1>
      <div class="info-grid">
        <p>
          <span class="info-label">{{ $t('auth.account_email_label') }}</span>
          <span class="info-value">{{ user.email }}</span>
        </p>
        <p>
          <span class="info-label">{{ $t('auth.account_last_login_label') }}</span>
          <span class="info-value">{{ lastLoginTime }}</span>
        </p>
        <p>
          <span class="info-label">{{ $t('auth.account_last_backup_label') }}</span>
          <span class="info-value">{{ lastBackupTime }}</span>
        </p>
        <div class="notes-container">
          <form class="mb-6" @submit.prevent="handleSubmit">
            <span class="info-label">{{ $t('notes.notes') }}</span>
            <textarea
              v-model="content"
              :placeholder="$t('notes.content_placeholder')"
              class="mb-2 w-full border rounded h-80 p-2"
              required
              :disabled="loading"
              :maxlength="maxNoteLength"
            />
            <div class="status-bar">
              <span class="char-counter">
                {{ t('notes.char_count') }}: {{ charCount }}/{{ maxNoteLength }}
              </span>
              <span v-if="lastSavedTime" class="char-counter ml-4">
                💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
              </span>
            </div>
            <div class="emoji-bar">
              <button
                type="submit"
                class="form-button flex-2"
                :disabled="loading"
              >
                💾 {{ loading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
              </button>
              <button
                type="button"
                class="form-button flex-1"
                :disabled="loading"
                @click="toggleNotesList"
              >
                {{ $t('notes.more_notes') }}
              </button>
            </div>
          </form>
          <p v-if="message" class="message mt-2 text-center text-red-500">{{ message }}</p>
          <div v-if="showNotesList" class="notes-list h-80 overflow-auto">
            <div class="search-export-bar">
              <div class="search-input-wrapper">
                <input
                  v-model="searchQuery"
                  type="text"
                  :placeholder="$t('notes.search_placeholder')"
                  class="search-input"
                >
                <button
                  v-if="searchQuery"
                  class="clear-search-button"
                  @click="searchQuery = ''"
                >
                  ×
                </button>
              </div>
              <button
                class="export-all-button"
                :disabled="isExporting"
                @click="handleBatchExport"
              >
                {{ isExporting ? $t('notes.exporting') : $t('notes.export_all') }}
              </button>
            </div>
            <div v-if="isLoadingNotes" class="py-4 text-center text-gray-500">
              {{ $t('notes.loading') }}
            </div>
            <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
              {{ $t('notes.no_notes') }}
            </div>
            <div v-else class="space-y-6">
              <div
                v-for="note in notes"
                :key="note.id"
                class="mb-3 block w-full cursor-pointer rounded-lg bg-gray-100 shadow-md p-4"
                @click="toggleExpand(note.id)"
              >
                <div class="flex-1 min-w-0">
                  <p
                    v-if="expandedNote === note.id"
                    class="whitespace-pre-wrap text-sm text-gray-700"
                    style="font-size: 14px !important; line-height: 1.6;"
                  >
                    {{ note.content }}
                  </p>
                  <p
                    v-else
                    class="truncate text-sm text-gray-700"
                    style="font-size: 14px !important; line-height: 1.6;"
                  >
                    {{ truncateContent(note.content) }}
                  </p>
                  <p class="text-xxs text-gray-500" style="font-size: 10px !important; line-height: 1.0;">
                    {{ $t('notes.updated_at') }}: {{ new Date(note.updated_at).toLocaleString() }}
                  </p>
                </div>
                <div class="mt-3 flex justify-between">
                  <button
                    class="edit-btn action-button"
                    style="font-size: 12px !important; padding: 0.75rem 1.5rem !important; min-height: 2.5rem !important; border: 1px solid #ccc !important; border-radius: 4px !important;"
                    :disabled="loading"
                    @click.stop="handleEdit(note)"
                  >
                    {{ $t('notes.edit') }}
                  </button>
                  <div class="flex space-x-2">
                    <button
                      class="action-button pin-btn"
                      style="font-size: 12px !important; padding: 0.75rem 1.5rem !important; min-height: 2.5rem !important; border: 1px solid #ccc !important; border-radius: 4px !important;"
                      :disabled="loading"
                      @click.stop="handlePinToggle(note)"
                    >
                      {{ note.is_pinned ? $t('notes.unpin') : $t('notes.pin') }}
                    </button>
                    <button
                      class="action-button delete-btn"
                      style="font-size: 12px !important; padding: 0.75rem 1.5rem !important; min-height: 2.5rem !important; border: 1px solid #ccc !important; border-radius: 4px !important;"
                      :disabled="loading"
                      @click.stop="triggerDeleteConfirmation(note.id)"
                    >
                      {{ $t('notes.delete') }}
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="hasPreviousNotes || hasMoreNotes" class="mt-4 flex justify-center text-center gap-4">
                <button
                  v-if="hasPreviousNotes"
                  class="form-button"
                  :disabled="isLoadingNotes"
                  @click="previousPage"
                >
                  {{ $t('notes.previous_page') }}
                </button>
                <button
                  v-if="hasMoreNotes"
                  class="form-button"
                  :disabled="isLoadingNotes"
                  @click="nextPage"
                >
                  {{ $t('notes.next_page') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="button-group">
        <button :disabled="loading" @click="router.back()">
          {{ $t('auth.return_home') }}
        </button>
        <button class="button--secondary" :disabled="loading" @click="handleLogout">
          {{ loading ? $t('auth.loading') : $t('auth.logout') }}
        </button>
      </div>
    </div>
    <div v-else>
      <h1>{{ pageTitle }}</h1>
      <form class="auth-form" @submit.prevent="handleSubmitAuth">
        <label>
          {{ mode === 'forgotPassword' ? $t('auth.messages.enter_email') : $t('auth.email') }}
          <input v-model="email" type="email" :placeholder="mode === 'forgotPassword' ? $t('auth.messages.enter_registered_email') : $t('auth.email_placeholder')" :disabled="mode === 'forgotPassword' && resetEmailSent" required>
        </label>
        <label v-if="mode !== 'forgotPassword'">
          {{ $t('auth.password') }}
          <input
            v-model="password"
            type="password"
            :placeholder="mode === 'register' ? $t('auth.password_placeholder') : $t('auth.login_password_placeholder')"
            required
          >
        </label>
        <label v-if="mode === 'register'">
          {{ $t('auth.confirm_password') }}
          <input
            v-model="passwordConfirm"
            type="password"
            :placeholder="$t('auth.password_placeholder')"
            required
          >
        </label>
        <label v-if="mode === 'register'">
          {{ $t('auth.invite_code') }}
          <input v-model="inviteCode" type="text" :placeholder="$t('auth.invite_code_placeholder')" required>
        </label>
        <template v-if="mode === 'forgotPassword' && resetEmailSent">
          <button type="button" @click="setMode('login')">
            {{ $t('auth.return') }}
          </button>
        </template>
        <template v-else>
          <button type="submit" :disabled="loading">
            <span v-if="loading">{{ $t('auth.loading') }}</span>
            <span v-else-if="mode === 'login'">{{ t('auth.login') }}</span>
            <span v-else-if="mode === 'register'">{{ t('auth.register') }}</span>
            <span v-else>{{ t('auth.confirm') }}</span>
          </button>
        </template>
        <p v-if="message" class="message">{{ message }}</p>
        <div v-if="mode === 'login'" class="toggle-row">
          <div class="toggle-left">
            <span>{{ $t('auth.prompt_to_register') }}</span>
            <a href="#" @click.prevent="setMode('register')">{{ $t('auth.register') }}</a>
          </div>
          <div class="toggle-right">
            <a href="#" @click.prevent="setMode('forgotPassword')">{{ $t('auth.forgot_password') }}</a>
          </div>
        </div>
        <p v-else class="toggle">
          <span>{{ $t('auth.prompt_to_login') }}</span>
          <a href="#" @click.prevent="setMode('login')">{{ t('auth.login') }}</a>
        </p>
        <p class="text-center leading-relaxed text-gray-500" style="font-size: 13px;">
          {{ t('auth.Log_in_again_prefix') }}
          <a href="/" class="cursor-pointer text-green-600 underline" @click.prevent="goHomeAndRefresh">
            {{ t('auth.Log_in_again_link') }}
          </a>
          {{ t('auth.Log_in_again_suffix') }}
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.search-export-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  align-items: center;
}

/* 【新增】搜索框容器和清除按钮的样式 */
.search-input-wrapper {
  position: relative; /* 关键：作为内部绝对定位按钮的参考点 */
  flex: 4; /* 保持原有的宽度比例 */
  display: flex;
  align-items: center;
}

.search-input {
  /* 让输入框的 padding-right 变大，为清除按钮留出空间 */
  padding-right: 2rem;
}

.clear-search-button {
  position: absolute; /* 关键：让按钮脱离文档流，浮动起来 */
  right: 0.5rem;    /* 定位在容器的右侧 */
  top: 50%;         /* 垂直居中 */
  transform: translateY(-50%); /* 精准垂直居中 */

  /* 按钮本身的美化样式 */
  background: transparent;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 20px;   /* 让 "×" 字符看起来更清晰 */
  line-height: 1;
  padding: 0;
  margin: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dark .clear-search-button {
  color: #aaa;
}

.clear-search-button:hover {
  color: #333;
}

.dark .clear-search-button:hover {
  color: #fff;
}

.search-input {
  flex: 4;
  padding: 0.5rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  min-width: 0;
}

.dark .search-input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
}

.search-input:focus {
  border-color: #00b386;
  outline: none;
}

.export-all-button {
  flex: 1;
  padding: 0.5rem 0.75rem;
  margin: 0 !important;
  font-size: 12px !important;
  border-radius: 6px;
  border: 1px solid #bbf7d0 !important;
  cursor: pointer;
  background-color: #f0fdf4 !important;
  color: #16a34a !important;
  white-space: nowrap;
  text-align: center;
  height: 23px;
}

.dark .export-all-button {
  border-color: #22c55e !important;
  background-color: #166534 !important;
  color: #dcfce7 !important;
}

.export-all-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

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

h1 {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 28px;
  font-weight: bold;
  color: #111;
}
.dark h1 {
  color: #ffffff;
}

.auth-form label {
  display: block;
  text-align: left;
  margin-bottom: 1.2rem;
  color: #555;
}
.dark .auth-form label {
  color: #adadad;
}

.auth-form input {
  width: 100%;
  padding: 0.8rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
}

.auth-form input:disabled {
  background-color: #f0f0f0;
  cursor: not-allowed;
}

.dark .auth-form input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
}

.dark .auth-form input:disabled {
  background-color: #3a3a3c;
  opacity: 0.7;
}

.dark .auth-form input:focus {
  border-color: #00b386;
  outline: none;
}

button {
  width: 100%;
  padding: 0.8rem;
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  margin-top: 1rem;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.message {
  margin-top: 1rem;
  text-align: center;
  font-weight: bold;
}

.toggle {
  text-align: center;
  margin-top: 1rem;
  color: #666;
}
.dark .toggle {
  color: #888;
}
.toggle a {
  margin-left: 0.4rem;
  color: #00b386;
  text-decoration: underline;
  cursor: pointer;
}
.dark .toggle a {
  color: #2dd4bf;
}

.account-title {
  font-size: 18px;
}

.account-info {
  text-align: center;
}
.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding: 0.5rem 0;
  margin: 0;
}
.dark .info-grid p {
  border-bottom-color: #333;
}
.info-label {
  color: #555;
  font-weight: bold;
}
.dark .info-label {
  color: #adadad;
}
.info-value {
  color: #111;
  word-break: break-all;
}
.dark .info-value {
  color: #ffffff;
}

.button-group {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 1rem;
  margin-top: 2rem;
}

.button--secondary {
  width: 100%;
  padding: 0.8rem;
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s ease;
}

.button--secondary:hover {
  background-color: #e0e0e0;
}

.dark .button--secondary {
  background-color: #3a3a3c;
  color: #e0e0e0;
  border-color: #555;
}

.dark .button--secondary:hover {
  background-color: #48484a;
}

.notes-container {
  margin-top: 3rem;
}

.notes-container textarea {
  width: 100%;
  padding: 0.5rem;
  margin-bottom: 0.2rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  height: 300px;
  font-size: 14px;
  line-height: 1.5;
}
.notes-container textarea:focus {
  border-color: #00b386;
  outline: none;
}
.dark .notes-container textarea {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
  font-size: 14px;
  line-height: 1.5;
}
.notes-container .bg-gray-100 {
  background-color: #f3f4f6;
}
.dark .notes-container .bg-gray-100 {
  background-color: #374151;
}
.notes-container .text-gray-500 {
  color: #6b7280;
}
.dark .notes-container .text-gray-500 {
  color: #9ca3af;
}
.notes-container .text-gray-700 {
  color: #374151;
}
.dark .notes-container .text-gray-700 {
  color: #d1d5db;
}

.status-bar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin: 0;
}

.emoji-bar {
  margin-top: 0.2rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

form .emoji-bar .form-button {
  flex: 1;
  padding: 0.5rem;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  cursor: pointer;
  background: #d3d3d3;
  color: #111;
}
.dark form .emoji-bar .form-button {
  background-color: #404040;
  color: #fff;
  border-color: #555;
}

form .emoji-bar .form-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.notes-list {
  margin-top: 1rem;
  height: 300px;
  overflow-y: auto;
  position: relative;
}
.notes-list > div {
  padding: 0.8rem;
  line-height: 0.8;
  width: 100%;
  overflow-y: auto;
  text-align: left;
}
.notes-list > div:hover {
  background-color: #e5e7eb;
}
.notes-list .flex-1 {
  text-align: left;
}
.notes-list .flex button {
  width: auto;
  padding: 0.75rem 1.5rem;
  min-height: 2.5rem;
  margin-top: 0;
  background-color: transparent;
  color: inherit;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.notes-container button {
  width: auto;
  padding: 0.8rem;
  background-color: inherit;
  color: inherit;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
}
.char-counter {
  font-size: 12px;
  color: #999;
}
.dark .char-counter {
  color: #aaa;
}

.notes-list .form-button {
  padding: 0.5rem 1rem;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  cursor: pointer;
  background: #d3d3d3;
  color: #111;
}
.dark .notes-list .form-button {
  background-color: #404040;
  color: #fff;
  border-color: #555;
}
.notes-list .form-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .action-button {
    padding: 0.5rem 1rem !important;
    font-size: 0.875rem !important;
    min-width: 80px;
  }
}
</style>

<style>
body,
html {
  background-color: #f8f9fa;
  background-image: linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px);
  background-size: 25px 25px;
  transition: background-color 0.3s ease;
}
.dark body,
.dark html {
  background-color: #1a1a1a;
  background-image: linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
  background-size: 25px 25px;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
  font-size: 14px;
  color: #666;
}
.toggle-left,
.toggle-right {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.toggle-left a,
.toggle-right a {
  color: #00b386;
  text-decoration: underline;
  cursor: pointer;
}
.dark .toggle-row {
  color: #aaa;
}
.dark .toggle-left a,
.dark .toggle-right a {
  color: #2dd4bf;
}

.edit-btn {
  background-color: #e9f7fe !important;
  color: #0c7abf !important;
  border: 1px solid #bae0f7 !important;
}
.delete-btn {
  background-color: #fef0f0 !important;
  color: #e53e3e !important;
  border: 1px solid #fbd5d5 !important;
}
.mt-3.flex > button {
  margin: 0 0.5rem !important;
  flex-grow: 1;
}

.pin-btn {
  background-color: #fefce8 !important; /* 淡黄色背景 */
  color: #ca8a04 !important; /* 黄褐色文字 */
  border: 1px solid #fde68a !important; /* 黄色边框 */
}

.flex.space-x-2 > button {
  margin-left: 0.5rem;
}
:deep(.dialog-date-picker) {
  margin-top: 12px;
}
</style>
