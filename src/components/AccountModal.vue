<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import { useRouter } from 'vue-router'
import { supabase } from '@/utils/supabaseClient'

// 定义该组件可以从父组件接收的数据 (props)
const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  email: {
    type: String,
    default: '',
  },
  totalNotes: {
    type: Number,
    default: 0,
  },
  user: {
    type: Object as () => User | null,
    required: true,
  },
})

// 定义该组件可以向父组件发送的事件
const emit = defineEmits(['close'])

const { t } = useI18n()
const router = useRouter()

// 在组件内部创建自己的状态，用于存储记录天数 & 最早笔记日期
const journalingDays = ref(0)
const journalingDisplay = ref('') // 用于展示的格式化文字（X 年 Y 天 或 X 天）
const firstNoteDateStr = ref('') // “第一条笔记创建于”显示用
const hasFetched = ref(false) // 查询标记，确保只查询一次

// 登出相关
const confirmVisible = ref(false)
const loggingOut = ref(false)

function formatDateCN(date: Date) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${y}年${m}月${d}日`
}

// 获取最早笔记并计算天数的函数
async function fetchFirstNoteDate() {
  if (!props.user)
    return
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', props.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (error)
      throw error

    if (data && data.created_at) {
      const firstNoteDate = new Date(data.created_at)
      firstNoteDateStr.value = formatDateCN(firstNoteDate)

      const today = new Date()
      firstNoteDate.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)
      const diffTime = Math.abs(today.getTime() - firstNoteDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      journalingDays.value = diffDays + 1

      // 按“年 + 天”格式化：满一年显示“X 年 Y 天”，否则显示“X 天”
      if (journalingDays.value >= 365) {
        const years = Math.floor(journalingDays.value / 365)
        const days = journalingDays.value % 365
        journalingDisplay.value = days > 0 ? `${years} 年 ${days} 天` : `${years} 年`
      }
      else {
        journalingDisplay.value = `${journalingDays.value} 天`
      }
    }
    else {
      // 没有任何笔记时，清空显示
      firstNoteDateStr.value = ''
      journalingDays.value = 0
      journalingDisplay.value = ''
    }
  }
  catch (err) {
    console.error('获取最早笔记日期失败:', err)
  }
}

// 监听弹窗首次打开时拉取数据
watch(() => props.show, (newValue) => {
  if (newValue && !hasFetched.value) {
    fetchFirstNoteDate()
    hasFetched.value = true
  }
})

// —— 按钮：返回（等同右上角关闭）——
function handleBack() {
  emit('close')
}

// —— 按钮：登出（先弹确认框）——
function requestLogout() {
  confirmVisible.value = true
}

async function confirmLogout() {
  if (loggingOut.value)
    return
  loggingOut.value = true
  try {
    await supabase.auth.signOut()
  }
  finally {
    // 无论 signOut 成功与否，都尽量回首页
    try {
      await router.replace('/')
    }
    catch {
      window.location.assign('/')
    }
    loggingOut.value = false
  }
}

function cancelLogout() {
  confirmVisible.value = false
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">
            {{ t('auth.account_title') }}
          </h2>
          <button class="close-button" @click="emit('close')">
            &times;
          </button>
        </div>

        <div class="modal-body">
          <div class="info-item">
            <span class="info-label">{{ t('auth.account_email_label') }}</span>
            <span class="info-value">{{ email }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{ t('notes.total_notes') }}</span>
            <span class="info-value">{{ totalNotes }}</span>
          </div>

          <!-- 第一条笔记创建日期 -->
          <div v-if="firstNoteDateStr" class="info-item">
            <span class="info-label">第一条笔记创建于</span>
            <span class="info-value">{{ firstNoteDateStr }}</span>
          </div>

          <!-- 坚持天数（年+天 或 天） -->
          <div v-if="journalingDisplay" class="info-item">
            <span class="info-label">{{ t('notes.journaling_days_label') }}</span>
            <span class="info-value">{{ journalingDisplay }}</span>
          </div>
        </div>

        <!-- 新增：底部按钮区 -->
        <div class="modal-footer">
          <button type="button" class="btn-outline btn" @click="handleBack">返回</button>
          <button
            type="button"
            class="btn-primary-danger btn"
            :disabled="loggingOut"
            @click="requestLogout"
          >
            {{ loggingOut ? '正在登出…' : '登出' }}
          </button>
        </div>
      </div>

      <!-- 确认登出弹窗（本组件内部实现） -->
      <Transition name="fade">
        <div v-if="confirmVisible" class="confirm-overlay" @click.self="cancelLogout">
          <div class="confirm-card" role="dialog" aria-modal="true">
            <div class="confirm-title">确定要登出系统吗？</div>
            <div class="confirm-text">登出后需用密码重新登陆</div>
            <div class="confirm-actions">
              <button type="button" class="btn-outline btn" @click="cancelLogout">取消</button>
              <button
                type="button"
                class="btn-primary-danger btn"
                :disabled="loggingOut"
                @click="confirmLogout"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* 主弹窗 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 400px;
}
.dark .modal-content {
  background: #2a2a2a;
  color: #e0e0e0;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #eee;
}
.dark .modal-header {
  border-bottom-color: #444;
}

.modal-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.close-button {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: #888;
  padding: 0;
  line-height: 1;
}
.dark .close-button {
  color: #bbb;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
}

.info-label {
  color: #555;
  font-weight: 500;
}
.dark .info-label {
  color: #aaa;
}

.info-value {
  color: #111;
  font-weight: 500;
  background-color: #f0f0f0;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 16px;
  text-align: right;
  min-width: 80px;
}
.dark .info-value {
  background-color: #3a3a3c;
  color: #f0f0f0;
}

/* 底部按钮 */
.modal-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.btn {
  display: inline-block;
  text-align: center;
  padding: 0.7rem 0.9rem;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  border: none;
}

.btn-outline {
  background: transparent;
  border: 1px solid #d1d5db;
  color: #374151;
}
.btn-outline:hover { background: #f3f4f6; }
.dark .btn-outline {
  border-color: #4b5563;
  color: #e5e7eb;
}
.dark .btn-outline:hover { background: #374151; }

.btn-primary-danger {
  background: #ef4444;
  color: #fff;
}
.btn-primary-danger:hover { background: #dc2626; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* 二次确认弹窗 */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-card {
  width: 86%;
  max-width: 360px;
  background: #fff;
  color: #111;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  padding: 16px 16px 14px;
}
.dark .confirm-card {
  background: #2a2a2a;
  color: #e5e7eb;
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}
.confirm-text {
  font-size: 14px;
  color: #6b7280;
}
.dark .confirm-text { color: #9ca3af; }

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 14px;
}
</style>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
