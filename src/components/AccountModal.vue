<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import { useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS } from '@/utils/cacheKeys'

const props = defineProps({
  show: { type: Boolean, required: true },
  email: { type: String, default: '' },
  totalNotes: { type: Number, default: 0 },
  user: { type: Object as () => User | null, required: true },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const dialog = useDialog()
const messageHook = useMessage()

const journalingDays = ref(0)
const journalingYears = ref(0)
const journalingRemainderDays = ref(0)
const firstNoteDateText = ref<string | null>(null)

const hasFetched = ref(false)
const totalCount = ref<number | null>(null)
const totalChars = ref<number | null>(null)

// --- 存储空间状态 ---
const storageUsedBytes = ref(0)
const storageLimitBytes = ref(104857600) // 默认 100MB

// --- 密码修改相关的状态 ---
const showPwdModal = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({
  old: '',
  new: '',
  confirm: '',
})

// --- 计算属性 (MB转换 & 百分比) ---
const storageUsedMB = computed(() => (storageUsedBytes.value / 1024 / 1024).toFixed(2))
const storageLimitMB = computed(() => (storageLimitBytes.value / 1024 / 1024).toFixed(0))
const storagePercent = computed(() => {
  if (storageLimitBytes.value === 0)
    return 0
  const pct = (storageUsedBytes.value / storageLimitBytes.value) * 100
  return Math.min(100, Math.max(0, pct))
})

function formatDateI18n(d: Date) {
  return t('notes.account.date_format', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  })
}

// 查询：最早笔记 & 坚持年/天
async function fetchFirstNoteAndStreak() {
  if (!props.user)
    return
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', props.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (error)
      throw error

    if (data?.created_at) {
      const first = new Date(data.created_at)
      firstNoteDateText.value = formatDateI18n(first)

      const today = new Date()
      first.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)

      let years = today.getFullYear() - first.getFullYear()
      let anniversaryThisYear = new Date(first)
      anniversaryThisYear.setFullYear(first.getFullYear() + years)

      if (anniversaryThisYear > today) {
        years -= 1
        anniversaryThisYear = new Date(first)
        anniversaryThisYear.setFullYear(first.getFullYear() + years)
      }

      const diffMs = today.getTime() - anniversaryThisYear.getTime()
      const remainDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      journalingYears.value = Math.max(0, years)
      journalingRemainderDays.value = Math.max(0, remainDays)

      if (journalingYears.value === 0) {
        const diffTime = Math.abs(today.getTime() - first.getTime())
        journalingDays.value = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      }
    }
    else {
      firstNoteDateText.value = null
      journalingYears.value = 0
      journalingRemainderDays.value = 0
      journalingDays.value = 0
    }
  }
  catch (err) {
    console.error(t('notes.account.errors.fetch_first_note_failed'), err)
  }
}

// 查询：笔记总数
async function fetchNotesCount() {
  if (!props.user) {
    totalCount.value = 0
    return
  }
  try {
    const { count, error } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', props.user.id)

    if (error)
      throw error
    totalCount.value = typeof count === 'number' ? count : 0
  }
  catch (err) {
    console.error(t('notes.account.errors.fetch_notes_count_failed'), err)
    totalCount.value = props.totalNotes ?? 0
  }
}

// 查询：总字数
async function fetchTotalChars() {
  if (!props.user) {
    totalChars.value = 0
    return
  }
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('content')
      .eq('user_id', props.user.id)

    if (error)
      throw error

    totalChars.value = data?.reduce((sum, n) => {
      if (n.content)
        sum += n.content.length
      return sum
    }, 0) ?? 0
  }
  catch (err) {
    console.error(t('notes.account.errors.fetch_total_chars_failed'), err)
    totalChars.value = 0
  }
}

// 查询存储空间
async function fetchStorageStats() {
  if (!props.user)
    return
  try {
    const { data, error } = await supabase
      .from('user_storage_stats')
      .select('storage_used_bytes, storage_limit_bytes')
      .eq('id', props.user.id)
      .single()

    if (error && error.code !== 'PGRST116')
      throw error

    if (data) {
      storageUsedBytes.value = data.storage_used_bytes || 0
      storageLimitBytes.value = data.storage_limit_bytes || 104857600
    }
  }
  catch (err) {
    console.error('Fetch storage stats failed:', err)
  }
}

// 打开弹窗后首次查询
watch(() => props.show, (visible) => {
  if (visible && !hasFetched.value) {
    fetchFirstNoteAndStreak()
    fetchNotesCount()
    fetchTotalChars()
    fetchStorageStats()
    hasFetched.value = true
  }
})

// 登出确认
function openLogoutConfirm() {
  dialog.warning({
    title: t('notes.account.logout_confirm.title'),
    content: t('notes.account.logout_confirm.content'),
    negativeText: t('notes.account.logout_confirm.negative'),
    positiveText: t('notes.account.logout_confirm.positive'),
    async onPositiveClick() {
      await doSignOut()
    },
  })
}

