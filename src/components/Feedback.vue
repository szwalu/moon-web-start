<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

// [修改 1] 引入 X 图标
import { X } from 'lucide-vue-next'
import { supabase } from '../utils/supabaseClient'

// 定义 Props 和 Emits
const props = defineProps<{
  modalMode?: boolean
  themeColor?: string
}>()
const emit = defineEmits(['close'])
const currentThemeColor = computed(() => props.themeColor || '#6366f1')
const route = useRoute()
const router = useRouter()

const isFromAuth = computed(() => props.modalMode || route.query.from === 'auth')

const selectedType = ref(route.query.from === 'register' ? 'applyinvitecode' : '')

const backTarget = computed(() => {
  if (isFromAuth.value || selectedType.value === 'applyinvitecode')
    return '/auth'
  return '/'
})

const { t } = useI18n()
const form = ref<HTMLFormElement | null>(null)
const successMessage = ref('')
const errorMessage = ref('')
const loading = ref(false)

const isEmailRequired = computed(() => {
  return !isFromAuth.value && selectedType.value === 'applyinvitecode'
})

// ===== 锁定 body 滚动 =====
const originalBodyOverflow = ref<string | null>(null)

onMounted(() => {
  originalBodyOverflow.value = document.body.style.overflow || ''
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  if (originalBodyOverflow.value !== null)
    document.body.style.overflow = originalBodyOverflow.value
})

// 返回/关闭逻辑
function goBack() {
  if (props.modalMode) {
    emit('close')
  }
  else {
    if (backTarget.value === '/' && window.history.state?.back)
      router.back()
    else
      router.push(backTarget.value)
  }
}

