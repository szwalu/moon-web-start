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
          <span style="margin: 0 8px; color: #ddd;">|</span>
          <a class="link-btn" @click="handleLogout">{{ t('auth.logout') }}</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  background: white;
  padding: 2.5rem;
  border-radius: 16px;
  width: 90%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
}

.dark .activation-box {
    background: #1e1e1e;
    color: #fff;
}

h2 {
    margin-bottom: 1rem;
    color: #00b386;
}

.desc {
    color: #666;
    margin-bottom: 2rem;
    line-height: 1.6;
    white-space: pre-line; /* 识别换行符 */
}
.dark .desc { color: #aaa; }

.code-input {
    width: 100%;
    padding: 1rem;
    font-size: 16px;
    border: 2px solid #eee;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    outline: none;
    text-align: center;
    box-sizing: border-box;
}
.code-input:focus { border-color: #00b386; }
.dark .code-input {
    background: #2a2a2a;
    border-color: #444;
    color: white;
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
    color: #888;
    font-size: 13px;
    cursor: pointer;
    text-decoration: none;
}
.link-btn:hover { text-decoration: underline; color: #00b386; }
</style>