// --- 修改点：登出/清理逻辑 ---
async function doSignOut() {
  try {
    await supabase.auth.signOut()
    localStorage.removeItem('last_known_user_id_v1')
    localStorage.removeItem('pinned_tags_v1')
    localStorage.removeItem('tag_icons_v1')
    localStorage.removeItem(CACHE_KEYS.HOME)
    localStorage.removeItem(CACHE_KEYS.HOME_META)
    localStorage.removeItem('new_note_content_draft')

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(CACHE_KEYS.TAG_PREFIX) || key.startsWith(CACHE_KEYS.SEARCH_PREFIX))
        localStorage.removeItem(key)
    })

    // [修改]：跳转到 /auth (登录界面) 而不是首页 /
    window.location.assign('/auth')
  }
  catch (e) {
    console.error(t('notes.account.errors.signout_failed'), e)
    // [修改]：异常情况下也跳转到 /auth
    window.location.assign('/auth')
  }
}

function openPwdModal() {
  pwdForm.old = ''
  pwdForm.new = ''
  pwdForm.confirm = ''
  showPwdModal.value = true
}

function closePwdModal() {
  showPwdModal.value = false
}

async function handleUpdatePassword() {
  if (!pwdForm.old || !pwdForm.new || !pwdForm.confirm) {
    messageHook.warning('请填写所有密码字段')
    return
  }
  if (pwdForm.new.length < 6) {
    messageHook.warning('新密码至少需要 6 位')
    return
  }
  if (pwdForm.new !== pwdForm.confirm) {
    messageHook.error('两次输入的新密码不一致')
    return
  }

  pwdLoading.value = true

  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: props.email,
      password: pwdForm.old,
    })

    if (signInError)
      throw new Error('旧密码错误，请检查')

    const { error: updateError } = await supabase.auth.updateUser({
      password: pwdForm.new,
    })

    if (updateError)
      throw updateError

    messageHook.success('密码修改成功，即将跳转登录...')

    closePwdModal()
    // 延时后调用 doSignOut，现在 doSignOut 会跳到 /auth
    setTimeout(() => {
      doSignOut()
    }, 1500)
  }
  catch (err: any) {
    console.error(err)
    messageHook.error(err.message || '修改失败，请重试')
  }
  finally {
    pwdLoading.value = false
  }
}

function handleForgotOldPwd() {
  dialog.warning({
    title: '需要重新登录',
    content: '找回密码需要退出当前帐号，并跳转至登录页面的“忘记密码”入口。是否确认退出？',
    positiveText: '确认退出',
    negativeText: '取消',
    onPositiveClick: async () => {
      messageHook.loading('正在跳转...')

      try {
        // 1. 强制登出 Supabase
        await supabase.auth.signOut()

        // 2. 清理本地缓存
        localStorage.removeItem('last_known_user_id_v1')
        localStorage.removeItem('pinned_tags_v1')
        localStorage.removeItem('tag_icons_v1')
        localStorage.removeItem(CACHE_KEYS.HOME)
        localStorage.removeItem(CACHE_KEYS.HOME_META)
        localStorage.removeItem('new_note_content_draft')

        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(CACHE_KEYS.TAG_PREFIX) || key.startsWith(CACHE_KEYS.SEARCH_PREFIX))
            localStorage.removeItem(key)
        })

        // 3. 强制跳转到带参数的 auth 页面
        window.location.href = '/auth?mode=forgot'
      }
      catch (e) {
        console.error(e)
        // 即使出错也要强制跳转
        window.location.href = '/auth?mode=forgot'
      }
    },
  })
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">
            {{ t('notes.account.title') }}
          </h2>
          <button class="close-button" @click="emit('close')">
            &times;
          </button>
        </div>

        <div class="modal-body">
          <div class="info-item">
            <span class="info-label">{{ t('notes.account.email_label') }}</span>
            <span class="info-value">{{ email }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('auth.password') }}</span>
            <button class="link-btn" @click="openPwdModal">修改</button>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('notes.total_notes') }}</span>
            <span class="info-value">{{ totalCount ?? '—' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ t('notes.total_chars') }}</span>
            <span class="info-value">{{ totalChars ?? '—' }}</span>
          </div>

          <div class="storage-section">
            <div class="info-item" style="margin-bottom: 0.4rem;">
              <span class="info-label">{{ t('notes.total_storage') }}</span>
              <span class="info-value-simple">
                {{ storageUsedMB }} MB / {{ storageLimitMB }} MB
              </span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{
                  width: `${storagePercent}%`,
                  backgroundColor: storagePercent > 90 ? '#ef4444' : '#00b386',
                }"
              />
            </div>
          </div>
          <div class="info-item">
            <span class="info-label">{{ t('notes.account.first_note_created_at') }}</span>
            <span class="info-value">{{ firstNoteDateText ?? '—' }}</span>
          </div>

          <div v-if="journalingYears > 0" class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">
              {{ t('notes.account.streak_years_days', { years: journalingYears, days: journalingRemainderDays }) }}
            </span>
          </div>
          <div v-else class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">
              {{ t('notes.account.streak_days_only', { days: journalingDays }) }}
            </span>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-green" @click="emit('close')">
            {{ t('auth.return') }}
          </button>
          <button class="btn-grey" @click="openLogoutConfirm">
            {{ t('notes.account.logout') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="showPwdModal" class="modal-overlay pwd-overlay">
      <div class="modal-content pwd-content">
        <div class="pwd-header">
          <h3>修改密码</h3>
          <button class="close-button" @click="closePwdModal">&times;</button>
        </div>

        <p class="pwd-tip">修改后各平台都需重新登录，请确认笔记都已完成同步</p>

        <div class="pwd-form">
          <input
            v-model="pwdForm.old"
            type="password"
            class="pwd-input"
            placeholder="旧密码"
          >
          <input
            v-model="pwdForm.new"
            type="password"
            class="pwd-input"
            placeholder="新密码（至少 6 位）"
          >
          <input
            v-model="pwdForm.confirm"
            type="password"
            class="pwd-input"
            placeholder="再次输入新密码"
          >
        </div>

        <div class="pwd-actions">
          <span class="forgot-link" @click="handleForgotOldPwd">忘记旧密码</span>
          <div class="pwd-btns">
            <button class="btn-grey pwd-btn-item" @click="closePwdModal">
              取消
            </button>

            <button
              class="btn-green pwd-btn-item"
              :disabled="pwdLoading"
              @click="handleUpdatePassword"
            >
              {{ pwdLoading ? '提交中...' : '确定' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.pwd-overlay {
  z-index: 1010;
}

.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 420px;
  position: relative;
}
.dark .modal-content {
  background: #2a2a2a;
  color: #e0e0e0;
}

.pwd-content {
    max-width: 380px;
    padding: 1.5rem;
}

.pwd-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}
.pwd-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
}

.pwd-tip {
    font-size: 13px;
    color: #666;
    margin-bottom: 1.5rem;
    line-height: 1.5;
}
.dark .pwd-tip {
    color: #999;
}

.pwd-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
}

