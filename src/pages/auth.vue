<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
useDark()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const messageHook = useMessage()
const { autoLoadData } = useAutoSave()

const user = ref<any>(null)
const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const message = ref('')
const loading = ref(false)
const resetEmailSent = ref(false)
const lastBackupTime = ref('N/A')
const hasRedirected = ref(false)

// 笔记系统状态
const notes = ref<any[]>([]) // 当前页显示的笔记
const allNotes = ref<any[]>([]) // 缓存所有已加载的笔记
const content = ref('')
const editingNote = ref<any>(null)
const isLoadingNotes = ref(false)
const showNotesList = ref(false)
const expandedNote = ref<string | null>(null)
const lastSavedId = ref<string | null>(null)
const lastSavedTime = ref('')
const lastSavedAt = ref<number | null>(null)
const searchQuery = ref('')
// 分页状态
const currentPage = ref(1)
const notesPerPage = 15
const totalNotes = ref(0)
const hasMoreNotes = ref(true)
const hasPreviousNotes = ref(false)
const filteredNotes = ref<any[]>([]) // 搜索过滤后的笔记

function addNoteToList(newNote) {
  // 防止重复添加
  if (!allNotes.value.some(note => note.id === newNote.id)) {
    allNotes.value.unshift(newNote)
    filteredNotes.value.unshift(newNote)
    if (currentPage.value === 1)
      notes.value.unshift(newNote)
  }
}

function updateNoteInList(updatedNote) {
  const updateInArray = (arr: any[]) => {
    const index = arr.findIndex(n => n.id === updatedNote.id)
    if (index !== -1)
      arr[index] = { ...updatedNote } // 替换现有笔记
  }
  updateInArray(allNotes.value)
  updateInArray(notes.value)
  updateInArray(filteredNotes.value)
}

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

const LOCAL_KEY = ref('')
const LOCAL_ID_KEY = ref('')
let autoSaveInterval: NodeJS.Timeout | null = null

// 获取笔记函数（支持分页）
async function fetchNotes() {
  try {
    isLoadingNotes.value = true
    const from = (currentPage.value - 1) * notesPerPage
    const to = from + notesPerPage - 1

    // 检查是否需要从 Supabase 加载新笔记
    if (to >= allNotes.value.length && hasMoreNotes.value) {
      const query = supabase
        .from('notes')
        .select('*', { count: 'exact' })
        .eq('user_id', user.value.id)
        .order('updated_at', { ascending: false })
        .range(allNotes.value.length, allNotes.value.length + notesPerPage - 1)

      const { data, error, count } = await query
      if (error) {
        // console.error('获取笔记失败:', error.message)
        messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
        notes.value = []
        hasMoreNotes.value = false
        hasPreviousNotes.value = false
        return
      }

      // 更新总笔记数
      totalNotes.value = count || 0

      // 去重后追加到 allNotes
      const existingIds = new Set(allNotes.value.map(note => note.id))
      const newNotes = (data || []).filter(note => !existingIds.has(note.id))
      allNotes.value.push(...newNotes)
    }

    // 按搜索关键字过滤
    filteredNotes.value = searchQuery.value
      ? allNotes.value.filter(note =>
        note.content.toLowerCase().includes(searchQuery.value.toLowerCase()),
      )
      : [...allNotes.value]

    // 更新当前页笔记
    notes.value = filteredNotes.value.slice(from, to + 1)

    // 判断是否还有更多笔记和上一页
    hasMoreNotes.value = filteredNotes.value.length < totalNotes.value || to + 1 < filteredNotes.value.length
    hasPreviousNotes.value = currentPage.value > 1
  }
  catch (err) {
    // console.error('获取笔记异常:', err)
    messageHook.error(t('notes.fetch_error'))
    notes.value = []
    hasMoreNotes.value = false
    hasPreviousNotes.value = false
  }
  finally {
    isLoadingNotes.value = false
  }
}

