<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { supabase } from '../utils/supabaseClient'

const route = useRoute()
const isFromAuth = computed(() => route.query.from === 'auth')

const backTarget = computed(() => {
  // ?from=auth 时，返回 /auth，否则返回首页
  return isFromAuth.value ? '/auth' : '/'
})

const { t } = useI18n()
const form = ref<HTMLFormElement | null>(null)
const successMessage = ref('')
const errorMessage = ref('')
const loading = ref(false)

// ===== 锁定 body 滚动，改用内部滚动容器（改善 iOS 键盘滚动行为） =====
const originalBodyOverflow = ref<string | null>(null)

onMounted(() => {
  originalBodyOverflow.value = document.body.style.overflow || ''
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  if (originalBodyOverflow.value !== null)
    document.body.style.overflow = originalBodyOverflow.value
})

async function handleSubmit() {
  if (!form.value)
    return

  loading.value = true
  successMessage.value = ''
  errorMessage.value = ''

  try {
    const formData = new FormData(form.value)

    // 从 /auth 来时强制视为 feedback，否则按下拉选择
    const type = isFromAuth.value
      ? 'feedback'
      : (formData.get('type') as string)

    const message = formData.get('message') as string
    const email = (formData.get('email') as string)?.trim()

    // 邮箱永远可选，不做非空校验
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

    setTimeout(() => {
      // 提交完成后：和返回按钮逻辑一致
      window.location.href = backTarget.value
    }, 2000)
  }
  catch (err) {
    console.error(err)
    errorMessage.value = `❌ ${t('form.error')}`
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page-safearea">
    <div class="scroll-wrapper">
      <div class="form-container">
        <div class="breadcrumb">
          {{ t(isFromAuth ? 'form.title' : 'form.breadcrumb') }}
        </div>
        <p class="tip">
          {{ t(isFromAuth ? 'form.tipauth' : 'form.tip') }}
        </p>

        <form ref="form" class="form-body" @submit.prevent="handleSubmit">
          <!-- 仅非 /auth 来源时显示选择类型 -->
          <label v-if="!isFromAuth">
            <span class="required">*</span>{{ t('form.selectLabel') }}
            <select name="type" required>
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
            {{ t('form.emailLabel') }}
            <span>（{{ t('form.optional') }}）</span>
            <input type="email" name="email">
          </label>

          <!-- 提交与返回按钮：5:1 -->
          <div class="button-row">
            <button type="submit" :disabled="loading">
              {{ loading ? '提交中...' : t('form.submit') }}
            </button>

            <RouterLink :to="backTarget" class="btn-back" role="button" aria-label="返回">
              {{ t('auth.return') }}
            </RouterLink>
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
/* 顶部安全区容器：固定视口高度，内部滚动 */
.page-safearea {
  height: 100vh;
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
  box-sizing: border-box;
}

/* 内部滚动容器：真正滚动的是它，而不是 body */
.scroll-wrapper {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ============== 原样式保持 ============== */
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

.breadcrumb {
  text-align: center;
  font-weight: bold;
  font-size: 16px !important;
  margin-bottom: 1rem;
  background: #fff7cc;
  padding: 0.5rem;
  border-radius: 8px;
}

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

select,
textarea,
input {
  font-size: 16px !important; /* iOS 防止放大 */
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

.required {
  color: red;
  margin-right: 4px;
}

/* 按钮行：5:1 */
.button-row {
  display: grid;
  grid-template-columns: 5fr 1fr;
  gap: 0.75rem;
  margin-top: 1rem;
}

button {
  background-color: #00b386;
  border: none;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.3s;
  padding: 0.8rem;
  font-size: 13px !important;
}

button[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

button:hover:not([disabled]) {
  background-color: #009f77;
}

/* 返回按钮视觉为次级 */
.btn-back {
  display: inline-block;
  text-align: center;
  padding: 0.8rem;
  border-radius: 6px;
  text-decoration: none;
  font-size: 13px !important;
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
}

.btn-back:hover {
  background: #e9e9e9;
}

.success-message,
.error-message {
  margin-top: 1rem;
  font-weight: bold;
  text-align: center;
}

.success-message {
  color: #008800;
}

.error-message {
  color: red;
}

@media (max-width: 600px) {
  .form-container {
    padding: 1.25rem;
    font-size: 15px !important;
  }

  .breadcrumb {
    font-size: 18px !important;
  }

  select,
  textarea,
  input {
    font-size: 16px !important; /* 保持 16，避免 iOS 再放大 */
  }

  button,
  .btn-back {
    font-size: 15px !important;
  }
}

@media (prefers-color-scheme: dark) {
  .form-container {
    background: #1e1e1e;
    color: #eee;
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
  }

  input,
  textarea,
  select {
    background: #2a2a2a;
    color: #eee;
    border: 1px solid #555;
  }

  .breadcrumb {
    background: #333;
    color: #ffec99;
  }

  .tip {
    color: #ccc;
  }

  button {
    background-color: #009f77;
  }

  button:hover:not([disabled]) {
    background-color: #00b386;
  }

  .btn-back {
    background: #2a2a2a;
    color: #eee;
    border-color: #555;
  }

  .btn-back:hover {
    background: #333;
  }
}
</style>
