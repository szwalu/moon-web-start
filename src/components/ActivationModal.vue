<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/utils/supabaseClient'

defineProps({
  show: { type: Boolean, required: true },
})

const emit = defineEmits(['success'])
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

async function handleLogout() {
  await supabase.auth.signOut()
  window.location.href = '/auth'
}
</script>

<template>
  <div v-if="show" class="activation-overlay">
    <div class="activation-box">
      <h2>{{ t('auth.activation.title') }}</h2>

      <p class="desc">{{ t('auth.activation.description') }}</p>

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
          <a class="link-btn" @click="handleLogout">{{ t('auth.logout') }}</a>
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
  --act-bg: white;               /* 卡片背景 */
  --act-title: #00b386;          /* 标题颜色 (保持品牌色) */
  --act-desc: #666666;           /* 描述文字 */

  --act-input-bg: #ffffff;       /* 输入框背景 */
  --act-input-border: #eeeeee;   /* 输入框边框 */
  --act-input-text: #333333;     /* 输入框文字 */

  --act-divider: #dddddd;        /* 分割线 */
  --act-link: #888888;           /* 链接默认颜色 */
  --act-link-hover: #00b386;     /* 链接悬停颜色 */
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
}

/* ===========================================================================
   📐 布局与样式
   =========================================================================== */
.activation-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.85); /* 遮罩层保持深色半透明即可，无需变色 */
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

  /* 应用变量 */
  background: var(--act-bg);
  transition: background-color 0.3s;
}

h2 {
  margin-bottom: 1rem;
  color: var(--act-title);
}

.desc {
  margin-bottom: 2rem;
  line-height: 1.6;
  white-space: pre-line;

  /* 应用变量 */
  color: var(--act-desc);
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

  /* 应用变量 */
  background: var(--act-input-bg);
  border: 2px solid var(--act-input-border);
  color: var(--act-input-text);
}
.code-input:focus {
  border-color: #00b386;
}

.btn-activate {
  width: 100%;
  padding: 1rem;
  background: #00b386;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  font-weight: bold;
}
.btn-activate:disabled { opacity: 0.7; }

.link-btn {
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;

  /* 应用变量 */
  color: var(--act-link);
}
.link-btn:hover {
  text-decoration: underline;
  color: var(--act-link-hover);
}

/* 分割线样式 */
.divider {
  margin: 0 8px;
  color: var(--act-divider);
  transition: color 0.3s;
}
</style>
