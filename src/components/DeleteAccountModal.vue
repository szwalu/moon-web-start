<script setup lang="ts">
import { type PropType, computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'

import { useI18n } from 'vue-i18n'

// ✅ 引入 useI18n
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  show: { type: Boolean, required: true },
  user: {
    type: Object as PropType<User | null>,
    required: false,
    default: null,
  },
})

const emit = defineEmits(['close'])
const messageHook = useMessage()
const { t } = useI18n() // ✅ 初始化翻译函数

const form = reactive({
  email: '',
  password: '',
})
const loading = ref(false)

const isPasswordUser = computed(() => {
  return props.user?.app_metadata?.provider === 'email'
})

async function handleDelete() {
  // 1. 基础校验
  if (!form.email) {
    messageHook.warning(t('auth.delete_account.msg_enter_account')) // "请输入账号"
    return
  }

  if (isPasswordUser.value && !form.password) {
    messageHook.warning(t('auth.delete_account.msg_enter_password')) // "请输入密码"
    return
  }

  // 校验邮箱是否匹配
  if (form.email !== props.user?.email) {
    messageHook.error(t('auth.delete_account.msg_account_mismatch')) // "账号不一致"
    return
  }

  loading.value = true

  try {
    // 2. 仅针对“密码用户”进行密码验证
    if (isPasswordUser.value) {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      })

      if (loginError)
        throw new Error(t('auth.delete_account.msg_auth_failed')) // "验证失败"
    }

    // 3. 执行删除
    const { error: deleteError } = await supabase.rpc('delete_user_account')

    if (deleteError)
      throw deleteError

    // 4. 成功后处理
    messageHook.success(t('auth.delete_account.msg_success')) // "账户已删除"
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }
  catch (e: any) {
    console.error(e)
    messageHook.error(e.message || t('auth.delete_account.msg_failed')) // "删除失败"
  }
  finally {
    loading.value = false
  }
}

function handleClose() {
  form.email = ''
  form.password = ''
  emit('close')
}
</script>

<template>
  <div v-if="show" class="modal-overlay">
    <div class="delete-box">
      <div class="header">
        <h3>{{ t('auth.delete_account.title') }}</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>

      <div class="content">
        <p class="warning-text">
          {{ t('auth.delete_account.warning_1') }}<br>
          {{ t('auth.delete_account.warning_2') }}<br>

          <span v-if="isPasswordUser">{{ t('auth.delete_account.instruction_pwd') }}</span>
          <span v-else>{{ t('auth.delete_account.instruction_oauth') }}</span>
        </p>

        <input
          v-model="form.email"
          type="text"
          :placeholder="t('auth.delete_account.placeholder_account')"
          class="del-input"
        >

        <input
          v-if="isPasswordUser"
          v-model="form.password"
          type="password"
          :placeholder="t('auth.delete_account.placeholder_password')"
          class="del-input"
        >
      </div>

      <div class="footer">
        <button class="btn-cancel" @click="handleClose">
          {{ t('button.cancel') || '取消' }}
        </button>
        <button
          class="btn-delete"
          :disabled="loading"
          @click="handleDelete"
        >
          {{ loading ? t('auth.delete_account.deleting') : t('auth.delete_account.confirm_btn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式完全保持不变 */
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex; justify-content: center; align-items: center;
  z-index: 11000;
  backdrop-filter: blur(2px);
}

.delete-box {
  background: white;
  width: 90%; max-width: 400px;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  display: flex; flex-direction: column; gap: 20px;
}

@media (prefers-color-scheme: dark) {
  .delete-box { background: #2a2a2a; color: #e0e0e0; }
  .del-input { background: #333 !important; color: white !important; border-color: #555 !important; }
  .btn-cancel { background: #3a3a3c !important; color: #e0e0e0 !important; border-color: #555 !important; }
}
:global(.dark) .delete-box { background: #2a2a2a; color: #e0e0e0; }
:global(.dark) .del-input { background: #333 !important; color: white !important; border-color: #555 !important; }
:global(.dark) .btn-cancel { background: #3a3a3c !important; color: #e0e0e0 !important; border-color: #555 !important; }

.header {
  display: flex; justify-content: space-between; align-items: center;
}
.header h3 { margin: 0; font-size: 18px; font-weight: 600; }
.close-btn {
  background: none; border: none; font-size: 24px; cursor: pointer; color: #999; padding: 0;
}
.close-btn:hover { color: #666; }

.warning-text {
  font-size: 14px; line-height: 1.6; color: #666; margin-bottom: 20px;
}
:global(.dark) .warning-text { color: #aaa; }

.del-input {
  width: 100%; padding: 10px; margin-bottom: 12px;
  border: 1px solid #ddd; border-radius: 6px;
  font-size: 14px; outline: none; box-sizing: border-box;
}
.del-input:focus { border-color: #fca5a5; }

.footer {
  display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px;
}

.btn-cancel {
  padding: 8px 20px; border-radius: 6px; border: 1px solid #ddd;
  background: white; color: #333; cursor: pointer;
}
.btn-delete {
  padding: 8px 20px; border-radius: 6px; border: none;
  background: #fca5a5; color: white; cursor: pointer; font-weight: 500;
}
.btn-delete:hover { background: #f87171; }
.btn-delete:disabled { opacity: 0.7; cursor: not-allowed; }
</style>
