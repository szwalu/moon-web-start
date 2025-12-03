<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { supabase } from '../utils/supabaseClient'

const route = useRoute()
const isFromAuth = computed(() => route.query.from === 'auth')

// [修改 1] 初始化下拉菜单选中值：如果来自 register，默认选中 'applyinvitecode'
const selectedType = ref(route.query.from === 'register' ? 'applyinvitecode' : '')

// [修改 2] 返回链接逻辑更新
// 如果来自 auth 页面，或者当前选择了“申请邀请码”，都返回 /auth；否则返回首页
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

// [修改 3] 计算邮箱是否必填
// 逻辑：如果不是从Auth进入 且 选择了'applyinvitecode'，则必须填写邮箱
const isEmailRequired = computed(() => {
  return !isFromAuth.value && selectedType.value === 'applyinvitecode'
})

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

    // 逻辑校验
    // 如果前端 required 属性被绕过，这里做二次拦截
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
    // 重置 selectedType
    selectedType.value = ''

    setTimeout(() => {
      // 提交完成后：和返回按钮逻辑一致
      window.location.href = backTarget.value
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
/* 样式保持不变 */
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
