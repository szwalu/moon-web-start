<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { CheckCircle2 } from 'lucide-vue-next'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  show: { type: Boolean, required: true },
  allowClose: { type: Boolean, default: false },
  // 接收激活状态
  activated: { type: Boolean, default: false },
  // ✅ [新增] 接收剩余天数，默认为 7
  daysRemaining: { type: Number, default: 7 },
})

const emit = defineEmits(['success', 'close'])

const inviteCode = ref('')
const loading = ref(false)
const messageHook = useMessage()
const { t } = useI18n()

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
      messageHook.success(t('auth.activation.success_message'))
      emit('success')
    }
    else {
      throw new Error(data?.message || t('auth.activation.verify_failed'))
    }
  }
  catch (e: any) {
    console.error(e)
    messageHook.error(e.message || t('auth.activation.verify_failed'))
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
    window.location.href = '/auth'
  }
}
</script>

<template>
  <div v-if="show" class="activation-overlay">
    <div class="activation-box">
      <div v-if="activated" class="activated-content">
        <CheckCircle2 :size="64" class="success-icon" />
        <h2>{{ t('notes.activation_success_title') }}</h2>
        <p class="desc">{{ t('notes.activation_success_desc') }}</p>
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
