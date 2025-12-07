<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import { useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

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
// [删除] totalChars 相关状态
const storageUsedBytes = ref(0)
const storageLimitBytes = ref(104857600)
const showPwdModal = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({ old: '', new: '', confirm: '' })

// 编辑状态 (昵称)
const isEditingName = ref(false)
const tempName = ref('')

// [新增] 编辑状态 (签名)
const isEditingSignature = ref(false)
const tempSignature = ref('')

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

// [新增] 签名计算属性 (默认文案)
const userSignature = computed(() => {
  return props.user?.user_metadata?.signature || t('auth.default_signature')
})

const canChangePassword = computed(() => {
  const identities = props.user?.identities
  if (Array.isArray(identities) && identities.length > 0)
    return identities.some(identity => identity.provider === 'email')
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

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        // 【修改点 1】: 将 300 改为 150 或 200。
        // 200px 足够清晰且体积很小；如果追求极致小（3KB左右），可改为 120。
        const maxSize = 200
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

        // 【修改点 2 & 3】: 使用 'image/webp' 格式，质量设为 0.6
        // WebP 格式在小图压缩上极具优势，0.6 的质量对于头像完全足够
        canvas.toBlob((blob) => {
          if (blob)
            resolve(blob)
          else reject(new Error('Canvas to Blob failed'))
        }, 'image/webp', 0.6)
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
    const { error } = await supabase.auth.updateUser({ data: { full_name: newName } })
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

// --- [新增] 修改签名逻辑 ---
function startEditSignature() {
  tempSignature.value = userSignature.value
  isEditingSignature.value = true
}

async function saveSignature() {
  const newSig = tempSignature.value.trim()
  if (!newSig) {
    isEditingSignature.value = false
    return
  }
  if (newSig === userSignature.value) {
    isEditingSignature.value = false
    return
  }
  try {
    const { error } = await supabase.auth.updateUser({ data: { signature: newSig } })
    if (error)
      throw error
    await authStore.refreshUser()
    messageHook.success(t('auth.signature_updated'))
  }
  catch (e: any) {
    messageHook.error(e.message || t('auth.update_failed'))
  }
  finally {
    isEditingSignature.value = false
  }
}

// --- 上传头像逻辑 (包含修复后的删除逻辑) ---
function triggerFileUpload() {
  fileInputRef.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0)
    return

  const originalFile = input.files[0]
  if (originalFile.size > 5 * 1024 * 1024) { // 5MB 限制
    messageHook.warning(t('auth.avatar_too_big'))
    return
  }

  isUploadingAvatar.value = true

  // 1. 锁定旧头像 URL (用于后续清理)
  const oldAvatarUrl = props.user?.user_metadata?.avatar_url

  try {
    // 2. 压缩图片 (现在返回的是 WebP 格式的 Blob)
    const compressedBlob = await compressImage(originalFile)

    const timestamp = Date.now()
    // 【改动3】文件名后缀改为 .webp
    const fileName = `${timestamp}.webp`
    const filePath = `${props.user!.id}/${fileName}`

    // 【改动4】创建 File 对象时指定 type 为 image/webp
    const fileToUpload = new File([compressedBlob], fileName, { type: 'image/webp' })

    // 3. 上传新图片
    // 【改动5】contentType 必须显式设为 image/webp，否则某些浏览器可能默认识别错误
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, fileToUpload, { contentType: 'image/webp', upsert: true })

    if (uploadError)
      throw uploadError

    // 4. 获取新图片 Public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    // 添加时间戳防止 CDN 缓存旧图
    const finalUrl = `${publicUrl}?t=${timestamp}`

    // 5. 更新用户资料
    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: finalUrl },
    })

    if (updateError)
      throw updateError

    // 6. 尝试清理旧头像文件
    if (oldAvatarUrl) {
      // 检查是否是 Supabase 的图片
      const isSupabase = oldAvatarUrl.includes('supabase.co') || oldAvatarUrl.includes('/storage/v1/object')

      if (isSupabase) {
        try {
          const userId = props.user!.id
          // 正则提取：匹配 "user_id/xxx.ext" 这种路径
          // 注意：旧图片可能是 jpg 或 png，这个正则都能匹配到
          const regex = new RegExp(`${userId}\/[^?#]+`)
          const match = oldAvatarUrl.match(regex)

          if (match) {
            let oldPath = match[0]
            oldPath = decodeURIComponent(oldPath) // 解码

            // 安全检查：路径必须包含用户ID，防止误删
            if (oldPath.includes(userId))
              await supabase.storage.from('avatars').remove([oldPath])
          }
        }
        catch (delErr) {
          console.warn('旧头像清理失败，但不影响主流程', delErr)
        }
      }
    }

    // 7. 刷新本地状态
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

