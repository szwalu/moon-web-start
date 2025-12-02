<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import { useAutoSave } from '@/composables/useAutoSave'

// --- 初始化 & 状态 (全部从 auth.vue 迁移过来) ---
const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage()
const authStore = useAuthStore()
const { autoLoadData } = useAutoSave()

const mode = ref<'login' | 'register' | 'forgotPassword'>('login')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const inviteCode = ref('')
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

// --- 方法 (全部从 auth.vue 迁移过来) ---
function setMode(newMode: 'login' | 'register' | 'forgotPassword') {
  mode.value = newMode
  message.value = ''
  password.value = ''
  passwordConfirm.value = ''
  inviteCode.value = ''
  resetEmailSent.value = false
}

async function handleSubmitAuth() {
  if (mode.value === 'register') {
    if (password.value !== passwordConfirm.value) {
      message.value = t('auth.messages.passwords_do_not_match')
      return
    }

    // --- 修改点 1: 预检查代码逻辑 ---
    // 检查代码是否存在，并且 is_used 必须为 false
    const { data, error } = await supabase
      .from('invite_codes')
      .select('code')
      .eq('code', inviteCode.value)
      .eq('is_used', false) // 关键：必须是未使用的
      .single()

    if (error || !data) {
      message.value = t('auth.messages.invalid_invite_code')
      return
    }
  }

  loading.value = true
  message.value = ''

  try {
    if (mode.value === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
      if (error)
        throw error
      await authStore.refreshUser()
      await autoLoadData({ $message: messageHook, t })
      await router.replace('/')
    }
    else if (mode.value === 'register') {
      // --- 修改点 2: 传递 invite_code 到后端触发器 ---
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
        options: {
          data: {
            // 这里的数据会被存入 auth.users 表的 raw_user_meta_data 字段
            // 我们的数据库触发器会读取这个字段
            invite_code: inviteCode.value,
          },
        },
      })

      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
    else {
      // ... 忘记密码逻辑保持不变
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, { redirectTo: `${window.location.origin}/update-password` })
      if (error)
        throw error
      message.value = t('auth.messages.reset_success')
      resetEmailSent.value = true
    }
  }
  catch (err: any) {
    // 如果触发器抛出错误（例如并发情况下邀请码刚被别人用了），这里会捕获到
    message.value = err.message || t('auth.messages.reset_failed')
  }
  finally {
    loading.value = false
  }
}

function goHomeAndRefresh() {
  router.push('/').then(() => window.location.reload())
}
</script>

<template>
  <div>
    <h1>{{ pageTitle }}</h1>
    <form class="auth-form" @submit.prevent="handleSubmitAuth">
      <label>
        {{ mode === 'forgotPassword' ? $t('auth.messages.enter_email') : $t('auth.email') }}
        <input v-model="email" type="email" :placeholder="mode === 'forgotPassword' ? $t('auth.messages.enter_registered_email') : $t('auth.email_placeholder')" :disabled="mode === 'forgotPassword' && resetEmailSent" required>
      </label>
      <label v-if="mode !== 'forgotPassword'">
        {{ $t('auth.password') }}
        <input
          v-model="password"
          type="password"
          :placeholder="mode === 'register' ? $t('auth.password_placeholder') : $t('auth.login_password_placeholder')"
          required
        >
      </label>
      <label v-if="mode === 'register'">
        {{ $t('auth.confirm_password') }}
        <input
          v-model="passwordConfirm"
          type="password"
          :placeholder="$t('auth.password_placeholder')"
          required
        >
      </label>
      <label v-if="mode === 'register'">
        {{ $t('auth.invite_code') }}
        <input v-model="inviteCode" type="text" :placeholder="$t('auth.invite_code_placeholder')" required>
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
      <p v-if="message" class="message">{{ message }}</p>
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
      <p class="text-center leading-relaxed text-gray-500" style="font-size: 13px;">
        {{ t('auth.Log_in_again_prefix') }}
        <a href="/" class="cursor-pointer text-green-600 underline" @click.prevent="goHomeAndRefresh">
          {{ t('auth.Log_in_again_link') }}
        </a>
        {{ t('auth.Log_in_again_suffix') }}
      </p>
    </form>
  </div>
</template>

<style scoped>
/* 从 auth.vue 中复制过来的认证表单专用样式 */
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
  color: red; /* Make error messages stand out */
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
</style>
