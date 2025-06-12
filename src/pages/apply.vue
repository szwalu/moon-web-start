<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '../utils/supabaseClient'

const { t } = useI18n()
const form = ref<HTMLFormElement | null>(null)
const successMessage = ref('')
const errorMessage = ref('')
const selectError = ref('')
const loading = ref(false)

async function handleSubmit() {
  if (!form.value)
    return
  successMessage.value = ''
  errorMessage.value = ''
  selectError.value = ''
  loading.value = true

  const formData = new FormData(form.value)
  const type = formData.get('type') as string
  const message = formData.get('message') as string
  const email = formData.get('email') as string

  if (!type) {
    selectError.value = t('form.selectError')
    loading.value = false
    return
  }

  try {
    const { error } = await supabase.from('feedbacks').insert([{ type, message, email }])
    if (error)
      throw error

    const response = await fetch('https://reikfzpaefbbokwwocdr.functions.supabase.co/send-mail', {
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
</script>

<template>
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
        </select>
      </label>
      <p v-if="selectError" class="error-message">{{ selectError }}</p>

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
    </form>
  </div>
</template>

<style scoped>
/* ✅ 添加错误提示样式 */
.error-message {
  color: red;
  font-size: 13px;
  margin-top: -0.5rem;
  margin-bottom: 1rem;
}

.form-container {
  max-width: 640px;
  margin: 2rem auto;
  background: white;
  padding: 2rem;
  border-radius: 10px;
  font-size: 14px !important;
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
  font-size: 14px !important; /* 这是桌面端的大小 */
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

.success-message {
  margin-top: 1rem;
  font-weight: bold;
  text-align: center;
  color: #008800;
}

/* 📱 移动端适配 */
@media (max-width: 600px) {
  .form-container {
    padding: 1.25rem;
    font-size: 15px !important;
  }

  .breadcrumb {
    font-size: 18px !important;
  }

  .tip {
    font-size: 15px !important;
  }

  select,
  textarea,
  input,
  button {
    font-size: 15px !important;
  }
}

/* 🌙 暗色模式适配 */
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
