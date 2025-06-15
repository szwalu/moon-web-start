<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const newPassword = ref('')
const confirmPassword = ref('')
const message = ref('')
const loading = ref(false)
const sessionReady = ref(false)

onMounted(async () => {
  const { data: userData, error } = await supabase.auth.getUser()

  if (error || !userData?.user) {
    message.value = '密码重设链接无效或已过期，请重新请求重设密码.。'
    sessionReady.value = false
  }
  else {
    sessionReady.value = true
  }
})

async function handleReset() {
  if (!newPassword.value || !confirmPassword.value) {
    message.value = '请输入并确认新密码。'
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    message.value = '两次输入的密码不一致。'
    return
  }

  loading.value = true

  const { error } = await supabase.auth.updateUser({
    password: newPassword.value,
  })

  if (error) {
    message.value = `重设失败：${error.message}`
  }
  else {
    message.value = '密码已成功重设，2秒后将跳转到首页...'
    setTimeout(() => router.push('/'), 2000)
  }

  loading.value = false
}
</script>

<template>
  <div class="reset-container">
    <h2>重设密码</h2>

    <div v-if="!sessionReady" class="message">{{ message }}</div>

    <div v-else>
      <input
        v-model="newPassword"
        type="password"
        placeholder="请输入新密码"
        class="input"
      >
      <input
        v-model="confirmPassword"
        type="password"
        placeholder="请再次输入新密码"
        class="input"
      >
      <button :disabled="loading" class="button" @click="handleReset">
        {{ loading ? '提交中...' : '提交新密码' }}
      </button>
      <p class="message">{{ message }}</p>
    </div>
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
  margin: 1rem 0;
  border: 1px solid #ccc;
  border-radius: 6px;
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
}
.button:disabled {
  opacity: 0.6;
}
.message {
  margin-top: 1rem;
  font-size: 14px;
  color: #666;
}
</style>
