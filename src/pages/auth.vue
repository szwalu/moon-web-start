<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { supabase } from '@/utils/supabaseClient'

useDark()

const router = useRouter()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const passwordConfirm = ref('') // 【新增】用于存储确认密码的变量
const isLogin = ref(true)
const message = ref('')
const loading = ref(false)

function toggleMode() {
  isLogin.value = !isLogin.value
  message.value = ''
  password.value = '' // 【新增】切换模式时清空密码
  passwordConfirm.value = '' // 【新增】切换模式时清空确认密码
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
      await router.push('/')
    }
    else {
      // 【修改】在注册逻辑前增加密码校验
      if (password.value !== passwordConfirm.value) {
        message.value = t('auth.messages.passwords_do_not_match')
        // loading 需要在 finally 中统一处理，这里提前返回即可
        loading.value = false
        return
      }

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
    console.error(err)
    if (err.message.includes('User already registered'))
      message.value = t('auth.messages.user_already_registered')
    else if (err.message.includes('Email not confirmed'))
      message.value = t('auth.messages.email_not_confirmed')
    else
      message.value = t('auth.messages.operation_failed') + err.message
  }
  finally {
    loading.value = false
  }
}

// handlePasswordReset 函数保持不变
async function handlePasswordReset() {
  // ...
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

      <p v-if="isLogin" class="forgot-password">
        <a href="#" @click.prevent="handlePasswordReset">
          {{ $t('auth.forgot_password') }}
        </a>
      </p>

      <p class="toggle">
        <span>{{ isLogin ? $t('auth.prompt_to_register') : $t('auth.prompt_to_login') }}</span>
        <a href="#" @click.prevent="toggleMode">
          {{ isLogin ? $t('auth.register') : $t('auth.login') }}
        </a>
      </p>
    </form>
  </div>
</template>

<style scoped>
/* 所有样式都保持不变 */
</style>

<style>
/* 所有样式都保持不变 */
</style>