.pwd-input {
    width: 100%;
    padding: 0.8rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 15px;
    outline: none;
    background: #fff;
    color: #333;
    box-sizing: border-box;
}
.pwd-input:focus {
    border-color: #00b386;
}
.dark .pwd-input {
    background: #333;
    border-color: #555;
    color: #eee;
}
.dark .pwd-input:focus {
    border-color: #00b386;
}

.pwd-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.pwd-btns {
    display: flex;
    gap: 2rem;
}

.pwd-btn-item {
    width: 130px;    /* 这里控制宽度：数值越大，按钮越宽 */
    padding: 0.6rem 0; /* 上下保留一点内边距 */
}

.forgot-link {
    font-size: 13px;
    color: #4a90e2;
    cursor: pointer;
}
.dark .forgot-link {
    color: #64b5f6;
}

.link-btn {
    background: none;
    border: none;
    color: #00b386;
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    text-decoration: underline;
}
.dark .link-btn {
    color: #2dd4bf;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #eee;
}
.dark .modal-header {
  border-bottom-color: #444;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.close-button {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: #888;
  padding: 0;
  line-height: 1;
}
.dark .close-button {
  color: #bbb;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.info-label {
  color: #555;
  font-weight: 500;
}
.dark .info-label {
  color: #aaa;
}

.info-value {
  color: #111;
  font-weight: 500;
  background-color: #f0f0f0;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 14px;
  text-align: right;
  min-width: 80px;
}
.dark .info-value {
  background-color: #3a3a3c;
  color: #f0f0f0;
}

.storage-section {
  padding-bottom: 0.5rem;
  border-bottom: 1px dashed #eee;
}
.dark .storage-section {
  border-bottom-color: #444;
}

.info-value-simple {
  color: #111;
  font-weight: 600;
  font-size: 13px;
}
.dark .info-value-simple {
  color: #fff;
}

.progress-track {
  width: 100%;
  height: 8px;
  background-color: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}
.dark .progress-track {
  background-color: #3a3a3c;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease, background-color 0.3s ease;
}

.modal-footer {
  display: grid;
  grid-template-columns: 5fr 2fr;
  gap: 0.9rem;
  margin-top: 1.25rem;
}

.btn-green {
  display: inline-block;
  text-decoration: none;
  text-align: center;
  width: 100%;
  background-color: #00b386;
  color: #fff;
  border-radius: 6px;
  padding: 0.8rem;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  border: none;
}
.btn-green:hover {
  background-color: #009a74;
}
.btn-green:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.btn-grey {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 0.8rem;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-grey:hover {
  background-color: #e5e5e5;
}
.dark .btn-grey {
  background-color: #3a3a3c;
  color: #e0e0e0;
  border-color: #555;
}
.dark .btn-grey:hover {
  background-color: #444;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
