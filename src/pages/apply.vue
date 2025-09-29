<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '../utils/supabaseClient'

const { t } = useI18n()
const form = ref<HTMLFormElement | null>(null)
const successMessage = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function handleSubmit() {
  if (!form.value)
    return
  loading.value = true
  successMessage.value = ''
  errorMessage.value = ''

  try {
    const formData = new FormData(form.value)
    const type = formData.get('type') as string
    const message = formData.get('message') as string
    const email = formData.get('email') as string

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
      window.location.href = '/'
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

function handleClose() {
  window.location.assign('/')
}
</script>

<template>
  <div class="page-frame">
    <!-- 右上角关闭按钮 -->
    <button class="close-btn" aria-label="Close" @click="handleClose">×</button>

    <div class="form-container">
      <div class="breadcrumb">{{ t('form.breadcrumb') }}</div>
      <p class="tip">{{ t('form.tip') }}</p>

      <form ref="form" class="form-body" @submit.prevent="handleSubmit">
        <label>
          <span class="required">*</span>{{ t('form.selectLabel') }}
          <select name="type" required>
            <option value="" disabled selected hidden>{{ t('form.selectPlaceholder') }}</option>
            <option value="apply-site">{{ t('form.options.applySite') }}</option>
            <option value="apply-link">{{ t('form.options.applyLink') }}</option>
            <option value="feedback">{{ t('form.options.feedback') }}</option>
            <option value="feedback">{{ t('form.options.applyinvitecode') }}</option>
          </select>
        </label>

        <label>
          <span class="required">*</span>{{ t('form.messageLabel') }}
          <textarea name="message" rows="8" required />
        </label>

        <label>
          {{ t('form.emailLabel') }}
          <input type="email" name="email">
        </label>

        <button type="submit" :disabled="loading">
          {{ loading ? '提交中...' : t('form.submit') }}
        </button>

        <p v-if="successMessage" class="success-message">{{ successMessage }}</p>
        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* ================= 安全区容器（解决全屏模式刘海/状态栏侵入） ================= */
.page-frame {
  padding-top: constant(safe-area-inset-top);
  padding-left: constant(safe-area-inset-left);
  padding-right: constant(safe-area-inset-right);
  padding-top: env(safe-area-inset-top);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  position: relative;
  min-height: 100vh;
}

/* 右上角关闭按钮 */
.close-btn {
  position: fixed;
  top: calc(constant(safe-area-inset-top) + 8px);
  top: calc(env(safe-area-inset-top) + 8px);
  right: calc(env(safe-area-inset-right) + 12px);
  z-index: 1000;
  width: 36px;
  height: 36px;
  line-height: 36px;
  text-align: center;
  border: 1px solid rgba(0,0,0,0.15);
  border-radius: 10px;
  background: rgba(255,255,255,0.9);
  color: #333;
  cursor: pointer;
  font-size: 22px;
  backdrop-filter: saturate(180%) blur(12px);
}
@media (prefers-color-scheme: dark) {
  .close-btn {
    background: rgba(30,30,30,0.85);
    color: #eee;
    border-color: rgba(255,255,255,0.2);
  }
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
input,
button {
  font-size: 13px !important;
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

button {
  margin-top: 1rem;
  background-color: #00b386;
  border: none;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.3s;
}

button[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

button:hover:not([disabled]) {
  background-color: #009f77;
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
  input,
  button {
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
}
</style>
