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

// 在组件内部创建自己的状态，用于存储记录天数 & 最早笔记日期
const journalingDays = ref(0)
const journalingDisplay = ref('') // 用于展示的格式化文字
const firstNoteDateStr = ref('') // “第一条笔记创建于”显示用
const hasFetched = ref(false) // 查询标记，确保只查询一次

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

      // === 新增：格式化成 年 + 天 ===
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

// 使用 watch 监听弹窗的显示状态
watch(() => props.show, (newValue) => {
  if (newValue && !hasFetched.value) {
    fetchFirstNoteDate()
    hasFetched.value = true
  }
})
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

          <!-- 新增：第一条笔记创建日期 -->
          <div v-if="firstNoteDateStr" class="info-item">
            <span class="info-label">第一条笔记创建于</span>
            <span class="info-value">{{ firstNoteDateStr }}</span>
          </div>

          <!-- 修改：天数改为 年+天 格式 -->
          <div v-if="journalingDisplay" class="info-item">
            <span class="info-label">{{ t('notes.journaling_days_label') }}</span>
            <span class="info-value">{{ journalingDisplay }}</span>
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
  margin-bottom: 1.5rem;
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
  gap: 1.25rem;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
