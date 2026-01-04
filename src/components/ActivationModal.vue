<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { CheckCircle2 } from 'lucide-vue-next'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  show: { type: Boolean, required: true },
  allowClose: { type: Boolean, default: false },
  // 接收激活状态 (来自父组件/Supabase)
  activated: { type: Boolean, default: false },
  // 接收剩余天数，默认为 7
  daysRemaining: { type: Number, default: 7 },
  themeColor: { type: String, default: '#6366f1' },
})

const emit = defineEmits(['success', 'close'])

const inviteCode = ref('')
const loading = ref(false)
// ✅ [新增] 标记：是否是“刚刚”在当前会话中完成的激活
const justActivated = ref(false)

const messageHook = useMessage()
const { t } = useI18n()
const STORAGE_KEY = 'app_activation_status'

// ✅ [新增] 综合判断激活状态
// 逻辑：优先信赖父组件(在线状态)，其次信赖本地缓存(离线兜底)
const isEffectiveActivated = computed(() => {
  // 1. 如果父组件明确说是 true (在线验证通过)，那就一定是 true
  if (props.activated) {
    if (typeof window !== 'undefined')
      localStorage.setItem(STORAGE_KEY, 'true')
    return true
  }
  // 2. 如果父组件说是 false (可能是离线/过期)，检查本地缓存
  if (typeof window !== 'undefined')
    return localStorage.getItem(STORAGE_KEY) === 'true'

  return false
})

// ✅ [新增] 决定是否渲染弹窗内容
// 逻辑：如果弹窗要求显示(show=true)，但我们检测到是“老激活状态”（非刚刚激活），
// 则暂时隐藏内容，等待 watch 中的 emit('close') 生效，防止界面闪烁。
const shouldRender = computed(() => {
  if (!props.show)
    return false

  // 如果已激活，但不是刚刚激活的，说明是缓存/离线自动登录，不应该渲染界面
  if (isEffectiveActivated.value && !justActivated.value)
    return false

  return true
})

// ✅ [新增] 自动关闭监听器
// 监听 props.show 的变化（包括组件刚加载时的初始值）
watch(() => props.show, (isShow) => {
  if (isShow) {
    // 如果需要显示，且已经是激活状态，且不是刚刚激活的
    if (isEffectiveActivated.value && !justActivated.value) {
      // 说明是离线/缓存用户，直接静默关闭，不打扰用户
      emit('close')
    }
  }
}, { immediate: true })

async function handleActivate() {
  if (!inviteCode.value)
    return

  loading.value = true
  try {
    const { data, error } = await supabase.rpc('verify_invite_code', {
      code_input: inviteCode.value,
    })

    if (error)
      throw error

    if (data && data.success) {
      // ✅ [新增] 激活成功，写入缓存并标记为“刚刚激活”
      localStorage.setItem(STORAGE_KEY, 'true')
      justActivated.value = true

      messageHook.success(t('auth.activation.success_message'))
      emit('success')
    }
    else {
      // 国际化处理逻辑
      const errorCode = data?.message
      const i18nKey = `auth.activation.errors.${errorCode}`
      let errorMsg = ''

      if (!errorCode || errorCode.includes(' ')) {
        errorMsg = errorCode || t('auth.activation.errors.default')
      }
      else {
        errorMsg = t(i18nKey)
        if (errorMsg === i18nKey)
          errorMsg = t('auth.activation.errors.default')
      }

      throw new Error(errorMsg)
    }
  }
  catch (e: any) {
    console.error(e)
    messageHook.error(e.message)
  }
  finally {
    loading.value = false
  }
}

async function handleSecondaryAction() {
  if (props.allowClose) {
    emit('close')
  }
  else {
    await supabase.auth.signOut()
    // 登出时清除本地激活缓存，防止切号异常
    localStorage.removeItem(STORAGE_KEY)
    window.location.href = '/auth'
  }
}

// 挂载时同步一次状态（如果在线且已激活）
onMounted(() => {
  if (props.activated)
    localStorage.setItem(STORAGE_KEY, 'true')
})
</script>

