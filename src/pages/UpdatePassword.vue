<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDark } from '@vueuse/core'
import { supabase } from '@/utils/supabaseClient'

useDark() // 同样应用日夜间模式

const router = useRouter()
const password = ref('')
const loading = ref(false)
const message = ref('')
const success = ref(false)

async function handleUpdatePassword() {
  if (!password.value) {
    message.value = '请输入您的新密码。'
    return
  }

  loading.value = true
  message.value = ''
  try {
    const { error } = await supabase.auth.updateUser({
      password: password.value,
    })
    if (error)
      throw error
    message.value = '✅ 密码重置成功！即将跳转到登录页面...'
    success.value = true
    setTimeout(() => {
      router.push('/auth')
    }, 2000)
  }
  catch (err: any) {
    message.value = `❌ 重置失败: ${err.message}`
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  supabase.auth.onAuthStateChange(async (event, _session) => { // <-- 修正 1
    if (event === 'PASSWORD_RECOVERY') {
      // 修正 2: 移除了 console.log
      // 可以在这里处理一些UI逻辑，但目前我们只需要确保用户可以更新密码即可
    }
  })
})
</script>

<template>
  <div class="auth-container">
    <h1>重置您的密码</h1>
    <form v-if="!success" class="auth-form" @submit.prevent="handleUpdatePassword">
      <label>
        新密码
        <input v-model="password" type="password" required>
      </label>
      <button type="submit" :disabled="loading">
        {{ loading ? '更新中...' : '更新密码' }}
      </button>
    </form>
    <p v-if="message" class="message">{{ message }}</p>
  </div>
</template>

<style scoped>
/* 这里直接复用了 auth.vue 的样式，您可以根据需要调整 */
.auth-container { max-width: 480px; margin: 2rem auto; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); font-family: system-ui, sans-serif; font-size: 14px; color: #333; transition: background-color .3s ease, color .3s ease; }
.dark .auth-container { background: #1e1e1e; color: #e0e0e0; box-shadow: 0 4px 15px rgba(0,0,0,.2); }
h1 { text-align: center; margin-bottom: 2rem; font-size: 28px; font-weight: bold; color: #111; }
.dark h1 { color: #fff; }
.auth-form label { display: block; margin-bottom: 1.2rem; color: #555; }
.dark .auth-form label { color: #adadad; }
.auth-form input { width: 100%; padding: .8rem; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; background-color: #fff; color: #111; }
.dark .auth-form input { background-color: #2c2c2e; border-color: #48484a; color: #fff; }
.dark .auth-form input:focus { border-color: #00b386; outline: none; }
button { width: 100%; padding: .8rem; background-color: #00b386; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 15px; margin-top: 1rem; }
button:disabled { opacity: .6; cursor: not-allowed; }
.message { margin-top: 1rem; text-align: center; font-weight: bold; }
</style>
