// 文件位置: src/components/AccountModal.vue

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import { useDialog } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS } from '@/utils/cacheKeys'

const props = defineProps({
  show: { type: Boolean, required: true },
  email: { type: String, default: '' },
  // 父组件传进来的总数可作为兜底
  totalNotes: { type: Number, default: 0 },
  user: { type: Object as () => User | null, required: true },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const dialog = useDialog()

const journalingDays = ref(0)
const journalingYears = ref(0)
const journalingRemainderDays = ref(0)
const firstNoteDateText = ref<string | null>(null)

const hasFetched = ref(false)
const totalCount = ref<number | null>(null)

// 使用多语言的日期格式：{year}年{month}月{day}日
function formatDateI18n(d: Date) {
  return t('notes.account.date_format', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  })
}

// 查询：最早笔记 & 坚持年/天
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
      firstNoteDateText.value = formatDateI18n(first)

      const today = new Date()
      first.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)

      let years = today.getFullYear() - first.getFullYear()
      let anniversaryThisYear = new Date(first)
      anniversaryThisYear.setFullYear(first.getFullYear() + years)

      if (anniversaryThisYear > today) {
        years -= 1
        anniversaryThisYear = new Date(first)
        anniversaryThisYear.setFullYear(first.getFullYear() + years)
      }

      const diffMs = today.getTime() - anniversaryThisYear.getTime()
      const remainDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      journalingYears.value = Math.max(0, years)
      journalingRemainderDays.value = Math.max(0, remainDays)

      if (journalingYears.value === 0) {
        const diffTime = Math.abs(today.getTime() - first.getTime())
        // +1 让“同一天首次记录”也显示为 1 天
        journalingDays.value = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      }
    }
    else {
      firstNoteDateText.value = null
      journalingYears.value = 0
      journalingRemainderDays.value = 0
      journalingDays.value = 0
    }
  }
  catch (err) {
    console.error(t('notes.account.errors.fetch_first_note_failed'), err)
  }
}

// 查询：笔记总数（head+count）
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
    console.error(t('notes.account.errors.fetch_notes_count_failed'), err)
    totalCount.value = props.totalNotes ?? 0
  }
}

// 打开弹窗后首次查询
watch(() => props.show, (visible) => {
  if (visible && !hasFetched.value) {
    fetchFirstNoteAndStreak()
    fetchNotesCount()
    hasFetched.value = true
  }
})

// 登出确认（Naive UI）
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

// 执行登出并清理缓存
async function doSignOut() {
  try {
    await supabase.auth.signOut()

    // 清理本地缓存
    localStorage.removeItem('last_known_user_id_v1')
    localStorage.removeItem('pinned_tags_v1')
    localStorage.removeItem('tag_icons_v1')
    localStorage.removeItem(CACHE_KEYS.HOME)
    localStorage.removeItem(CACHE_KEYS.HOME_META)
    localStorage.removeItem('new_note_content_draft')

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(CACHE_KEYS.TAG_PREFIX) || key.startsWith(CACHE_KEYS.SEARCH_PREFIX))
        localStorage.removeItem(key)
    })

    // 跳转首页，重置应用状态
    window.location.assign('/')
  }
  catch (e) {
    console.error(t('notes.account.errors.signout_failed'), e)
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
            {{ t('notes.account.title') }}
          </h2>
          <button class="close-button" @click="emit('close')">
            &times;
          </button>
        </div>

        <div class="modal-body">
          <div class="info-item">
            <span class="info-label">{{ t('notes.account.email_label') }}</span>
            <span class="info-value">{{ email }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('notes.total_notes') }}</span>
            <span class="info-value">{{ totalCount ?? '—' }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('notes.account.first_note_created_at') }}</span>
            <span class="info-value">{{ firstNoteDateText ?? '—' }}</span>
          </div>

          <div v-if="journalingYears > 0" class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">
              {{ t('notes.account.streak_years_days', { years: journalingYears, days: journalingRemainderDays }) }}
            </span>
          </div>
          <div v-else class="info-item">
            <span class="info-label">{{ t('notes.account.streak_title') }}</span>
            <span class="info-value">
              {{ t('notes.account.streak_days_only', { days: journalingDays }) }}
            </span>
          </div>
        </div>

        <div class="modal-footer">
          <a href="/" class="btn-green">{{ t('notes.account.go_to_site') }}</a>
          <button class="btn-grey" @click="openLogoutConfirm">
            {{ t('notes.account.logout') }}
          </button>
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
  font-size: 18px;
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
  font-size: 14px;
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
  font-size: 14px;
  text-align: right;
  min-width: 80px;
}
.dark .info-value {
  background-color: #3a3a3c;
  color: #f0f0f0;
}

.modal-footer {
  display: grid;
  grid-template-columns: 5fr 1fr; /* 按 5:1 比例分配 */
  gap: 0.9rem;
  margin-top: 1.25rem;
}

.btn-green {
  display: inline-block;    /* 让 a 标签表现得像按钮 */
  text-decoration: none;    /* 去掉默认下划线 */
  text-align: center;       /* 文字居中 */
  width: 100%;              /* 在 5:1 的网格下占满所在列 */
  background-color: #00b386;
  color: #fff;
  border-radius: 6px;
  padding: 0.8rem;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-green:hover {
  background-color: #009a74;
}

.btn-grey {
  background-color: #f0f0f0; /* 灰色次级 */
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 0.8rem;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-grey:hover {
  background-color: #e5e5e5;
}
.dark .btn-grey {
  background-color: #3a3a3c;
  color: #e0e0e0;
  border-color: #555;
}
.dark .btn-grey:hover {
  background-color: #444;
}

.btn-danger {
  background-color: #ef4444;
  color: #fff;
  border-color: #ef4444;
}
.btn-danger:hover { filter: brightness(0.95); }

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
