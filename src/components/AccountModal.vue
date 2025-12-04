<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import { useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
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
const authStore = useAuthStore()

// --- 状态定义 ---
const journalingDays = ref(0)
const journalingYears = ref(0)
const journalingRemainderDays = ref(0)
const firstNoteDateText = ref<string | null>(null)
const hasFetched = ref(false)
const totalCount = ref<number | null>(null)
const totalChars = ref<number | null>(null)
const storageUsedBytes = ref(0)
const storageLimitBytes = ref(104857600)
const showPwdModal = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({ old: '', new: '', confirm: '' })

// 编辑状态
const isEditingName = ref(false)
const tempName = ref('')
const isUploadingAvatar = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const avatarLoadError = ref(false)

// --- 计算属性 ---
const storageUsedMB = computed(() => (storageUsedBytes.value / 1024 / 1024).toFixed(2))
const storageLimitMB = computed(() => (storageLimitBytes.value / 1024 / 1024).toFixed(0))
const storagePercent = computed(() => {
  if (storageLimitBytes.value === 0)
    return 0
  const pct = (storageUsedBytes.value / storageLimitBytes.value) * 100
  return Math.min(100, Math.max(0, pct))
})

const userAvatar = computed(() => props.user?.user_metadata?.avatar_url || null)

const userName = computed(() => {
  const meta = props.user?.user_metadata
  if (meta?.full_name)
    return meta.full_name
  if (meta?.name)
    return meta.name
  if (meta?.display_name)
    return meta.display_name
  if (props.email)
    return props.email.split('@')[0]
  return t('auth.default_nickname')
})

// [修改] 判断是否允许修改密码 (更精准的逻辑)
const canChangePassword = computed(() => {
  // 1. 获取用户的身份列表
  const identities = props.user?.identities

  // 2. 如果能获取到列表，检查其中是否包含 'email' 身份
  if (Array.isArray(identities) && identities.length > 0)
    return identities.some(identity => identity.provider === 'email')

  // 3. 兜底：如果列表为空（极少见），回退到检查 app_metadata
  return props.user?.app_metadata?.provider === 'email'
})

function onAvatarError() {
  avatarLoadError.value = true
}

function formatDateI18n(d: Date) {
  return t('notes.account.date_format', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  })
}

// --- 图片压缩辅助函数 ---
function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxSize = 300
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width
            width = maxSize
          }
        }
        else {
          if (height > maxSize) {
            width *= maxSize / height
            height = maxSize
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)

        canvas.toBlob((blob) => {
          if (blob)
            resolve(blob)
          else reject(new Error('Canvas to Blob failed'))
        }, 'image/jpeg', 0.7)
      }
      img.onerror = err => reject(err)
    }
    reader.onerror = err => reject(err)
  })
}

// --- 修改昵称逻辑 ---
function startEditName() {
  tempName.value = userName.value
  isEditingName.value = true
}

async function saveName() {
  const newName = tempName.value.trim()
  if (!newName) {
    isEditingName.value = false
    return
  }
  if (newName === userName.value) {
    isEditingName.value = false
    return
  }

  try {
    const { error } = await supabase.auth.updateUser({
      data: { full_name: newName },
    })
    if (error)
      throw error
    await authStore.refreshUser()
    messageHook.success(t('auth.profile_updated'))
  }
  catch (e: any) {
    messageHook.error(e.message || t('auth.update_failed'))
  }
  finally {
    isEditingName.value = false
  }
}