// 下一页
async function nextPage() {
  currentPage.value += 1
  await fetchNotes()
}

// 上一页
async function previousPage() {
  if (currentPage.value > 1) {
    currentPage.value -= 1
    await fetchNotes()
  }
}

// 截断内容函数
function truncateContent(text: string, maxLength: number = 150) {
  if (text.length <= maxLength)
    return text
  return `${text.slice(0, maxLength)}...`
}

// 高亮搜索关键字
function highlightText(text: string, query: string) {
  if (!query)
    return text
  const regex = new RegExp(`(${query})`, 'gi')
  return text.replace(regex, '<span class="highlight">$1</span>')
}

// 生成唯一 ID
function generateUniqueId() {
  return uuidv4()
}

// 切换笔记展开状态
function toggleExpand(noteId: string) {
  expandedNote.value = expandedNote.value === noteId ? null : noteId
}

// 自动保存函数
async function saveNote({ showMessage = false } = {}) {
  if (!content.value || !user.value?.id)
    return null

  const now = Date.now()
  const note = {
    content: content.value.trim(),
    updated_at: new Date().toISOString(),
    user_id: user.value.id,
  }

  let savedNote
  try {
    if (lastSavedId.value) {
      const { error, data } = await supabase
        .from('notes')
        .update(note)
        .eq('id', lastSavedId.value)
        .eq('user_id', user.value.id)
        .select()
        .single()
      if (error)
        throw error
      savedNote = data
    }
    else if (editingNote.value?.id) {
      const { error, data } = await supabase
        .from('notes')
        .update(note)
        .eq('id', editingNote.value.id)
        .eq('user_id', user.value.id)
        .select()
        .single()
      if (error)
        throw error
      savedNote = data
      lastSavedId.value = savedNote.id
    }
    else {
      const newId = generateUniqueId()
      const { error, data } = await supabase
        .from('notes')
        .insert({ ...note, id: newId })
        .select()
        .single()
      if (error)
        throw error
      savedNote = data
      lastSavedId.value = savedNote.id
    }

    lastSavedAt.value = now
    updateNoteInList(savedNote)
    lastSavedTime.value = new Date(now).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '.')
    if (LOCAL_ID_KEY.value)
      localStorage.setItem(LOCAL_ID_KEY.value, lastSavedId.value || '')

    if (showMessage)
      messageHook.success(editingNote.value ? t('notes.update_success') : t('notes.auto_saved'))

    return savedNote
  }
  catch (error) {
    // console.error('保存失败:', error)
    messageHook.error(`${t('notes.operation_error')}: ${error.message || '未知错误'}`)
    return null
  }
}

const debouncedSaveNote = debounce(() => {
  if (content.value && user.value?.id) {
    // console.log('触发自动保存', { lastSavedId: lastSavedId.value, editingNoteId: editingNote.value?.id })
    saveNote({ showMessage: false })
  }
}, 10000)

onMounted(() => {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    user.value = session?.user ?? null
    if (session) {
      LOCAL_KEY.value = `cached_note_${session.user.id}`
      LOCAL_ID_KEY.value = `last_saved_id_${session.user.id}`
      const { data } = await supabase
        .from('profiles')
        .select('updated_at')
        .eq('id', session.user.id)
        .single()
      if (data?.updated_at)
        lastBackupTime.value = new Date(`${data.updated_at}Z`).toLocaleString()
      else lastBackupTime.value = '暂无备份'
      if (route.query.from === 'settings' && !hasRedirected.value) {
        hasRedirected.value = true
        router.replace('/setting')
      }
      if (localStorage.getItem(LOCAL_KEY.value))
        content.value = localStorage.getItem(LOCAL_KEY.value) || ''

      if (localStorage.getItem(LOCAL_ID_KEY.value))
        lastSavedId.value = localStorage.getItem(LOCAL_ID_KEY.value) || null
    }
    else {
      lastBackupTime.value = 'N/A'
      LOCAL_KEY.value = ''
      LOCAL_ID_KEY.value = ''
      content.value = ''
      lastSavedId.value = null
    }
    if (!session)
      mode.value = 'login'
  })
  window.addEventListener('beforeunload', () => {
    if (content.value && user.value?.id) {
      saveNote({ showMessage: false })
      localStorage.setItem(LOCAL_KEY.value, content.value)
      localStorage.setItem(LOCAL_ID_KEY.value, lastSavedId.value || '')
    }
  })
})

