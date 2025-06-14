<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n' // 1. 导入 useI18n
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n() // 2. 获取 t 函数，用于在 <script> 中进行翻译

const email = ref('')
const password = ref('')
const isLogin = ref(true)
const message = ref('')
const loading = ref(false)
const registrationAttempted = ref(false)

function toggleMode() {
  isLogin.value = !isLogin.value
  message.value = ''
  registrationAttempted.value = false
}

async function handleSubmit() {
  if (!isLogin.value && registrationAttempted.value)
    return

  loading.value = true
  message.value = ''

  try {
    if (isLogin.value) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (error) throw error
      await router.push('/')
    }
    else {
      const { data, error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error) throw error

      if (data.user) {
        if (data.session === null) {
          // 使用 t() 函数进行翻译
          message.value = t('auth.messages.check_email_or_login')
        }
        else {
          message.value = t('auth.messages.check_email_for_verification')
        }
        registrationAttempted.value = true
      }
    }
  }
  catch (err: any) {
    console.error(err)
    if (err.message.includes('User already registered')) {
      message.value = t('auth.messages.user_already_registered')
      registrationAttempted.value = true
    }
    else if (err.message.includes('Email not confirmed')) {
      message.value = t('auth.messages.email_not_confirmed')
    }
    else {
      // 翻译静态部分，并拼接动态的错误信息
      message.value = t('auth.messages.operation_failed') + err.message
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-container">
    <h1>{{ isLogin ? $t('auth.login') : $t('auth.register') }}</h1>

    <form class="auth-form" @submit.prevent="handleSubmit">
      <label>
        {{ $t('auth.email') }}
        <input v-model="email" type="email" required>
      </label>

      <label>
        {{ $t('auth.password') }}
        <input v-model="password" type="password" required>
      </label>

      <button type="submit" :disabled="loading || (!isLogin && registrationAttempted)">
        {{ loading ? $t('auth.loading') : (isLogin ? $t('auth.login') : $t('auth.register')) }}
      </button>

      <p v-if="message" class="message">
        {{ message }}
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
}
h1 {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 28px;
  font-weight: bold;
}
.auth-form label {
  display: block;
  margin-bottom: 1.2rem;
}
.auth-form input {
  width: 100%;
  padding: 0.8rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
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
}
.toggle a {
  margin-left: 0.4rem;
  color: #00b386;
  text-decoration: underline;
  cursor: pointer;
}
</style>