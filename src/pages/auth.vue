<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { useMessage } from 'naive-ui'

// 导入 useMessage
import { useAutoSave } from '@/composables/useAutoSave'

// 导入 useAutoSave
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n()
const messageHook = useMessage() // 获取 message 实例
const { autoLoadData } = useAutoSave() // 获取 autoLoadData 函数

const email = ref('')
const password = ref('')
const isLogin = ref(true)
const message = ref('')
const loading = ref(false)

// ... toggleMode 函数保持不变 ...
function toggleMode() { /* ... */ }

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

      // 【核心修正】：登录成功后，在这里手动调用 autoLoadData
      await autoLoadData(messageHook)

      await router.push('/')
    }
    else {
      // 注册逻辑保持不变
      const { error } = await supabase.auth.signUp({ /* ... */ })
      if (error)
        throw error
      message.value = t('auth.messages.check_email_for_verification')
    }
  }
  catch (err: any) {
    // ... catch 逻辑保持不变 ...
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
      </p>
    </form>
  </div>
</template>

<style scoped>
/* 组件内部的样式 */
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

/* “忘记密码”的样式已被删除 */

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
/* 全局背景样式 */
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
