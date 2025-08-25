<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Subscription } from '@supabase/supabase-js'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n()

const newPassword = ref('')
const confirmPassword = ref('')
const message = ref('')
const loading = ref(false)
const sessionReady = ref(false)
let authListener: Subscription | null = null

// 使用 onAuthStateChange 来可靠地处理认证状态
onMounted(() => {
  // 设置监听器
  const { data } = supabase.auth.onAuthStateChange((event, _session) => {
    // 当 Supabase 确认这是一个密码重置流程时，才显示表单
    if (event === 'PASSWORD_RECOVERY')
      sessionReady.value = true
  })
  authListener = data.subscription

  // 添加一个超时检查，以防万一
  setTimeout(() => {
    if (!sessionReady.value)
      message.value = t('auth.invalid_link')
  }, 3000)
})

// 组件卸载时，清理监听器
onUnmounted(() => {
  authListener?.unsubscribe()
})

// 这是修正后的新函数
async function handleReset() {
  if (newPassword.value !== confirmPassword.value) {
    message.value = t('auth.mismatch')
    return
  }

  loading.value = true
  message.value = '' // 先清空消息

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword.value,
    })

    if (error)
      throw error // 如果更新失败，直接抛出错误

    // 密码更新成功后，直接提示并跳转，不再调用 signOut()
    message.value = t('auth.messages.reset_success_redirect')
    setTimeout(() => router.push('/auth'), 2000)
  }
  catch (err: any) {
    // 统一在这里处理所有错误
    message.value = `${t('auth.reset_failed')}：${err.message}`
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="reset-container">
    <h2>{{ $t('auth.reset_password') }}</h2>

    <div v-if="!sessionReady || message" class="message-container">
      <p class="message">{{ message || '正在验证链接...' }}</p>
    </div>

    <form v-if="sessionReady && !message.includes('成功')" @submit.prevent="handleReset">
      <input
        v-model="newPassword"
        type="password"
        :placeholder="$t('auth.enter_new_password')"
        class="input"
        required
      >
      <input
        v-model="confirmPassword"
        type="password"
        :placeholder="$t('auth.confirm_new_password')"
        class="input"
        required
      >
      <button :disabled="loading" class="button" type="submit">
        {{ loading ? $t('auth.submitting') : $t('auth.submit_new_password') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.reset-container {
  max-width: 400px;
  margin: 5rem auto;
  padding: 2rem;
  border-radius: 12px;
  background-color: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);
  text-align: center;
}
.input {
  width: 100%;
  padding: 0.75rem;
  margin-bottom: 1rem; /* 调整间距 */
  border: 1px solid #ccc;
  border-radius: 6px;
  box-sizing: border-box; /* 确保 padding 不会撑大宽度 */
}
.button {
  width: 100%;
  padding: 0.75rem;
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  margin-top: 1rem; /* 增加按钮上边距 */
}
.button:disabled {
  opacity: 0.6;
}
.message {
  margin-top: 1rem;
  font-size: 14px;
  color: #666;
}
.message-container {
  min-height: 50px; /* 给消息区域一个最小高度，防止跳动 */
}
</style>