// 1. 提取公共的计算逻辑到一个函数中
function calculateDaysFromDate(dateStr: string) {
  const first = new Date(dateStr)
  firstNoteDateText.value = formatDateI18n(first)

  const today = new Date()
  first.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)

  let years = today.getFullYear() - first.getFullYear()

  // 计算周年
  let anniversary = new Date(first)
  anniversary.setFullYear(first.getFullYear() + years)

  if (anniversary > today) {
    years -= 1
    anniversary = new Date(first)
    anniversary.setFullYear(first.getFullYear() + years)
  }

  const remainDays = Math.floor((today.getTime() - anniversary.getTime()) / (1000 * 60 * 60 * 24))
  journalingYears.value = Math.max(0, years)
  journalingRemainderDays.value = Math.max(0, remainDays)

  // 如果不满一年，计算总天数
  if (journalingYears.value === 0)
    journalingDays.value = Math.ceil(Math.abs(today.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

// 2. 获取逻辑
async function fetchFirstNoteAndStreak() {
  if (!props.user)
    return

  const CACHE_KEY = `first_note_date_${props.user.id}`
  const cachedDate = localStorage.getItem(CACHE_KEY)

  // --- 策略 A: 命中缓存 ---
  if (cachedDate) {
    calculateDaysFromDate(cachedDate)
    return
  }

  // --- 策略 B: 无缓存，请求 Supabase ---
  try {
    const { data } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', props.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (data?.created_at) {
      localStorage.setItem(CACHE_KEY, data.created_at)
      calculateDaysFromDate(data.created_at)
    }
    else {
      firstNoteDateText.value = null
      journalingYears.value = 0
      journalingRemainderDays.value = 0
      journalingDays.value = 0
    }
  }
  catch (e) {
    // 修复 ESLint error: Empty block statement
    console.error('Fetch first note error:', e)
  }
}

async function fetchNotesCount() {
  if (!props.user) {
    totalCount.value = 0
    return
  }

  try {
    const { count } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', props.user.id)

    totalCount.value = typeof count === 'number' ? count : 0
  }
  catch (e) {
    totalCount.value = props.totalNotes ?? 0
  }
}

async function fetchStorageStats() {
  if (!props.user)
    return

  try {
    const { data } = await supabase
      .from('user_storage_stats')
      .select('storage_used_bytes, storage_limit_bytes')
      .eq('id', props.user.id)
      .single()

    if (data) {
      storageUsedBytes.value = data.storage_used_bytes || 0
      storageLimitBytes.value = data.storage_limit_bytes || 104857600
    }
  }
  catch (e) {
    // 修复 ESLint error: Empty block statement
    console.warn('Fetch storage stats error (optional):', e)
  }
}

watch(() => props.show, (visible) => {
  if (visible) {
    avatarLoadError.value = false
    if (!hasFetched.value) {
      fetchFirstNoteAndStreak()
      fetchNotesCount()
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
    localStorage.clear()
    window.location.assign('/auth')
  }
  catch (e) {
    // 虽然这里出错概率低，但也打印一下，避免 empty block
    console.error('Sign out error:', e)
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
        // 避免 empty block
        console.error(e)
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
              <img v-if="userAvatar && !avatarLoadError" :src="userAvatar" class="profile-avatar" alt="Avatar" @error="onAvatarError">
              <div v-else class="profile-avatar placeholder">
                {{ userName.charAt(0).toUpperCase() }}
              </div>
              <div v-if="isUploadingAvatar" class="avatar-overlay loading">
                <span>...</span>
              </div>
              <div v-else class="avatar-edit-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </div>
            </div>

            <div class="profile-name-row">
              <template v-if="isEditingName">
                <input v-model="tempName" class="name-input" autofocus @blur="saveName" @keyup.enter="saveName">
              </template>
              <template v-else>
                <div class="name-display-wrapper" @click="startEditName">
                  <div class="profile-name">
                    {{ userName }}
                  </div>
                  <button class="edit-icon-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                </div>
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
            <span class="info-label">{{ t('auth.signature_label') }}</span>

            <div class="signature-display-wrapper">
              <template v-if="isEditingSignature">
                <input v-model="tempSignature" class="signature-input" autofocus :placeholder="t('auth.input_signature')" @blur="saveSignature" @keyup.enter="saveSignature">
              </template>
              <template v-else>
                <div class="signature-clickable" @click="startEditSignature">
                  <span class="signature-text">{{ userSignature }}</span>
                  <button class="edit-icon-btn small">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                </div>
              </template>
            </div>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('notes.total_notes') }}</span>
            <span class="info-value">{{ totalCount ?? '—' }}</span>
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
/* ===========================================================================
   🎨 账户组件主题变量定义
   支持：默认浅色、系统深色模式、手动 .dark 类
   =========================================================================== */
.modal-overlay {
  /* --- ☀️ 默认浅色模式变量 --- */
  --ac-bg: #ffffff;                 /* 弹窗背景 */
  --ac-text: #333333;               /* 主文字 */
  --ac-text-sub: #666666;           /* 次要文字/标签 */
  --ac-border: #eeeeee;             /* 分割线/边框 */

  --ac-block-bg: #f0f0f0;           /* 信息块背景 (右侧数值背景) */
  --ac-block-text: #111111;         /* 信息块文字 */

  --ac-hover: #f5f5f5;              /* 列表/按钮悬停 */

  --ac-input-bg: #ffffff;           /* 输入框背景 */
  --ac-input-border: #dddddd;       /* 输入框边框 */

  --ac-btn-grey-bg: #f0f0f0;        /* 灰色按钮背景 */
  --ac-btn-grey-text: #333333;      /* 灰色按钮文字 */
  --ac-btn-grey-border: #cccccc;    /* 灰色按钮边框 */

  --ac-avatar-border: #ffffff;      /* 头像白边 */
  --ac-icon-color: #bbbbbb;         /* 图标默认颜色 */
}

/* 🌑 情况1：系统设置为深色模式 */
@media (prefers-color-scheme: dark) {
  .modal-overlay {
    --ac-bg: #2a2a2a;
    --ac-text: #e0e0e0;
    --ac-text-sub: #aaaaaa;
    --ac-border: #444444;

    --ac-block-bg: #3a3a3c;
    --ac-block-text: #f0f0f0;

    --ac-hover: #3a3a3c;

    --ac-input-bg: #333333;
    --ac-input-border: #555555;

    --ac-btn-grey-bg: #3a3a3c;
    --ac-btn-grey-text: #e0e0e0;
    --ac-btn-grey-border: #555555;

    --ac-avatar-border: #333333;
    --ac-icon-color: #666666;
  }
}

/* 🌑 情况2：全局手动开启了 .dark 类 (优先级更高) */
:global(.dark) .modal-overlay {
  --ac-bg: #2a2a2a;
  --ac-text: #e0e0e0;
  --ac-text-sub: #aaaaaa;
  --ac-border: #444444;
  --ac-block-bg: #3a3a3c;
  --ac-block-text: #f0f0f0;
  --ac-hover: #3a3a3c;
  --ac-input-bg: #333333;
  --ac-input-border: #555555;
  --ac-btn-grey-bg: #3a3a3c;
  --ac-btn-grey-text: #e0e0e0;
  --ac-btn-grey-border: #555555;
  --ac-avatar-border: #333333;
  --ac-icon-color: #666666;
}

/* ===========================================================================
   1. 个人资料头部 (头像 + 昵称)
   =========================================================================== */
.profile-header {
  display: flex; flex-direction: column; align-items: center;
  margin-bottom: 1.5rem; width: 100%;
}

/* --- 头像部分 --- */
.avatar-wrapper {
  position: relative; width: 80px; height: 80px;
  margin-bottom: 1rem; cursor: pointer; border-radius: 50%;
  transition: transform 0.2s; margin-left: auto; margin-right: auto;
}
.avatar-wrapper:active { transform: scale(0.95); }

.profile-avatar {
  width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
  /* 应用变量 */
  border: 3px solid var(--ac-avatar-border);
  box-shadow: 0 4px 10px rgba(0,0,0,0.1);
  display: block;
}

.profile-avatar.placeholder {
  background: linear-gradient(135deg, #00b386, #009a74);
  color: white; display: flex; align-items: center; justify-content: center;
  font-size: 36px; font-weight: bold;
}

/* 相机编辑徽章 */
.avatar-edit-badge {
  position: absolute; bottom: 0; right: 0;
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  transition: all 0.2s; z-index: 2;

  /* 应用变量: 这里稍特殊，为了保证可见性，深色模式也用较亮背景或跟随主背景 */
  background-color: var(--ac-bg);
  border: 1px solid var(--ac-border);
  color: var(--ac-text-sub);
}
.avatar-wrapper:hover .avatar-edit-badge { background-color: #00b386; color: white; border-color: #00b386; }

.avatar-overlay.loading {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(255, 255, 255, 0.7); /* 加载层保持半透明白即可 */
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  color: #00b386; font-weight: bold; z-index: 3;
}
:global(.dark) .avatar-overlay.loading { background: rgba(0, 0, 0, 0.7); }

/* --- 昵称部分 --- */
.profile-name-row {
  display: flex; justify-content: center; align-items: center;
  width: 100%; position: relative; min-height: 32px;
}

.name-display-wrapper {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px; padding: 6px 12px 6px 48px; border-radius: 8px;
  cursor: pointer; transition: background-color 0.2s; max-width: 100%;
}
.name-display-wrapper:hover {
  background-color: var(--ac-hover);
}

.profile-name {
  font-size: 18px; font-weight: 600; line-height: 1.2; text-align: center;
  color: var(--ac-text);
}

/* 编辑笔图标 */
.edit-icon-btn {
  position: static !important; margin: 0 !important; transform: none !important;
  background: none; border: none; padding: 4px;
  cursor: pointer; opacity: 1 !important;
  display: flex; align-items: center; transition: all 0.2s; border-radius: 4px;
  color: var(--ac-icon-color);
}
.edit-icon-btn.small { padding: 2px; }
.name-display-wrapper:hover .edit-icon-btn { color: #00b386; background-color: rgba(0, 179, 134, 0.1); }

.name-input {
  font-size: 16px; padding: 4px 8px; border: 1px solid #00b386; border-radius: 4px;
  outline: none; width: 140px; text-align: center; background: transparent; color: inherit;
}

/* 签名部分 */
.signature-display-wrapper { display: flex; justify-content: flex-end; align-items: center; width: 100%; }
.signature-clickable {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 2px 6px; border-radius: 6px; transition: background-color 0.2s;
}
.signature-clickable:hover { background-color: var(--ac-hover); }
.signature-clickable:hover .edit-icon-btn { color: #00b386; }

.signature-text {
  font-size: 14px; max-width: 200px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--ac-text-sub);
}

.signature-input {
  font-size: 14px; padding: 4px 8px; border: 1px solid #00b386; border-radius: 4px;
  outline: none; width: 100%; max-width: 220px; text-align: right; background: transparent; color: inherit;
}

/* ===========================================================================
   2. 模态框通用样式
   =========================================================================== */
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.6); display: flex; justify-content: center; align-items: center; z-index: 1000;
  backdrop-filter: blur(2px);
}
.pwd-overlay { z-index: 1010; }

.modal-content {
  padding: 2rem; border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); width: 90%; max-width: 420px; position: relative;
  display: flex; flex-direction: column;

  /* 应用变量 */
  background: var(--ac-bg);
  color: var(--ac-text);
}
.pwd-content { max-width: 380px; padding: 1.5rem; }

.modal-header, .pwd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.modal-header {
  margin-bottom: 1.25rem; padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--ac-border);
}

.modal-title, .pwd-header h3 { font-size: 18px; font-weight: 600; margin: 0; }
.close-button {
  background: none; border: none; font-size: 28px; cursor: pointer; padding: 0; line-height: 1;
  color: var(--ac-text-sub);
}
.close-button:hover { color: var(--ac-text); }

.modal-body { display: flex; flex-direction: column; gap: 1rem; }

.info-item { display: flex; justify-content: space-between; align-items: center; font-size: 14px; min-height: 28px; }

.info-label {
  font-weight: 500; white-space: nowrap; flex-shrink: 0; margin-right: 12px;
  color: var(--ac-text-sub);
}

.info-value {
  font-weight: 500;
  padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 14px; text-align: right; min-width: 80px;

  /* 应用变量 */
  background-color: var(--ac-block-bg);
  color: var(--ac-block-text);
}

.storage-section {
  padding-bottom: 0.5rem;
  border-bottom: 1px dashed var(--ac-border);
}
.info-value-simple {
  font-weight: 600; font-size: 13px;
  color: var(--ac-text);
}

.progress-track {
  width: 100%; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 4px;
  background-color: var(--ac-block-bg);
}
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
  border-radius: 6px; padding: 0.8rem; font-size: 15px; font-weight: 500;
  cursor: pointer; transition: background-color 0.2s;

  /* 应用变量 */
  background-color: var(--ac-btn-grey-bg);
  color: var(--ac-btn-grey-text);
  border: 1px solid var(--ac-btn-grey-border);
}
.btn-grey:hover {
  background-color: var(--ac-hover);
}

.pwd-tip { font-size: 13px; margin-bottom: 1.5rem; line-height: 1.5; color: var(--ac-text-sub); }
.pwd-form { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }

.pwd-input {
  width: 100%; padding: 0.8rem; border-radius: 6px; font-size: 15px; outline: none; box-sizing: border-box;

  /* 应用变量 */
  background: var(--ac-input-bg);
  border: 1px solid var(--ac-input-border);
  color: var(--ac-text);
}
.pwd-input:focus { border-color: #00b386; }

.pwd-actions { display: flex; justify-content: space-between; align-items: center; }
.pwd-btns { display: flex; gap: 2rem; justify-content: center; }
.pwd-btn-item { width: 90px; padding: 0.6rem 0; }
.forgot-link { font-size: 13px; color: #4a90e2; cursor: pointer; }
:global(.dark) .forgot-link { color: #64b5f6; } /* 蓝色微调，可保留 global */
.link-btn { background: none; border: none; color: #00b386; cursor: pointer; font-size: 14px; padding: 0; text-decoration: underline; }
:global(.dark) .link-btn { color: #2dd4bf; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
