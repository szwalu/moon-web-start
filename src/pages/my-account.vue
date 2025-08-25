<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

// --- 初始化 & 状态定义 ---
useDark()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()

const user = computed(() => authStore.user)
const loading = ref(false)
const lastBackupTime = ref('N/A')
// 关键改动1：新增一个 sessionReady 状态，默认为 false
const sessionReady = ref(false)

// --- 数据获取 ---
// onMounted 会在组件挂载后执行
onMounted(async () => {
  // 关键改动2：主动调用 refreshUser 来确保获取最新的用户状态
  // 这会等待 Supabase 确认完毕，再继续执行
  await authStore.refreshUser()

  if (user.value) {
    const { data } = await supabase
      .from('profiles')
      .select('updated_at')
      .eq('id', user.value.id)
      .single()
    lastBackupTime.value = data?.updated_at
      ? new Date(`${data.updated_at}Z`).toLocaleString()
      : '暂无备份'
  }
  // 关键改动3：所有数据加载完毕后，才将 sessionReady 设为 true，允许页面显示内容
  sessionReady.value = true
})

const lastLoginTime = computed(() => {
  if (user.value?.last_sign_in_at)
    return new Date(user.value.last_sign_in_at).toLocaleString()
  return 'N/A'
})

// --- 方法 ---
async function handleLogout() {
  loading.value = true
  await supabase.auth.signOut()
  window.location.href = '/' // 登出后强制刷新到主页
  loading.value = false
}
</script>

<template>
  <div class="account-container">
    <div v-if="sessionReady && user">
      <h1 class="account-title">{{ t('auth.account_title') }}</h1>
      <div class="info-grid">
        <p>
          <span class="info-label">{{ t('auth.account_email_label') }}</span>
          <span class="info-value">{{ user.email }}</span>
        </p>
        <p>
          <span class="info-label">{{ t('auth.account_last_login_label') }}</span>
          <span class="info-value">{{ lastLoginTime }}</span>
        </p>
        <p>
          <span class="info-label">{{ t('auth.account_last_backup_label') }}</span>
          <span class="info-value">{{ lastBackupTime }}</span>
        </p>
      </div>

      <div class="button-group">
        <button :disabled="loading" @click="router.push('/')">
          {{ t('auth.return_home') }}
        </button>
        <button class="button--secondary" :disabled="loading" @click="handleLogout">
          {{ loading ? t('auth.loading') : t('auth.logout') }}
        </button>
      </div>
    </div>
    <div v-else class="loading-container">
      <p>正在加载用户信息...</p>
    </div>
  </div>
</template>

<style scoped>
/* 这里是账户页面专用的样式 */
.account-container {
  max-width: 480px;
  margin: 2rem auto;
  padding: 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
}
.dark .account-container {
  background: #1e1e1e;
  color: #e0e0e0;
}

.account-title {
  font-size: 18px;
  text-align: center;
  margin-bottom: 2rem;
  font-weight: bold;
}
.dark .account-title {
    color: #ffffff;
}

.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding: 0.5rem 0;
  margin: 0;
}
.dark .info-grid p {
  border-bottom-color: #333;
}
.info-label {
  color: #555;
  font-weight: bold;
}
.dark .info-label {
  color: #adadad;
}

.info-value {
  color: #111;
  word-break: break-all;
}
.dark .info-value {
  color: #ffffff;
}

.button-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 2rem;
}

button {
  padding: 0.8rem;
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.button--secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
}
.dark .button--secondary {
  background-color: #3a3a3c;
  color: #e0e0e0;
  border-color: #555;
}
.loading-container {
  text-align: center;
  padding: 2rem;
  color: #666;
}
.dark .loading-container {
  color: #aaa;
}
</style>
