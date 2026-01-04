<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../utils/supabaseClient'

// [修改 1] 定义 Props 和 Emits，使其能被父组件控制
const props = defineProps<{
  modalMode?: boolean // 是否以弹窗/组件模式运行
  themeColor?: string
}>()
const emit = defineEmits(['close'])
const currentThemeColor = computed(() => props.themeColor || '#6366f1')
const route = useRoute()
const router = useRouter()

// [修改 2] 兼容逻辑：如果是 modalMode，默认视为来自 auth
const isFromAuth = computed(() => props.modalMode || route.query.from === 'auth')

// 初始化下拉菜单：组件模式下默认空，路由模式下保持原逻辑
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

// [修改 3] 返回逻辑：如果是组件模式，触发 close 事件；否则走路由
function goBack() {
  if (props.modalMode) {
    emit('close')
  }
  else {
    // 只有路由模式下才尝试 back 或 push
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
      goBack() // 复用 goBack 逻辑
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
      '--theme-title-bg': `color-mix(in srgb, ${currentThemeColor}, white 85%)`, // 标题栏淡色背景
    }"
    @click.self="modalMode ? goBack() : null"
  >
    <div class="scroll-wrapper" @click.self="modalMode ? goBack() : null">
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

            <button class="btn-back" type="button" @click="goBack">
              {{ t('auth.return') }}
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
/* 保持原有样式，新增 .is-modal 样式 */

/* ... 原有 .page-safearea 样式 ... */
.page-safearea {
  height: 100vh;
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
  box-sizing: border-box;
  /* 确保有背景色 */
  background: var(--app-bg, #fff);
}

/* [修改] 模态框模式下的关键样式：强制最高层级覆盖 */
/* =========================================
   [修改] 模态框模式专用样式：半透明悬浮效果
   ========================================= */

/* 1. 外层容器：变成全屏半透明遮罩 */
.page-safearea.is-modal {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100dvh !important;
  z-index: 5000 !important;

  /* 关键：背景半透明黑色，实现“悬浮”感 */
  background-color: rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(2px); /* 可选：给背景加点毛玻璃 */

  /* 布局：让内部的内容居中 */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;

  margin: 0 !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

/* 2. 内部滚动容器：限制大小，防止撑满全屏 */
.page-safearea.is-modal .scroll-wrapper {
  width: 100%;
  height: 100%;
  /* 使用 Flex 让 form-container 居中 */
  display: flex;
  align-items: center;
  justify-content: center;
  /* 点击空白处如果需要关闭，需配合 JS，这里先单纯居中 */
  pointer-events: none; /* 让点击穿透到 content */
}

/* 3. 表单卡片：变成真正的“弹窗卡片” */
.page-safearea.is-modal .form-container {
  pointer-events: auto; /* 恢复点击 */
  width: 90% !important;
  max-width: 600px !important;

  /* 限制高度，内容过多时内部滚动 */
  max-height: 85vh !important;
  overflow-y: auto !important;

  margin: 0 !important; /* 去掉原本的 margin */

  /* 加上阴影，增强悬浮感 */
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3) !important;
  border-radius: 16px !important;

  /* 动画优化：如果想要进场动画，可以配合 Transition */
}

/* 4. 在弹窗模式下，调整一下顶部的返回按钮和标题样式 */
.page-safearea.is-modal .breadcrumb {
  margin-top: 0;
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .page-safearea.is-modal {
    background-color: rgba(0, 0, 0, 0.7) !important;
  }
  .page-safearea.is-modal .form-container {
    background: var(--main-bg-c);
    border: 1px solid #333;
  }
}

/* 移动端适配：手机上可能还是全屏体验比较好，或者留一点边距 */
@media (max-width: 600px) {
  .page-safearea.is-modal .form-container {
    width: 94% !important;
    max-height: 90vh !important;
    padding: 1.5rem !important;
  }
}

/* ... 以下保持原有样式不变 ... */
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
/* ... (省略其他未修改的样式) ... */
.breadcrumb {
  text-align: center;
  font-weight: bold;
  font-size: 16px !important;
  margin-bottom: 1rem;
  background: var(--theme-title-bg);
  color: var(--theme-color);
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
.button-row {
  display: grid;
  grid-template-columns: 5fr 1fr;
  gap: 0.75rem;
  margin-top: 1rem;
}
button {
  background-color: var(--theme-color);
  border: none;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.3s;
  padding: 0.8rem;
  font-size: 13px !important;
}
button[disabled] { opacity: 0.6; cursor: not-allowed; }
button:hover:not([disabled]) { background-color: var(--theme-hover); }
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
.btn-back:hover { background: #e9e9e9; }
.success-message, .error-message {
  margin-top: 1rem;
  font-weight: bold;
  text-align: center;
}
.success-message { color: #008800; }
.error-message { color: red; }
@media (max-width: 600px) {
  .form-container { padding: 1.25rem; font-size: 15px !important; }
  .breadcrumb { font-size: 18px !important; }
  select, textarea, input, button, .btn-back { font-size: 16px !important; }
}
@media (prefers-color-scheme: dark) {
  .form-container { background: var(--main-bg-c); color: #eee; box-shadow: 0 0 8px rgba(255, 255, 255, 0.1); }
  input, textarea, select { background: #2a2a2a; color: #eee; border: 1px solid #555; }
  .breadcrumb { background: color-mix(in srgb, var(--theme-color), black 60%); color: color-mix(in srgb, var(--theme-color), white 80%); }
  .tip { color: #ccc; }
  button { background-color: var(--theme-color); }
  button:hover:not([disabled]) { background-color: color-mix(in srgb, var(--theme-color), white 20%); }
  .btn-back { background: #2a2a2a; color: #eee; border-color: #555; }
  .btn-back:hover { background: #333; }
}
</style>
