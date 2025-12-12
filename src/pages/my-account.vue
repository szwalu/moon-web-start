<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'

import { useDialog } from 'naive-ui'

// [新增] 引入 useDialog
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

// --- 初始化 & 状态定义 ---
useDark()
const { t } = useI18n()
const dialog = useDialog() // [新增] 初始化 dialog
const authStore = useAuthStore()

const user = computed(() => authStore.user)
const loading = ref(false)
const lastBackupTime = ref('N/A')
const sessionReady = ref(false)
let authListener: any = null

// --- 生命周期：预热 session + 监听变更 ---
onMounted(async () => {
  // [PATCH-1] 预热一次 session
  try {
    const { data, error } = await supabase.auth.getSession()
    if (!error) {
      const currentUser = data?.session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser
    }
  }
  catch {
    // 忽略错误
  }

  // [PATCH-2] 订阅会话变更
  const result = supabase.auth.onAuthStateChange((_event, session) => {
    authStore.user = session?.user ?? null
  })
  authListener = result.data.subscription

  // 加载页面数据
  if (user.value) {
    const { data } = await supabase
      .from('profiles')
      .select('updated_at')
      .eq('id', user.value.id)
      .single()
    if (data?.updated_at)
      lastBackupTime.value = new Date(`${data.updated_at}Z`).toLocaleString()
    else
      lastBackupTime.value = '暂无备份'
  }

  sessionReady.value = true
})

onUnmounted(() => {
  if (authListener)
    authListener.unsubscribe()
})

const lastLoginTime = computed(() => {
  if (user.value?.last_sign_in_at)
    return new Date(user.value.last_sign_in_at).toLocaleString()

  return 'N/A'
})

// --- 方法 ---

// [修改] 原有的登出逻辑改名为 doSignOut，供确认框回调调用
async function doSignOut() {
  loading.value = true
  try {
    await supabase.auth.signOut()
  }
  finally {
    // 强制刷新到首页
    window.location.assign('/')
  }
}

// [新增] 打开确认框
function openLogoutConfirm() {
  dialog.warning({
    title: t('notes.account.logout_confirm.title'),
    content: t('notes.account.logout_confirm.content'),
    negativeText: t('notes.account.logout_confirm.negative'),
    positiveText: t('notes.account.logout_confirm.positive'),
    async onPositiveClick() {
      await doSignOut()
    },
  })
}
</script>

<template>
  <div class="page-safearea">
    <div class="account-container" :aria-busy="!sessionReady">
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
          <RouterLink to="/" class="btn-like" role="button" aria-label="Home">
            {{ t('auth.return_home') }}
          </RouterLink>

          <button
            type="button"
            class="button--secondary"
            :disabled="loading"
            @click="openLogoutConfirm"
          >
            {{ loading ? t('auth.loading') : t('auth.logout') }}
          </button>
        </div>
      </div>
      <div v-else class="loading-container">
        <p>正在加载用户信息...</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 顶部安全区容器 */
.page-safearea {
  padding-top: calc(8px + constant(safe-area-inset-top));
  padding-top: calc(8px + env(safe-area-inset-top));
}

/* 容器与主题 */
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
.account-container[aria-busy="true"] { cursor: progress; }

.account-title {
  font-size: 18px;
  text-align: center;
  margin-bottom: 2rem;
  font-weight: bold;
}
.dark .account-title { color: #ffffff; }

/* 信息区 */
.info-grid p {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding: 0.5rem 0;
  margin: 0;
}
.dark .info-grid p { border-bottom-color: #333; }
.info-label { color: #555; font-weight: bold; }
.dark .info-label { color: #adadad; }
.info-value { color: #111; word-break: break-all; }
.dark .info-value { color: #ffffff; }

/* 按钮区 */
.button-group {
  display: grid;
  grid-template-columns: 4fr 1fr;
  gap: 1rem;
  margin-top: 2rem;
}

/* RouterLink 视觉上像按钮 */
.btn-like,
button {
  display: inline-block;
  text-align: center;
  padding: 0.8rem;
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  text-decoration: none;
}
button:disabled { opacity: 0.6; cursor: not-allowed; }

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
.dark .loading-container { color: #aaa; }
</style>
