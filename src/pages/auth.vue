<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import 'emoji-picker-element'
const noteText = ref('')
const lastSavedContent = ref('') // 保存最近一次成功保存到 Supabase 的内容
const lastSavedTime = ref('')
const authStore = useAuthStore()
useDark()
const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage()
const { autoLoadData } = useAutoSave()

let autoSaveInterval: NodeJS.Timeout | null = null

const user = ref<any>(null)
const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const message = ref('')
const loading = ref(false)
const resetEmailSent = ref(false)
const charCount = computed(() => noteText.value.length)
const maxChars = 3000
const lastBackupTime = ref('N/A')

const lastLoginTime = computed(() => {
  if (user.value?.last_sign_in_at)
    return new Date(user.value.last_sign_in_at).toLocaleString()
  return 'N/A'
})

const LOCAL_KEY = ref('')

onMounted(() => {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    user.value = session?.user ?? null
    if (session) {
      LOCAL_KEY.value = `cached_note_${session.user.id}`

      const { data } = await supabase
        .from('profiles')
        .select('updated_at')
        .eq('id', session.user.id)
        .single()

      if (data?.updated_at)
        lastBackupTime.value = new Date(`${data.updated_at}Z`).toLocaleString()
      else
        lastBackupTime.value = '暂无备份'

      if (!autoSaveInterval) {
        autoSaveInterval = setInterval(() => {
          saveNote()
        }, 15000)
      }
    }
    else {
      lastBackupTime.value = 'N/A'
      LOCAL_KEY.value = ''
    }

    if (!session)
      mode.value = 'login'
  })

  window.addEventListener('beforeunload', saveNote)
})

onUnmounted(() => {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval)
    autoSaveInterval = null
  }
  window.removeEventListener('beforeunload', saveNote)
})

watchEffect(async () => {
  if (!user.value)
    return

  const { data } = await supabase
    .from('notes')
    .select('content')
    .eq('user_id', user.value.id)
    .single()

  if (data?.content) {
    noteText.value = data.content
    lastSavedContent.value = data.content
    localStorage.setItem(LOCAL_KEY.value, data.content)
  }
  else {
    noteText.value = ''
  }
})

const debouncedSaveNote = debounce(() => {
  saveNote()
}, 3000)

watch(noteText, (val) => {
  if (LOCAL_KEY.value)
    localStorage.setItem(LOCAL_KEY.value, val)
  debouncedSaveNote()
})

async function saveNote({ showMessage = false } = {}) {
  // console.log('👉 saveNote 被调用，是否提示:', showMessage)

  if (!user.value)
    return

  const contentUnchanged = noteText.value === lastSavedContent.value

  if (contentUnchanged) {
    if (showMessage)
      messageHook.success('便笺已保存')

    return
  }

  const { error } = await supabase
    .from('notes')
    .upsert({ user_id: user.value.id, content: noteText.value })

  if (!error) {
    lastSavedContent.value = noteText.value
    lastSavedTime.value = new Date().toLocaleString()

    if (showMessage)
      messageHook.success('便笺已保存')
  }
  else {
    console.error('保存失败:', error.message)
  }
}

function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  if (target.value.length > maxChars) {
    target.value = target.value.slice(0, maxChars)
    noteText.value = target.value
  }
}

async function handleLogout() {
  loading.value = true
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval)
    autoSaveInterval = null
  }
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

