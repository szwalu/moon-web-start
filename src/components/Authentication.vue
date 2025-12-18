<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import { useAutoSave } from '@/composables/useAutoSave'

// --- 初始化 & 状态 ---
const router = useRouter()
const route = useRoute() // [新增] 获取当前路由对象
const { t } = useI18n()
const messageHook = useMessage()
const authStore = useAuthStore()
const { autoLoadData } = useAutoSave()

// 默认是 login
const mode = ref<'login' | 'register' | 'forgotPassword'>('login')

// [新增] 检测 URL 参数，如果是 ?mode=forgot，则自动切换到忘记密码模式
if (route.query.mode === 'forgot')
  mode.value = 'forgotPassword'

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
// const inviteCode = ref('') // [已废弃] 注册阶段不再需要邀请码
const message = ref('')
const loading = ref(false)
const resetEmailSent = ref(false)

const pageTitle = computed(() => {
  if (mode.value === 'login')
    return t('auth.login')
  if (mode.value === 'register')
    return t('auth.register')
  return t('auth.forgot_password')
})

// [新增] Google OAuth 登录处理函数
async function handleGoogleLogin() {
  loading.value = true
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // 登录成功后跳回当前页面的来源，通常是 /auth 或首页
        redirectTo: `${window.location.origin}/auth`,
      },
    })
    if (error)
      throw error
    // 注意：OAuth 会跳转离开当前页面去 Google，所以这里不需要写路由跳转代码
  }
  catch (error: any) {
    messageHook.error(`${t('auth.messages.operation_failed')}: ${error.message}`)
    loading.value = false
  }
}

// --- 方法 ---
function setMode(newMode: 'login' | 'register' | 'forgotPassword') {
  mode.value = newMode
  message.value = ''
  password.value = ''
  passwordConfirm.value = ''
  // inviteCode.value = ''
  resetEmailSent.value = false
}

