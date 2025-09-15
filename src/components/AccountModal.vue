<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
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
  // 父组件传进来的总数保留，但不再作为唯一来源；我们会在本组件内自行查询更准确的 count
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

// 在组件内部创建自己的状态
const journalingDays = ref(0)
const journalingYears = ref(0)
const journalingRemainderDays = ref(0)
const firstNoteDateText = ref<string | null>(null)

const hasFetched = ref(false) // 查询标记，确保只在第一次打开时查询
const isConfirmOpen = ref(false) // 退出确认框

// 本组件内实时查询的“笔记总数”
const totalCount = ref<number | null>(null)

// ===== 工具：格式化日期（中文：YYYY年M月D日）=====
function formatDateZH(d: Date) {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}年${m}月${day}日`
}

// ===== 查询：最早笔记 & 坚持年天 =====
async function fetchFirstNoteAndStreak() {
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

    if (data?.created_at) {
      const first = new Date(data.created_at)
      firstNoteDateText.value = formatDateZH(first)

      // 计算坚持年+天
      const today = new Date()
      // 去掉时间部分，按自然日计算
      first.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)

      // 先算满年的数量
      let years = today.getFullYear() - first.getFullYear()
      let anniversaryThisYear = new Date(first)
      anniversaryThisYear.setFullYear(first.getFullYear() + years)

      if (anniversaryThisYear > today) {
        years -= 1
        anniversaryThisYear = new Date(first)
        anniversaryThisYear.setFullYear(first.getFullYear() + years)
      }

      // 计算“剩余的天数”
      const diffMs = today.getTime() - anniversaryThisYear.getTime()
      const remainDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      journalingYears.value = Math.max(0, years)
      journalingRemainderDays.value = Math.max(0, remainDays)

      // 如果不足 1 年，journalingDays 作为兼容（旧显示）
      if (journalingYears.value === 0) {
        const diffTime = Math.abs(today.getTime() - first.getTime())
        journalingDays.value = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      }
    }
    else {
      // 没有任何笔记
      firstNoteDateText.value = null
      journalingYears.value = 0
      journalingRemainderDays.value = 0
      journalingDays.value = 0
    }
  }
  catch (err) {
    console.error('获取最早笔记日期失败:', err)
  }
}

// ===== 查询：笔记总数（使用 head+count 更快）=====
async function fetchNotesCount() {
  if (!props.user) {
    totalCount.value = 0
    return
  }
  try {
    const { count, error } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', props.user.id)

    if (error)
      throw error

    totalCount.value = typeof count === 'number' ? count : 0
  }
  catch (err) {
    console.error('获取笔记总数失败:', err)
    totalCount.value = props.totalNotes ?? 0 // 兜底使用父组件传值
  }
}

// 打开时执行一次查询（只在第一次打开时查）
watch(() => props.show, (visible) => {
  if (visible && !hasFetched.value) {
    fetchFirstNoteAndStreak()
    fetchNotesCount()
    hasFetched.value = true
  }
})

// ===== 登出确认 & 执行 =====
async function doSignOut() {
  try {
    await supabase.auth.signOut()
    // 直接跳转首页（不依赖父组件）
    window.location.assign('/')
  }
  catch (e) {
    // 即便失败也尝试刷新到首页
    window.location.assign('/')
  }
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
            <span class="info-value">{{ totalCount ?? '—' }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">第一条笔记创建于</span>
            <span class="info-value">{{ firstNoteDateText ?? '—' }}</span>
          </div>

          <div v-if="journalingYears > 0" class="info-item">
            <span class="info-label">您已坚持记录</span>
            <span class="info-value">{{ journalingYears }} 年 {{ journalingRemainderDays }} 天</span>
          </div>
          <div v-else class="info-item">
            <span class="info-label">您已坚持记录</span>
            <span class="info-value">{{ journalingDays }} 天</span>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary wide" @click="emit('close')">返回</button>
          <button class="wide btn-danger" @click="isConfirmOpen = true">登出</button>
        </div>

        <!-- 退出确认框 -->
        <div v-if="isConfirmOpen" class="confirm-overlay" @click.self="isConfirmOpen = false">
          <div class="confirm-dialog">
            <div class="confirm-title">确定要退出系统吗？</div>
            <div class="confirm-subtitle">登陆后要有密码重新登陆</div>
            <div class="confirm-actions">
              <button class="btn-secondary" @click="isConfirmOpen = false">取消</button>
              <button class="btn-danger" @click="doSignOut">确定</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
  max-width: 420px;
  position: relative;
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

.modal-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
  margin-top: 1.25rem;
}

.wide { width: 100%; }

.btn-secondary,
.btn-danger {
  display: inline-block;
  text-align: center;
  padding: 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  border: 1px solid transparent;
}

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border-color: #ccc;
}
.btn-secondary:hover { background-color: #e5e5e5; }
.dark .btn-secondary {
  background-color: #3a3a3c;
  color: #e0e0e0;
  border-color: #555;
}
.dark .btn-secondary:hover { background-color: #444; }

.btn-danger {
  background-color: #ef4444;
  color: #fff;
  border-color: #ef4444;
}
.btn-danger:hover { filter: brightness(0.95); }

/* 确认框 */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.confirm-dialog {
  background: #fff;
  color: #111;
  border-radius: 10px;
  width: 88%;
  max-width: 360px;
  padding: 1rem 1rem 0.85rem;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
}
.dark .confirm-dialog {
  background: #2a2a2a;
  color: #e0e0e0;
}
.confirm-title {
  font-size: 18px;
  font-weight: 600;
}
.confirm-subtitle {
  margin-top: 6px;
  font-size: 14px;
  color: #6b7280;
}
.dark .confirm-subtitle { color: #a3a3a3; }
.confirm-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
