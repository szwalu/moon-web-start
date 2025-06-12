<script setup lang="ts">
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'

const email = ref('')
const password = ref('')
const isLogin = ref(true)
const message = ref('')
const loading = ref(false)

function toggleMode() {
  isLogin.value = !isLogin.value
  message.value = ''
}

async function handleSubmit() {
  loading.value = true
  message.value = ''

  try {
    let res
    if (isLogin.value) {
      res = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })

      if (res.error)
        throw res.error

      // 登录成功后检查用户是否已有数据，如果没有则插入默认数据
      const { data: existing, error } = await supabase
        .from('moon')
        .select('*')
        .eq('id', res.data.user.id)
        .single()

      if (!existing && !error) {
        await supabase.from('moon').insert([
          {
            id: res.data.user.id,
            data: { sites: [], updated: new Date().toISOString() },
          },
        ])
      }

      message.value = '✅ 登录成功'
    }
    else {
      res = await supabase.auth.signUp({ email: email.value, password: password.value })
      if (res.error)
        throw res.error
      message.value = '✅ 注册成功，请查收确认邮件'
    }
  }
  catch (err: any) {
    console.error(err)
    if (err.message.includes('Email not confirmed'))
      message.value = '❌ 请先确认您的邮箱'
    else
      message.value = `❌ 操作失败：${err.message}`
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-container">
    <h1>{{ isLogin ? '登录' : '注册' }}</h1>

    <form class="auth-form" @submit.prevent="handleSubmit">
      <label>
        邮箱
        <input v-model="email" type="email" required>
      </label>

      <label>
        密码
        <input v-model="password" type="password" required>
      </label>

      <button type="submit" :disabled="loading">
        {{ loading ? '处理中...' : (isLogin ? '登录' : '注册') }}
      </button>

      <p v-if="message" class="message">{{ message }}</p>

      <p class="toggle">
        <span>{{ isLogin ? '还没有账号？' : '已有账号？' }}</span>
        <a href="#" @click.prevent="toggleMode">
          {{ isLogin ? '注册' : '登录' }}
        </a>
      </p>
    </form>
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
}

h1 {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 2rem;
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