async function handleSubmitAuth() {
  // 1. 前端预检查 (可选，但推荐)：
  // 其实最好在发送请求前就拦截，既快又省流量
  if ((mode.value === 'register' || mode.value === 'login') && password.value.length < 6) {
    message.value = t('auth.errors.password_too_short')
    return
  }

  if (mode.value === 'register') {
    if (password.value !== passwordConfirm.value) {
      message.value = t('auth.messages.passwords_do_not_match')
      return
    }
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
        throw error // 抛出错误进入 catch 处理

      await authStore.refreshUser()
      await autoLoadData({ $message: messageHook, t })
      await router.replace('/auth')
    }
    else if (mode.value === 'register') {
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error // 抛出错误进入 catch 处理

      message.value = t('auth.messages.check_email_for_verification')
    }
    else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
        redirectTo: `${window.location.origin}/update-password`,
      })
      if (error)
        throw error

      message.value = t('auth.messages.reset_success')
      resetEmailSent.value = true
    }
  }
  catch (err: any) {
    // ✅ [核心修改] 集中处理 Supabase 系统错误映射
    const sysMsg = err.message

    if (sysMsg === 'Invalid login credentials') {
      message.value = t('auth.errors.invalid_login_credentials')
    }
    else if (sysMsg === 'Password should be at least 6 characters') {
      message.value = t('auth.errors.password_too_short')
    }
    else if (sysMsg === 'User already registered') {
      // 如果你以后遇到“用户已注册”，也可以加在这里
      message.value = t('auth.errors.user_exists')
      message.value = `${t('auth.errors.default')} (${sysMsg})`
    }
    else {
      // 兜底显示
      message.value = sysMsg || t('auth.messages.reset_failed')
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h1>{{ pageTitle }}</h1>
    <form class="auth-form" @submit.prevent="handleSubmitAuth">
      <label>
        {{ mode === 'forgotPassword' ? $t('auth.messages.enter_email') : $t('auth.email') }}
        <input
          v-model="email"
          type="email"
          :placeholder="mode === 'forgotPassword' ? $t('auth.messages.enter_registered_email') : $t('auth.email_placeholder')"
          :disabled="mode === 'forgotPassword' && resetEmailSent"
          required
        >
      </label>
      <label v-if="mode !== 'forgotPassword'">
        {{ $t('auth.password') }}
        <input
          v-model="password"
          type="password"
          :placeholder="mode === 'login' ? $t('auth.login_password_placeholder') : ''"
          required
        >
      </label>
      <label v-if="mode === 'register'">
        {{ $t('auth.confirm_password') }}
        <input
          v-model="passwordConfirm"
          type="password"
          required
        >
      </label>

      <template v-if="mode === 'forgotPassword' && resetEmailSent">
        <button type="button" @click="setMode('login')">
          {{ $t('auth.return') }}
        </button>
      </template>

      <template v-else>
        <button type="submit" :disabled="loading">
          <span v-if="loading">{{ $t('auth.loading') }}</span>
          <span v-else-if="mode === 'login'">{{ t('auth.login') }}</span>
          <span v-else-if="mode === 'register'">{{ t('auth.register') }}</span>
          <span v-else>{{ t('auth.confirm') }}</span>
        </button>
      </template>

      <p v-if="message" class="message">
        {{ message }}
      </p>

      <div v-if="mode === 'login' || mode === 'register'" style="margin-top: 1.5rem;">
        <div class="divider">
          <span>OR</span>
        </div>
        <button
          type="button"
          class="google-btn"
          :disabled="loading"
          @click="handleGoogleLogin"
        >
          <svg style="width:18px;height:18px;margin-right:8px;" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.11c-.22-.66-.35-1.36-.35-2.11s.13-1.45.35-2.11V7.05H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.95l2.66-2.84z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z" fill="#EA4335" />
          </svg>
          Sign in with Google
        </button>
      </div>

      <div v-if="mode === 'login'" class="toggle-row">
        <div class="toggle-left">
          <span>{{ $t('auth.prompt_to_register') }}</span>
          <a href="#" @click.prevent="setMode('register')">{{ $t('auth.register') }}</a>
        </div>
        <div class="toggle-right">
          <a href="#" @click.prevent="setMode('forgotPassword')">{{ $t('auth.forgot_password') }}</a>
        </div>
      </div>
      <p v-else class="toggle">
        <span>{{ $t('auth.prompt_to_login') }}</span>
        <a href="#" @click.prevent="setMode('login')">{{ t('auth.login') }}</a>
      </p>
    </form>
  </div>
</template>

<style scoped>
/* 样式保持完全一致 */
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
  text-align: left;
  margin-bottom: 1.2rem;
  color: #555;
}
.dark .auth-form label {
  color: #adadad;
}

.auth-form input {
  width: 100%;
  padding: 0.8rem;
  font-size: 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
}

.auth-form input:disabled {
  background-color: #f0f0f0;
  cursor: not-allowed;
}

.dark .auth-form input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
  font-size: 16px;
}

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
  color: red;
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
.toggle-row {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
  font-size: 14px;
  color: #666;
}
.toggle-left,
.toggle-right {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.toggle-left a,
.toggle-right a {
  color: #00b386;
  text-decoration: underline;
  cursor: pointer;
}
.dark .toggle-row {
  color: #aaa;
}
.dark .toggle-left a,
.dark .toggle-right a {
  color: #2dd4bf;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 1rem 0;
  color: #ccc;
  font-size: 12px;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #eee;
}
.divider::before {
  margin-right: .5em;
}
.divider::after {
  margin-left: .5em;
}
.dark .divider::before,
.dark .divider::after {
  border-bottom-color: #444;
}

/* Google Button Styles */
.google-btn {
  background-color: white;
  color: #333;
  border: 1px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
  margin-top: 0;
}
.google-btn:hover {
  background-color: #f8f8f8;
}
.dark .google-btn {
  background-color: #2a2a2a;
  color: #fff;
  border-color: #444;
}
.dark .google-btn:hover {
  background-color: #333;
}
</style>