async function handleSubmit() {
  if (mode.value === 'register' && password.value !== passwordConfirm.value) {
    message.value = t('auth.messages.passwords_do_not_match')
    return
  }

  loading.value = true
  message.value = ''
  try {
    if (mode.value === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error

      await router.push('/')
      await authStore.refreshUser()
      await autoLoadData({ $message: messageHook, t })
    }
    else if (mode.value === 'register') {
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
    else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
        redirectTo: `${window.location.origin}/update-password`,
      })
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

const showEmojiPicker = ref(false)

function onEmojiSelect(event: any) {
  const emoji = event.detail.unicode
  const textarea = document.querySelector('.note-textarea') as HTMLTextAreaElement
  const cursorPos = textarea.selectionStart || 0
  const before = noteText.value.slice(0, cursorPos)
  const after = noteText.value.slice(cursorPos)
  noteText.value = before + emoji + after
  showEmojiPicker.value = false
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

        <div class="note-container">
          <span class="info-label">{{ $t('auth.info_label') }}</span>
          <textarea
            v-model="noteText"
            class="note-textarea"
            :placeholder="$t('auth.note_placeholder')"
            :maxlength="maxChars"
            @blur="saveNote"
            @input="onInput"
          />
          <div class="emoji-bar">
            <button @click="saveNote({ showMessage: true })">💾 保存</button>
            <button @click="showEmojiPicker = !showEmojiPicker">😊 插入 Emoji</button>
          </div>

          <emoji-picker
            v-if="showEmojiPicker"
            @emoji-click="onEmojiSelect"
          />
          <p class="char-counter">{{ charCount }} / {{ maxChars }}</p>
          <p v-if="lastSavedTime" class="char-counter">
            💾 上次保存：{{ lastSavedTime }}
          </p>
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
      <form class="auth-form" @submit.prevent="handleSubmit">
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
            <span v-else-if="mode === 'login'">{{ $t('auth.login') }}</span>
            <span v-else-if="mode === 'register'">{{ $t('auth.register') }}</span>
            <span v-else>{{ $t('auth.confirm') }}</span>
          </button>
        </template>
        <p v-if="message" class="message">{{ message }}</p>
        <p v-if="!(mode === 'forgotPassword' && resetEmailSent)" class="toggle">
          <template v-if="mode === 'login'">
            <span>{{ $t('auth.prompt_to_register') }}</span>
            <a href="#" @click.prevent="setMode('register')">{{ $t('auth.register') }}</a>
            <span> | </span>
            <a href="#" @click.prevent="setMode('forgotPassword')">{{ $t('auth.forgot_password') }}</a>
            <p v-if="mode === 'login'" class="log-in-again-note">{{ $t('auth.Log_in_again') }}</p>
          </template>
          <template v-else>
            <span>{{ $t('auth.prompt_to_login') }}</span>
            <a href="#" @click.prevent="setMode('login')">{{ $t('auth.login') }}</a>
          </template>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* 样式部分保持不变 */
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

/* 为禁用状态添加样式 */
.auth-form input:disabled {
  background-color: #f0f0f0;
  cursor: not-allowed;
}

.dark .auth-form input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
}

/* 为禁用状态添加样式 (Dark Mode) */
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
  font-size: 18px; /* 原先是 28px */
}

.note-container {
  margin-top: 3rem; /* 增加与上面三行的垂直距离 */
}
/* 【新增】为账户信息视图添加一些样式 */
.account-info {
  text-align: center;
}
.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding: 2.0rem 0;
  margin: 0;
}
.dark .info-grid p {
  border-bottom-color: #333;
}
.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
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

/* 【新增】为按钮组和次要按钮添加样式 */
.button-group {
  display: grid;
  grid-template-columns: 5fr 1fr; /* 改成返回主页宽，登出窄 */
  gap: 1rem;
  margin-top: 2rem;
}

.button--secondary {
  width: 100%;
  padding: 0.8rem;
  background-color: #f0f0f0; /* 浅灰色背景 */
  color: #333; /* 深色文字 */
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

.note-textarea {
  width: 100%;
  min-height: 290px;
  padding: 0.6rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  resize: vertical;
  transition: border-color 0.2s;
}
.note-textarea:focus {
  border-color: #00b386;
  outline: none;
}
.dark .note-textarea {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
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
</style>

<style>
/* 全局样式保持不变 */
body, html {
  background-color: #f8f9fa;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px);
  background-size: 25px 25px;
  transition: background-color 0.3s ease;
}
.dark body, html {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
}

.emoji-bar {
  margin-top: 1rem;
  text-align: left;
}
.emoji-bar {
  margin-top: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.emoji-bar button {
  flex: 1;
  padding: 0.5rem;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  cursor: pointer;
  background: #f9f9f9;
}

.dark .emoji-bar button {
  background-color: #2c2c2e;
  color: #fff;
  border-color: #444;
}
.emoji-bar button {
  color: #111; /* 明亮模式下的文字 */
}
.dark .emoji-bar button {
  color: #fff; /* 暗色模式下的文字 */
}
emoji-picker {
  width: 100%;
  max-width: 100%;
  height: 320px;
  margin-top: 0.5rem;
  --emoji-size: 20px;
}
</style>