// --- 上传头像逻辑 ---
function triggerFileUpload() {
  fileInputRef.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0)
    return

  const originalFile = input.files[0]
  const oldAvatarUrl = props.user?.user_metadata?.avatar_url

  if (originalFile.size > 10 * 1024 * 1024) {
    messageHook.warning(t('auth.avatar_too_big'))
    return
  }

  isUploadingAvatar.value = true
  try {
    const compressedBlob = await compressImage(originalFile)
    const fileToUpload = new File([compressedBlob], 'avatar.jpg', { type: 'image/jpeg' })
    const fileName = `${props.user!.id}-${Date.now()}.jpg`
    const filePath = `${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, fileToUpload, {
        contentType: 'image/jpeg',
        upsert: true,
      })

    if (uploadError)
      throw uploadError

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: publicUrl },
    })

    if (updateError)
      throw updateError

    if (oldAvatarUrl) {
      try {
        const urlParts = oldAvatarUrl.split('/avatars/')
        if (urlParts.length > 1) {
          const oldPath = urlParts[1]
          supabase.storage.from('avatars').remove([oldPath]).then(({ error }) => {
            if (error)
              console.warn('旧头像删除失败:', error)
          })
        }
      }
      catch (e) {
        console.warn('解析旧头像失败', e)
      }
    }

    await authStore.refreshUser()
    avatarLoadError.value = false
    messageHook.success(t('auth.profile_updated'))
  }
  catch (e: any) {
    console.error(e)
    messageHook.error(t('auth.upload_failed'))
  }
  finally {
    isUploadingAvatar.value = false
    if (fileInputRef.value)
      fileInputRef.value.value = ''
  }
}

// --- 统计数据获取逻辑 ---
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
  catch (err) { /* ignore */ }
}

async function fetchNotesCount() {
  if (!props.user) {
    totalCount.value = 0
    return
  }
  try {
    const { count, error } = await supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', props.user.id)
    if (error)
      throw error
    totalCount.value = typeof count === 'number' ? count : 0
  }
  catch (err) {
    totalCount.value = props.totalNotes ?? 0
  }
}

async function fetchTotalChars() {
  if (!props.user) {
    totalChars.value = 0
    return
  }
  try {
    const { data, error } = await supabase.from('notes').select('content').eq('user_id', props.user.id)
    if (error)
      throw error
    totalChars.value = data?.reduce((sum, n) => sum + (n.content?.length || 0), 0) ?? 0
  }
  catch (err) {
    totalChars.value = 0
  }
}

async function fetchStorageStats() {
  if (!props.user)
    return
  try {
    const { data, error } = await supabase.from('user_storage_stats').select('storage_used_bytes, storage_limit_bytes').eq('id', props.user.id).single()
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

watch(() => props.show, (visible) => {
  if (visible) {
    avatarLoadError.value = false
    if (!hasFetched.value) {
      fetchFirstNoteAndStreak()
      fetchNotesCount()
      fetchTotalChars()
      fetchStorageStats()
      hasFetched.value = true
    }
  }
})

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
    window.location.assign('/auth')
  }
  catch (e) {
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
    messageHook.warning(t('auth.messages.fill_all_fields'))
    return
  }
  if (pwdForm.new.length < 6) {
    messageHook.warning(t('auth.messages.password_too_short'))
    return
  }
  if (pwdForm.new !== pwdForm.confirm) {
    messageHook.error(t('auth.messages.passwords_do_not_match'))
    return
  }
  pwdLoading.value = true
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: props.email, password: pwdForm.old })
    if (signInError)
      throw new Error(t('auth.messages.old_password_wrong'))
    const { error: updateError } = await supabase.auth.updateUser({ password: pwdForm.new })
    if (updateError)
      throw updateError
    messageHook.success(t('auth.messages.change_password_success'))
    closePwdModal()
    setTimeout(() => {
      doSignOut()
    }, 1500)
  }
  catch (err: any) {
    messageHook.error(err.message || t('auth.messages.change_password_failed'))
  }
  finally {
    pwdLoading.value = false
  }
}

function handleForgotOldPwd() {
  dialog.warning({
    title: t('auth.relogin_required_title'),
    content: t('auth.relogin_required_content'),
    positiveText: t('auth.confirm_logout'),
    negativeText: t('auth.cancel'),
    onPositiveClick: async () => {
      messageHook.loading(t('auth.redirecting'))
      try {
        await supabase.auth.signOut()
        localStorage.clear()
        window.location.href = '/auth?mode=forgot'
      }
      catch (e) {
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
          <div class="profile-header">
            <input ref="fileInputRef" type="file" accept="image/*" style="display: none" @change="handleFileChange">

            <div class="avatar-wrapper" :class="{ 'is-loading': isUploadingAvatar }" @click="triggerFileUpload">
              <img
                v-if="userAvatar && !avatarLoadError"
                :src="userAvatar"
                class="profile-avatar"
                alt="Avatar"
                @error="onAvatarError"
              >
              <div v-else class="profile-avatar placeholder">
                {{ userName.charAt(0).toUpperCase() }}
              </div>
              <div class="avatar-overlay">
                <span v-if="isUploadingAvatar">...</span>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </div>
            </div>

            <div class="profile-name-row">
              <template v-if="isEditingName">
                <input v-model="tempName" class="name-input" autofocus @blur="saveName" @keyup.enter="saveName">
              </template>
              <template v-else>
                <div class="profile-name">
                  {{ userName }}
                </div>
                <button class="edit-icon-btn" @click="startEditName">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
              </template>
            </div>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('notes.account.email_label') }}</span>
            <span class="info-value">{{ email }}</span>
          </div>

          <div v-if="canChangePassword" class="info-item">
            <span class="info-label">{{ t('auth.password') }}</span>
            <button class="link-btn" @click="openPwdModal">
              {{ t('auth.change') }}
            </button>
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
              <span class="info-value-simple">{{ storageUsedMB }} MB / {{ storageLimitMB }} MB</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: `${storagePercent}%`, backgroundColor: storagePercent > 90 ? '#ef4444' : '#00b386' }" />
            </div>
          </div>
          <div class="info-item">
            <span class="info-label">{{ t('notes.account.first_note_created_at') }}</span>
            <span class="info-value">{{ firstNoteDateText ?? '—' }}</span>
          </div>
          <div v-if="journalingYears > 0" class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">{{ t('notes.account.streak_years_days', { years: journalingYears, days: journalingRemainderDays }) }}</span>
          </div>
          <div v-else class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">{{ t('notes.account.streak_days_only', { days: journalingDays }) }}</span>
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
          <h3>{{ t('auth.change_password_title') }}</h3>
          <button class="close-button" @click="closePwdModal">
            &times;
          </button>
        </div>
        <p class="pwd-tip">
          {{ t('auth.change_password_tip') }}
        </p>
        <div class="pwd-form">
          <input v-model="pwdForm.old" type="password" class="pwd-input" :placeholder="t('auth.old_password_placeholder')">
          <input v-model="pwdForm.new" type="password" class="pwd-input" :placeholder="t('auth.new_password_placeholder')">
          <input v-model="pwdForm.confirm" type="password" class="pwd-input" :placeholder="t('auth.confirm_new_password_placeholder')">
        </div>
        <div class="pwd-actions">
          <span class="forgot-link" @click="handleForgotOldPwd">{{ t('auth.forgot_old_password') }}</span>
          <div class="pwd-btns">
            <button class="btn-grey pwd-btn-item" @click="closePwdModal">
              {{ t('auth.cancel') }}
            </button>
            <button class="btn-green pwd-btn-item" :disabled="pwdLoading" @click="handleUpdatePassword">
              {{ pwdLoading ? t('auth.submitting') : t('auth.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 1.5rem;
}
.avatar-wrapper {
  position: relative;
  width: 72px;
  height: 72px;
  margin-bottom: 0.8rem;
  cursor: pointer;
  border-radius: 50%;
}
.profile-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid #f0f0f0;
  display: block;
}
.dark .profile-avatar { border-color: #3a3a3c; }
.profile-avatar.placeholder {
  background-color: #00b386;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: bold;
}
.avatar-overlay {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  color: white;
}
.avatar-wrapper:hover .avatar-overlay, .avatar-wrapper.is-loading .avatar-overlay { opacity: 1; }

.profile-name-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
}
.profile-name {
  font-size: 18px;
  font-weight: 600;
  color: #111;
  text-align: center;
}
.dark .profile-name { color: #eee; }
.name-input {
  font-size: 16px;
  padding: 2px 6px;
  border: 1px solid #00b386;
  border-radius: 4px;
  outline: none;
  width: 120px;
  text-align: center;
  background: transparent;
  color: inherit;
}
.edit-icon-btn {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  padding: 4px;
  display: flex;
  opacity: 0;
  transition: opacity 0.2s;
}
.profile-name-row:hover .edit-icon-btn { opacity: 1; }
.dark .edit-icon-btn { color: #666; }
.edit-icon-btn:hover { color: #00b386; }

/* 模态框基础样式 */
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex; justify-content: center; align-items: center; z-index: 1000;
}
.pwd-overlay { z-index: 1010; }
.modal-content {
  background: white; padding: 2rem; border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  width: 90%; max-width: 420px; position: relative;
}
.dark .modal-content { background: #2a2a2a; color: #e0e0e0; }
.pwd-content { max-width: 380px; padding: 1.5rem; }
.modal-header, .pwd-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1rem;
}
.modal-header { margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid #eee; }
.dark .modal-header { border-bottom-color: #444; }
.modal-title, .pwd-header h3 { font-size: 18px; font-weight: 600; margin: 0; }
.close-button { background: none; border: none; font-size: 28px; cursor: pointer; color: #888; padding: 0; line-height: 1; }
.dark .close-button { color: #bbb; }
.modal-body { display: flex; flex-direction: column; gap: 1rem; }
.info-item { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.info-label { color: #555; font-weight: 500; }
.dark .info-label { color: #aaa; }
.info-value {
  color: #111; font-weight: 500; background-color: #f0f0f0;
  padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 14px; text-align: right; min-width: 80px;
}
.dark .info-value { background-color: #3a3a3c; color: #f0f0f0; }
.storage-section { padding-bottom: 0.5rem; border-bottom: 1px dashed #eee; }
.dark .storage-section { border-bottom-color: #444; }
.info-value-simple { color: #111; font-weight: 600; font-size: 13px; }
.dark .info-value-simple { color: #fff; }
.progress-track {
  width: 100%; height: 8px; background-color: #f0f0f0;
  border-radius: 4px; overflow: hidden; margin-top: 4px;
}
.dark .progress-track { background-color: #3a3a3c; }
.progress-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease, background-color 0.3s ease; }
.modal-footer { display: grid; grid-template-columns: 5fr 2fr; gap: 0.9rem; margin-top: 1.25rem; }
.btn-green {
  display: inline-block; text-decoration: none; text-align: center; width: 100%;
  background-color: #00b386; color: #fff; border-radius: 6px; padding: 0.8rem;
  font-size: 15px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none;
}
.btn-green:hover { background-color: #009a74; }
.btn-green:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-grey {
  background-color: #f0f0f0; color: #333; border: 1px solid #ccc;
  border-radius: 6px; padding: 0.8rem; font-size: 15px; font-weight: 500;
  cursor: pointer; transition: background-color 0.2s;
}
.btn-grey:hover { background-color: #e5e5e5; }
.dark .btn-grey { background-color: #3a3a3c; color: #e0e0e0; border-color: #555; }
.dark .btn-grey:hover { background-color: #444; }
.pwd-tip { font-size: 13px; color: #666; margin-bottom: 1.5rem; line-height: 1.5; }
.dark .pwd-tip { color: #999; }
.pwd-form { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }
.pwd-input {
  width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 6px;
  font-size: 15px; outline: none; background: #fff; color: #333; box-sizing: border-box;
}
.pwd-input:focus { border-color: #00b386; }
.dark .pwd-input { background: #333; border-color: #555; color: #eee; }
.dark .pwd-input:focus { border-color: #00b386; }
.pwd-actions { display: flex; justify-content: space-between; align-items: center; }
.pwd-btns { display: flex; gap: 2rem; justify-content: center; }
.pwd-btn-item { width: 130px; padding: 0.6rem 0; }
.forgot-link { font-size: 13px; color: #4a90e2; cursor: pointer; }
.dark .forgot-link { color: #64b5f6; }
.link-btn { background: none; border: none; color: #00b386; cursor: pointer; font-size: 14px; padding: 0; text-decoration: underline; }
.dark .link-btn { color: #2dd4bf; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
