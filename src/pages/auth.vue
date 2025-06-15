<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage()
const { autoLoadData } = useAutoSave()

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const isLogin = ref(true)
const message = ref('')
const loading = ref(false)

// 忘记密码弹窗相关
const showForgotPrompt = ref(false)
const forgotEmail = ref('')

function toggleMode() {
  isLogin.value = !isLogin.value
  message.value = ''
}

async function handleSubmit() {
  loading.value = true
  message.value = ''
  try {
    if (isLogin.value) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error
      await autoLoadData(messageHook)
      await router.push('/')
    }
    else {
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
  }
  catch (err: any) {
    message.value = err.message || '发生错误'
  }
  finally {
    loading.value = false
  }
}

function handleForgotPassword() {
  showForgotPrompt.value = true
  forgotEmail.value = email.value // 默认填入登录框里的邮箱
}

async function confirmForgotPassword() {
  if (!forgotEmail.value) {
    message.value = '请输入您的邮箱地址。'
    return
  }

  loading.value = true
  message.value = ''

  const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.value, {
    redirectTo: 'https://woabc.com/update-password',
  })

  if (error)
    message.value = `发送失败：${error.message}`
  else
    message.value = '重置密码邮件已发送，请前往邮箱查收。'

  showForgotPrompt.value = false
  loading.value = false
}
</script>

<template>
  <div class="auth-container">
    <h1>{{ isLogin ? $t('auth.login') : $t('auth.register') }}</h1>

    <form class="auth-form" @submit.prevent="handleSubmit">
      <label>
        {{ $t('auth.email') }}
        <input v-model="email" type="email" :placeholder="$t('auth.email_placeholder')" required>
      </label>
      <label>
        {{ $t('auth.password') }}
        <input v-model="password" type="password" required>
      </label>

      <label v-if="!isLogin">
        {{ $t('auth.confirm_password') }}
        <input v-model="passwordConfirm" type="password" required>
      </label>

      <button type="submit" :disabled="loading">
        {{ loading ? $t('auth.loading') : (isLogin ? $t('auth.login') : $t('auth.register')) }}
      </button>

      <p v-if="message" class="message">{{ message }}</p>

      <p class="toggle">
        <span>{{ isLogin ? $t('auth.prompt_to_register') : $t('auth.prompt_to_login') }}</span>
        <a href="#" @click.prevent="toggleMode">
          {{ isLogin ? $t('auth.register') : $t('auth.login') }}
        </a>
        <span v-if="isLogin">
          |
          <a href="#" style="color: #00b386; text-decoration: underline;" @click.prevent="handleForgotPassword">
            忘记密码？
          </a>
        </span>
      </p>
    </form>

    <!-- 忘记密码弹窗区域 -->
    <div v-if="showForgotPrompt" style="margin-top: 2rem; text-align: center;">
      <p>请输入您的注册邮箱：</p>
      <input v-model="forgotEmail" type="email" placeholder="邮箱地址" class="input">
      <button class="button" style="margin-top: 1rem;" @click="confirmForgotPassword">确定</button>
    </div>
  </div>
</template>

<style scoped>
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
.dark .auth-form input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
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
