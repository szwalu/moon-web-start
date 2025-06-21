<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const { t } = useI18n()

const newPassword = ref('')
const confirmPassword = ref('')
const message = ref('')
const loading = ref(false)
const sessionReady = ref(false)

onMounted(async () => {
  const { data: userData, error } = await supabase.auth.getUser()

  if (error || !userData?.user) {
    message.value = t('auth.invalid_link')
    sessionReady.value = false
  }
  else {
    sessionReady.value = true
  }
})

async function handleReset() {
  if (!newPassword.value || !confirmPassword.value) {
    message.value = t('auth.enter_and_confirm')
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    message.value = t('auth.mismatch')
    return
  }

  loading.value = true

  const { error } = await supabase.auth.updateUser({
    password: newPassword.value,
  })

  if (error) {
    message.value = `${t('auth.reset_failed')}：${error.message}`
  }
  else {
    await supabase.auth.signOut()
    message.value = t('auth.messages.reset_success_redirect')
    setTimeout(() => router.push('/auth'), 2000)
  }

  loading.value = false
}
</script>

<template>
  <div class="reset-container">
    <h2>{{ $t('auth.reset_password') }}</h2>

    <div v-if="!sessionReady" class="message">{{ message }}</div>

    <div v-else>
      <input
        v-model="newPassword"
        type="password"
        :placeholder="$t('auth.enter_new_password')"
        class="input"
      >
      <input
        v-model="confirmPassword"
        type="password"
        :placeholder="$t('auth.confirm_new_password')"
        class="input"
      >
      <button :disabled="loading" class="button" @click="handleReset">
        {{ loading ? $t('auth.submitting') : $t('auth.submit_new_password') }}
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