async function handleSubmit() {
  if (!form.value)
    return

  loading.value = true
  successMessage.value = ''
  errorMessage.value = ''

  try {
    const formData = new FormData(form.value)
    const type = isFromAuth.value
      ? 'feedback'
      : (formData.get('type') as string)

    const message = formData.get('message') as string
    const email = (formData.get('email') as string)?.trim()

    if (isEmailRequired.value && !email)
      throw new Error('请填写联系邮箱')

    const { error } = await supabase.from('feedbacks').insert([{ type, message, email }])
    if (error)
      throw error

    const baseURL = location.hostname === 'localhost'
      ? 'https://reikfzpaefbbokwwocdr.functions.supabase.co'
      : '/functions/v1'

    const response = await fetch(`${baseURL}/send-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message, email }),
    })

    if (!response.ok)
      throw new Error('邮件发送失败')

    successMessage.value = `✅ ${t('form.success')}`
    form.value.reset()
    selectedType.value = ''

    setTimeout(() => {
      goBack()
    }, 2000)
  }
  catch (err) {
    console.error(err)
    errorMessage.value = err instanceof Error && err.message !== '邮件发送失败'
      ? `❌ ${err.message}`
      : `❌ ${t('form.error')}`
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="page-safearea"
    :class="{ 'is-modal': modalMode }"
    :style="{
      '--theme-color': currentThemeColor,
      '--theme-hover': `color-mix(in srgb, ${currentThemeColor}, black 10%)`,
      '--theme-light': `color-mix(in srgb, ${currentThemeColor}, white 90%)`,
      '--theme-title-bg': `color-mix(in srgb, ${currentThemeColor}, white 85%)`,
    }"
    @click.self="modalMode ? goBack() : null"
  >
    <div class="scroll-wrapper" @click.self="modalMode ? goBack() : null">
      <div class="form-container">
        <div class="breadcrumb">
          <span class="breadcrumb-text">
            {{ t(isFromAuth ? 'form.title' : 'form.breadcrumb') }}
          </span>

          <button class="header-close-btn" type="button" @click="goBack">
            <X :size="20" />
          </button>
        </div>

        <p class="tip">
          {{ t(isFromAuth ? 'form.tipauth' : 'form.tip') }}
        </p>

        <form ref="form" class="form-body" @submit.prevent="handleSubmit">
          <label v-if="!isFromAuth">
            <span class="required">*</span>{{ t('form.selectLabel') }}
            <select v-model="selectedType" name="type" required>
              <option value="" disabled selected hidden>
                {{ t('form.selectPlaceholder') }}
              </option>
              <option value="apply-site">{{ t('form.options.applySite') }}</option>
              <option value="apply-link">{{ t('form.options.applyLink') }}</option>
              <option value="feedback">{{ t('form.options.feedback') }}</option>
              <option value="applyinvitecode">
                {{ t('form.options.applyinvitecode') }}
              </option>
            </select>
          </label>

          <label>
            <span class="required">*</span>{{ t('form.messageLabel') }}
            <textarea name="message" rows="8" required />
          </label>

          <label>
            <span v-if="isEmailRequired" class="required">*</span>
            {{ t('form.emailLabel') }}
            <span v-if="!isEmailRequired">（{{ t('form.optional') }}）</span>

            <input type="email" name="email" :required="isEmailRequired">
          </label>

          <div class="button-row">
            <button type="submit" :disabled="loading" class="btn-submit-full">
              {{ loading ? '提交中...' : t('form.submit') }}
            </button>
          </div>

          <p v-if="successMessage" class="success-message">
            {{ successMessage }}
          </p>
          <p v-if="errorMessage" class="error-message">
            {{ errorMessage }}
          </p>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Page & Modal Layout ===== */
.page-safearea {
  height: 100vh;
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
  box-sizing: border-box;
  background: var(--app-bg, #fff);
}

.page-safearea.is-modal {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100dvh !important;
  z-index: 5000 !important;
  background-color: rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(2px);
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

.page-safearea.is-modal .scroll-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.page-safearea.is-modal .form-container {
  pointer-events: auto;
  width: 90% !important;
  max-width: 600px !important;
  max-height: 85vh !important;
  overflow-y: auto !important;
  margin: 0 !important;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3) !important;
  border-radius: 16px !important;
}

.scroll-wrapper {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.form-container {
  max-width: 640px;
  margin: 2rem auto;
  background: white;
  padding: 2rem;
  border-radius: 10px;
  font-size: 13px !important;
  line-height: 1.6;
  font-family: system-ui, sans-serif;
  color: #333;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.05);
}

/* ===== [修改 4] Breadcrumb / Title Bar 样式 ===== */
.breadcrumb {
  position: relative; /* 为了让绝对定位的关闭按钮参考 */
  display: flex;
  align-items: center;
  justify-content: center; /* 文字居中 */
  font-weight: bold;
  font-size: 16px !important;
  margin-bottom: 1rem;
  background: var(--theme-title-bg);
  color: var(--theme-color);
  padding: 0.5rem;
  border-radius: 8px;
  min-height: 24px;
}

.breadcrumb-text {
  /* 确保文字在中间 */
  z-index: 1;
}

/* 右上角关闭按钮样式 */
.header-close-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  padding: 4px;
  color: var(--theme-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s;
  z-index: 2;
}

.header-close-btn:hover {
  background-color: rgba(0,0,0,0.05);
}

/* ===== Form Elements ===== */
.tip {
  margin-bottom: 2rem;
  color: #555;
  font-size: 14px !important;
}
label {
  display: block;
  margin-bottom: 1.2rem;
  font-size: 14px !important;
}
select, textarea, input {
  font-size: 16px !important;
  font-family: inherit;
  width: 100%;
  padding: 0.8rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-sizing: border-box;
}
textarea {
  min-height: 140px;
  resize: vertical;
}
.required { color: red; margin-right: 4px; }

/* ===== [修改 5] Button Row 样式 ===== */
.button-row {
  display: block; /* 取消 Grid，让按钮自然占满 */
  margin-top: 1rem;
}

.btn-submit-full {
  width: 100%; /* 强制占满整行 */
  background-color: var(--theme-color);
  border: none;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.3s;
  padding: 0.8rem;
  font-size: 13px !important;
}

.btn-submit-full:hover:not([disabled]) {
  background-color: var(--theme-hover);
}

.btn-submit-full[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

.success-message, .error-message {
  margin-top: 1rem;
  font-weight: bold;
  text-align: center;
}
.success-message { color: #008800; }
.error-message { color: red; }

/* ===== Responsive & Dark Mode ===== */
@media (max-width: 600px) {
  .page-safearea.is-modal .form-container {
    width: 94% !important;
    max-height: 90vh !important;
    padding: 1.5rem !important;
  }
  .form-container { padding: 1.25rem; font-size: 15px !important; }
  .breadcrumb { font-size: 18px !important; }
  select, textarea, input, button { font-size: 16px !important; }
}

@media (prefers-color-scheme: dark) {
  .page-safearea.is-modal {
    background-color: rgba(0, 0, 0, 0.7) !important;
  }
  .page-safearea.is-modal .form-container {
    background: var(--main-bg-c);
    border: 1px solid #333;
  }
  .form-container { background: var(--main-bg-c); color: #eee; box-shadow: 0 0 8px rgba(255, 255, 255, 0.1); }
  input, textarea, select { background: #2a2a2a; color: #eee; border: 1px solid #555; }
  .breadcrumb { background: color-mix(in srgb, var(--theme-color), black 60%); color: color-mix(in srgb, var(--theme-color), white 80%); }
  .tip { color: #ccc; }
  .btn-submit-full { background-color: var(--theme-color); }
  .btn-submit-full:hover:not([disabled]) { background-color: color-mix(in srgb, var(--theme-color), white 20%); }

  /* 适配深色模式下的关闭按钮 */
  .header-close-btn { color: color-mix(in srgb, var(--theme-color), white 80%); }
  .header-close-btn:hover { background-color: rgba(255,255,255,0.1); }
}
</style>
