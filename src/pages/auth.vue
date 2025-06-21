<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'

import { useMessage } from 'naive-ui'

// 【修正1】: 重新导入 useMessage
import { useAutoSave } from '@/composables/useAutoSave'

// 【修正2】: 重新导入 useAutoSave
import { supabase } from '@/utils/supabaseClient'

useDark()
const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage() // 【修正3】: 重新获取 message 实例
const { autoLoadData } = useAutoSave() // 【修正4】: 重新获取 autoLoadData 函数

// --- 以下是您现有的状态变量，保持不变 ---
const user = ref<any>(null)
const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const message = ref('')
const loading = ref(false)
const resetEmailSent = ref(false)

const lastLoginTime = computed(() => {
  if (user.value?.last_sign_in_at)
    return new Date(user.value.last_sign_in_at).toLocaleString()
  return 'N/A'
})

onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
    if (!session)
      mode.value = 'login'
  })
})

async function handleLogout() {
  loading.value = true
  await supabase.auth.signOut()
  loading.value = false
}

function setMode(newMode: 'login' | 'register' | 'forgotPassword') {
  mode.value = newMode
  message.value = ''
  password.value = ''
  passwordConfirm.value = ''
  resetEmailSent.value = false
}

async function handleSubmit() {
  if (mode.value === 'register' && password.value !== passwordConfirm.value) {
    message.value = t('auth.messages.passwords_do_not_match')
    return
  }

  loading.value = true
  message.value = ''
  try {
    if (mode.value === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error

      // 【核心修正】: 在这里重新调用 autoLoadData，以在登录成功后恢复数据
      await autoLoadData({ $message: messageHook, t })

      await router.push('/')
    }
    else if (mode.value === 'register') {
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
    else { // 'forgotPassword' 模式
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
        redirectTo: `${window.location.origin}/update-password`,
      })
      if (error)
        throw error
      message.value = t('auth.messages.password_reset_sent')
      resetEmailSent.value = true
    }
  }
  catch (err: any) {
    message.value = err.message || t('auth.messages.operation_failed')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-container">
    <div v-if="user" class="account-info">
      <h1>{{ $t('auth.account_title') }}</h1>
      <div class="info-grid">
        <p>
          <span class="info-label">{{ $t('auth.account_email_label') }}</span>
          <span class="info-value">{{ user.email }}</span>
        </p>
        <p>
          <span class="info-label">{{ $t('auth.account_last_login_label') }}</span>
          <span class="info-value">{{ lastLoginTime }}</span>
        </p>
      </div>
      <button :disabled="loading" @click="handleLogout">
        {{ loading ? $t('auth.loading') : $t('auth.logout') }}
      </button>
    </div>

    <div v-else>
      <h1>{{ pageTitle }}</h1>
      <form class="auth-form" @submit.prevent="handleSubmit">
        <label>
          {{ mode === 'forgotPassword' ? $t('auth.messages.enter_email') : $t('auth.email') }}
          <input v-model="email" type="email" :placeholder="mode === 'forgotPassword' ? $t('auth.messages.enter_registered_email') : $t('auth.email_placeholder')" :disabled="mode === 'forgotPassword' && resetEmailSent" required>
        </label>
        <label v-if="mode !== 'forgotPassword'">
          {{ $t('auth.password') }}
          <input v-model="password" type="password" required>
        </label>
        <label v-if="mode === 'register'">
          {{ $t('auth.confirm_password') }}
          <input v-model="passwordConfirm" type="password" required>
        </label>
        <template v-if="mode === 'forgotPassword' && resetEmailSent">
          <button type="button" @click="setMode('login')">
            {{ $t('auth.return') }}
          </button>
        </template>
        <template v-else>
          <button type="submit" :disabled="loading">
            <span v-if="loading">{{ $t('auth.loading') }}</span>
            <span v-else-if="mode === 'login'">{{ $t('auth.login') }}</span>
            <span v-else-if="mode === 'register'">{{ $t('auth.register') }}</span>
            <span v-else>{{ $t('auth.confirm') }}</span>
          </button>
        </template>
        <p v-if="message" class="message">{{ message }}</p>
        <p v-if="!(mode === 'forgotPassword' && resetEmailSent)" class="toggle">
          <template v-if="mode === 'login'">
            <span>{{ $t('auth.prompt_to_register') }}</span>
            <a href="#" @click.prevent="setMode('register')">{{ $t('auth.register') }}</a>
            <span> | </span>
            <a href="#" @click.prevent="setMode('forgotPassword')">{{ $t('auth.forgot_password') }}</a>
          </template>
          <template v-else>
            <span>{{ $t('auth.prompt_to_login') }}</span>
            <a href="#" @click.prevent="setMode('login')">{{ $t('auth.login') }}</a>
          </template>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* 样式部分保持不变 */
.auth-container {
  max-width: 480px;
  margin: 2rem auto;
  padding: 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #333;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

h1 {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 28px;
  font-weight: bold;
  color: #111;
}
.dark h1 {
  color: #ffffff;
}

.auth-form label {
  display: block;
  margin-bottom: 1.2rem;
  color: #555;
}
.dark .auth-form label {
  color: #adadad;
}

.auth-form input {
  width: 100%;
  padding: 0.8rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
}

/* 为禁用状态添加样式 */
.auth-form input:disabled {
  background-color: #f0f0f0;
  cursor: not-allowed;
}

.dark .auth-form input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
}

/* 为禁用状态添加样式 (Dark Mode) */
.dark .auth-form input:disabled {
    background-color: #3a3a3c;
    opacity: 0.7;
}

.dark .auth-form input:focus {
  border-color: #00b386;
  outline: none;
}

button {
  width: 100%;
  padding: 0.8rem;
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  margin-top: 1rem;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.message {
  margin-top: 1rem;
  text-align: center;
  font-weight: bold;
}

.toggle {
  text-align: center;
  margin-top: 1rem;
  color: #666;
}
.dark .toggle {
  color: #888;
}
.toggle a {
  margin-left: 0.4rem;
  color: #00b386;
  text-decoration: underline;
  cursor: pointer;
}
.dark .toggle a {
  color: #2dd4bf;
}

/* 【新增】为账户信息视图添加一些样式 */
.account-info {
  text-align: center;
}
.info-grid {
  margin: 2rem 0;
  text-align: left;
  display: grid;
  gap: 1rem;
}
.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
}
.dark .info-grid p {
  border-bottom-color: #333;
}
.info-label {
  color: #555;
  font-weight: bold;
}
.dark .info-label {
  color: #adadad;
}
.info-value {
  color: #111;
  word-break: break-all;
}
.dark .info-value {
  color: #ffffff;
}
</style>

<style>
/* 全局样式保持不变 */
body, html {
  background-color: #f8f9fa;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px);
  background-size: 25px 25px;
  transition: background-color 0.3s ease;
}
.dark body, html {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
}
</style>
