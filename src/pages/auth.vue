<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage()
const { autoLoadData } = useAutoSave()

const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const message = ref('')
const loading = ref(false)
// 新增状态，用于标记重置邮件是否已发送
const resetEmailSent = ref(false)

const pageTitle = computed(() => {
  if (mode.value === 'login')
    return t('auth.login')
  if (mode.value === 'register')
    return t('auth.register')
  return t('auth.reset_password')
})

// 切换模式时，重置所有相关状态
function setMode(newMode: 'login' | 'register' | 'forgotPassword') {
  mode.value = newMode
  message.value = ''
  password.value = ''
  passwordConfirm.value = ''
  resetEmailSent.value = false // 确保在切换时重置此状态
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
      await autoLoadData(messageHook)
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
        redirectTo: 'https://woabc.com/update-password',
      })
      if (error)
        throw error
      // 成功发送邮件后，更新提示信息并设置标志位
      message.value = '密码重置邮件已发送，请检查您的邮箱。'
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

      <p v-if="message" class="message">
        {{ message }}
      </p>

      <p v-if="!(mode === 'forgotPassword' && resetEmailSent)" class="toggle">
        <template v-if="mode === 'login'">
          <span>{{ $t('auth.prompt_to_register') }}</span>
          <a href="#" @click.prevent="setMode('register')">
            {{ $t('auth.register') }}
          </a>
          <span> | </span>
          <a href="#" @click.prevent="setMode('forgotPassword')">
            {{ $t('auth.forgot_password') }}
          </a>
        </template>
        <template v-else>
          <span>{{ $t('auth.prompt_to_login') }}</span>
          <a href="#" @click.prevent="setMode('login')">
            {{ $t('auth.login') }}
          </a>
        </template>
      </p>
    </form>
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