onUnmounted(() => {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval)
    autoSaveInterval = null
  }
  window.removeEventListener('beforeunload', () => {
    if (content.value && user.value?.id) {
      saveNote({ showMessage: false })
      localStorage.setItem(LOCAL_KEY.value, content.value)
      localStorage.setItem(LOCAL_ID_KEY.value, lastSavedId.value || '')
    }
  })
})

watchEffect(async () => {
  if (!user.value)
    return
  await fetchNotes()
})

watch(searchQuery, debounce(() => {
  if (showNotesList.value) {
    currentPage.value = 1 // 重置分页
    fetchNotes()
  }
}, 300))

watch(content, (val) => {
  if (LOCAL_KEY.value)
    localStorage.setItem(LOCAL_KEY.value, val)
  debouncedSaveNote()
})

// 添加或更新笔记
async function handleSubmit() {
  if (!content.value) {
    messageHook.warning(t('notes.content_required'))
    return
  }

  try {
    loading.value = true
    const saved = await saveNote({ showMessage: true })

    if (saved) {
      if (editingNote.value?.id || lastSavedId.value) {
        updateNoteInList(saved)
      }
      else {
        addNoteToList(saved)
        totalNotes.value += 1
        hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
      }
      editingNote.value = null
      content.value = ''
      lastSavedId.value = null
      lastSavedAt.value = null
      localStorage.removeItem(LOCAL_KEY.value)
      localStorage.removeItem(LOCAL_ID_KEY.value)
    }
  }
  catch (err) {
    // console.error('操作失败:', err)
    messageHook.error(`${t('notes.operation_error')}: ${err.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

// 显示/隐藏笔记列表
function toggleNotesList() {
  showNotesList.value = !showNotesList.value
  if (showNotesList.value && allNotes.value.length === 0) {
    currentPage.value = 1
    fetchNotes()
  }
}

// 编辑笔记
function handleEdit(note: any) {
  if (!note?.id)
    return
  editingNote.value = { ...note }
  content.value = note.content
  lastSavedId.value = note.id
  localStorage.setItem(LOCAL_ID_KEY.value, note.id)
}

// 删除笔记
async function handleDelete(id: string) {
  if (!id || !user.value?.id) {
    messageHook.error('无效的笔记ID或未登录')
    return
  }
  try {
    loading.value = true
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', user.value.id)

    if (error)
      throw new Error(error.message || '删除失败')

    // 从 allNotes、notes 和 filteredNotes 中移除
    allNotes.value = allNotes.value.filter(note => note.id !== id)
    notes.value = notes.value.filter(note => note.id !== id)
    filteredNotes.value = filteredNotes.value.filter(note => note.id !== id)
    totalNotes.value -= 1
    hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
    hasPreviousNotes.value = currentPage.value > 1
    if (id === lastSavedId.value) {
      content.value = ''
      lastSavedId.value = null
      localStorage.removeItem(LOCAL_KEY.value)
      localStorage.removeItem(LOCAL_ID_KEY.value)
    }
    messageHook.success(t('notes.delete_success'))
  }
  catch (err) {
    // console.error('删除笔记失败:', err)
    messageHook.error(`删除失败: ${err.message || '请稍后重试'}`)
  }
  finally {
    loading.value = false
  }
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
  resetEmailSent.value = false
}

async function handleSubmitAuth() {
  if (mode.value === 'register' && password.value !== passwordConfirm.value) {
    message.value = t('auth.messages.passwords_do_not_match')
    return
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
      if (route.query.from === 'settings')
        await router.replace('/setting')
      else await router.replace('/')
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
            />
            <div class="emoji-bar">
              <button
                type="submit"
                class="form-button flex-2"
                :disabled="loading"
              >
                💾 {{ editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
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
            <p v-if="lastSavedTime" class="char-counter">
              💾 {{ t('notes.auto_saved_at') }}：{{ lastSavedTime }}
            </p>
          </form>
          <div v-if="showNotesList" class="notes-list h-80">
            <div class="notes-list-header">
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="$t('notes.search_placeholder')"
                class="search-input"
                @keyup.enter="fetchNotes()"
              >
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
                class="block cursor-pointer rounded-lg bg-gray-100 shadow-md p-1"
                @click="toggleExpand(note.id)"
              >
                <div class="flex-1 min-w-0">
                  <p
                    v-if="expandedNote === note.id"
                    class="whitespace-pre-wrap text-xs text-gray-700"
                    style="font-size: 12px !important; line-height: 1.6;"
                    v-html="highlightText(note.content, searchQuery.value)"
                  />
                  <p
                    v-else
                    class="truncate text-xs text-gray-700"
                    style="font-size: 12px !important; line-height: 1.6;"
                    v-html="highlightText(truncateContent(note.content), searchQuery.value)"
                  />
                  <p class="text-xxs text-gray-500" style="font-size: 10px !important; line-height: 1.0;">
                    {{ $t('notes.updated_at') }}: {{ new Date(note.updated_at).toLocaleString() }}
                  </p>
                </div>
                <div class="mt-2 flex space-x-3">
                  <button
                    class="text-xs text-blue-500 hover:underline"
                    style="font-size: 12px !important; padding: 0.75rem 1.5rem !important; min-height: 2.5rem !important; border: 1px solid #ccc !important; border-radius: 4px !important;"
                    :disabled="loading"
                    @click="handleEdit(note)"
                  >
                    {{ $t('notes.edit') }}
                  </button>
                  <button
                    class="text-xs text-red-500 hover:underline"
                    style="font-size: 12px !important; padding: 0.75rem 1.5rem !important; min-height: 2.5rem !important; border: 1px solid #ccc !important; border-radius: 4px !important;"
                    :disabled="loading"
                    @click="handleDelete(note.id)"
                  >
                    {{ $t('notes.delete') }}
                  </button>
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
        <button :disabled="loading" @click="router.push('/')">
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
          <input v-model="password" type="password" required>
        </label>
        <label v-if="mode === 'register'">
          {{ $t('auth.confirm_password') }}
          <input v-model="passwordConfirm" type="password" required>
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
          <a href="#" @click.prevent="setMode('login')">{{ $t('auth.login') }}</a>
        </p>
        <p class="text-center leading-relaxed text-gray-500" style="font-size: 13px;">
          {{ t('auth.Log_in_again_prefix') }}
          <a href="/" class="cursor-pointer text-green-600 underline" @click.prevent="goHomeAndRefresh">
            {{ t('auth.Log_in_again_link') }}
          </a>
          {{ t('auth.Log_in_again_suffix') }}
          <router-link to="/setting" class="cursor-pointer text-green-600 underline">
            {{ t('auth.Log_in_again_link2') }}
          </router-link>
          {{ t('auth.Log_in_again_setting') }}
        </p>
      </form>
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
  grid-template-columns: 5fr 1fr;
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
  margin-bottom: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  height: 300px;
}
.notes-container textarea:focus {
  border-color: #00b386;
  outline: none;
}
.dark .notes-container textarea {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
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

.emoji-bar {
  margin-top: 1rem;
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
  text-align: right;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
.dark .char-counter {
  color: #aaa;
}

.notes-list-header {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}

.search-input {
  width: 100%;
  padding: 0.25rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #fff;
  color: #111;
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

.highlight {
  background-color: #ffff00;
  color: #000;
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
</style>