<template>
  <div
    v-if="show && shouldRender"
    class="activation-overlay"
    :style="{
      '--act-title': props.themeColor,
      '--act-success': props.themeColor,
      '--act-btn-bg': props.themeColor,
      '--act-link-hover': props.themeColor,
    }"
  >
    <div class="activation-box">
      <div v-if="justActivated" class="activated-content">
        <CheckCircle2 :size="64" class="success-icon" />
        <h2>{{ t('notes.activation_success_message') }}</h2>
        <button class="btn-activate" @click="$emit('close')">
          {{ t('common.close') }}
        </button>
      </div>

      <div v-else>
        <h2>{{ t('auth.activation.title') }}</h2>

        <i18n-t
          keypath="auth.activation.description"
          tag="p"
          class="desc"
        >
          <template #days>
            <span class="highlight-days">{{ daysRemaining }}</span>
          </template>
        </i18n-t>

        <input
          v-model="inviteCode"
          type="text"
          :placeholder="t('auth.invite_code_placeholder')"
          class="code-input"
        >

        <div class="actions">
          <button class="btn-activate" :disabled="loading" @click="handleActivate">
            {{ loading ? t('auth.activation.verifying') : t('auth.activation.activate_button') }}
          </button>

          <div style="margin-top: 1rem;">
            <a class="link-btn" href="/apply?from=register" target="_blank">{{ t('auth.activation.apply_link') }}</a>
            <span class="divider">|</span>

            <a class="link-btn" @click="handleSecondaryAction">
              {{ allowClose ? (t('auth.return') || '暂不激活') : t('auth.logout') }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===========================================================================
   🎨 激活弹窗主题变量
   =========================================================================== */
.activation-overlay {
  /* --- ☀️ 默认浅色 --- */
  --act-bg: white;
  --act-title: #6366f1;          /* 🟣 改为紫色 (Indigo-500) */
  --act-desc: #666666;
  --act-input-bg: #ffffff;
  --act-input-border: #eeeeee;
  --act-input-text: #333333;
  --act-divider: #dddddd;
  --act-link: #888888;
  --act-link-hover: #6366f1;     /* 🟣 链接悬停也改为紫色 */
  --act-success: #6366f1;        /* 🟣 成功图标改为紫色 */
  --act-btn-bg: #6366f1;         /* 🟣 按钮背景改为紫色 */
  --act-btn-text: white;
}

/* 🌑 系统深色模式 */
@media (prefers-color-scheme: dark) {
  .activation-overlay {
    --act-bg: #1e1e1e;
    --act-desc: #aaaaaa;
    --act-input-bg: #2a2a2a;
    --act-input-border: #444444;
    --act-input-text: #ffffff;
    --act-divider: #444444;
    --act-link: #aaaaaa;
    --act-title: #818cf8;        /* 🟣 深色模式下的亮紫色 (Indigo-400) */
    --act-link-hover: #818cf8;
    --act-success: #818cf8;
    --act-btn-bg: #818cf8;
    --act-btn-text: #1e1e1e;     /* 深色模式按钮文字用深色 */
  }
}

/* 🌑 手动 .dark 类 */
:global(.dark) .activation-overlay {
  --act-bg: #1e1e1e;
  --act-desc: #aaaaaa;
  --act-input-bg: #2a2a2a;
  --act-input-border: #444444;
  --act-input-text: #ffffff;
  --act-divider: #444444;
  --act-link: #aaaaaa;
  --act-title: #818cf8;
  --act-link-hover: #818cf8;
  --act-success: #818cf8;
  --act-btn-bg: #818cf8;
  --act-btn-text: #1e1e1e;
}

/* ===========================================================================
   📐 布局与样式
   =========================================================================== */
.activation-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.85);
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;
  backdrop-filter: blur(5px);
}

.activation-box {
  padding: 2.5rem;
  border-radius: 16px;
  width: 90%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  background: var(--act-bg);
  transition: background-color 0.3s;
}

h2 {
  margin-bottom: 1rem;
  color: var(--act-title); /* 应用紫色变量 */
}

.desc {
  margin-bottom: 2rem;
  line-height: 1.6;
  white-space: pre-line;
  color: var(--act-desc);
}

/* ✅ [新增] 倒计时数字高亮样式 */
.highlight-days {
  color: var(--act-title);
  font-weight: bold;
  font-size: 1.2em; /* 稍微大一点 */
  margin: 0 4px;
}

/* 已激活状态的样式 */
.activated-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
}

.success-icon {
  color: var(--act-success); /* 应用紫色变量 */
  margin-bottom: 0.5rem;
}

.code-input {
  width: 100%;
  padding: 1rem;
  font-size: 16px;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  outline: none;
  text-align: center;
  box-sizing: border-box;
  background: var(--act-input-bg);
  border: 2px solid var(--act-input-border);
  color: var(--act-input-text);
}
.code-input:focus {
  border-color: var(--act-title); /* 聚焦边框也用紫色 */
}

.btn-activate {
  width: 100%;
  padding: 1rem;
  background: var(--act-btn-bg); /* 应用紫色变量 */
  color: var(--act-btn-text);
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  font-weight: bold;
  transition: opacity 0.2s;
}
.btn-activate:hover {
  opacity: 0.9;
}
.btn-activate:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.link-btn {
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  color: var(--act-link);
}
.link-btn:hover {
  text-decoration: underline;
  color: var(--act-link-hover);
}

.divider {
  margin: 0 8px;
  color: var(--act-divider);
  transition: color 0.3s;
}
</style>

<style>
.n-message-container {
  z-index: 20000 !important; /* 必须比 ActivationModal 的 9999 大 */
}
</style>
