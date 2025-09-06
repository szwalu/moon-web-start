<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from 'vue-i18n'

// 1. 引入 useI18n
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits(['toggleView'])

const { t } = useI18n() // 2. 初始化 t 函数
const authStore = useAuthStore()
const user = computed(() => authStore.user)

const anniversaryNotes = ref<any[]>([])
const isLoading = ref(true)
const isAnniversaryViewActive = ref(false)

const CACHE_KEY_PREFIX = 'anniversary_notes_'

async function loadAnniversaryNotes() {
  isLoading.value = true
  const today = new Date()
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const cacheKey = `${CACHE_KEY_PREFIX}${user.value!.id}_${todayString}`

  try {
    const cachedData = localStorage.getItem(cacheKey)
    if (cachedData) {
      anniversaryNotes.value = JSON.parse(cachedData)
    }
    else {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', user.value!.id)

      if (error)
        throw error

      if (data) {
        const currentYear = today.getFullYear() // 获取当前年份
        const currentMonth = today.getMonth()
        const currentDay = today.getDate()

        const filtered = data.filter((note) => {
          const noteDate = new Date(note.created_at)
          // 核心修改：增加年份不等于今年的判断
          return noteDate.getMonth() === currentMonth
                 && noteDate.getDate() === currentDay
                 && noteDate.getFullYear() !== currentYear
        })

        anniversaryNotes.value = filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        localStorage.setItem(cacheKey, JSON.stringify(anniversaryNotes.value))

        // 清理旧的缓存
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(CACHE_KEY_PREFIX) && key !== cacheKey)
            localStorage.removeItem(key)
        })
      }
    }
  }
  catch (err) {
    console.error('获取那年今日笔记失败:', err)
  }
  finally {
    isLoading.value = false
  }
}

function handleBannerClick() {
  if (anniversaryNotes.value.length === 0)
    return

  isAnniversaryViewActive.value = !isAnniversaryViewActive.value
  if (isAnniversaryViewActive.value)
    emit('toggleView', anniversaryNotes.value)
  else
    emit('toggleView', null)
}

function setView(isActive: boolean) {
  isAnniversaryViewActive.value = isActive
}

// 将 setView 和 loadAnniversaryNotes 方法都暴露给父组件
defineExpose({
  setView,
  loadAnniversaryNotes,
})
</script>

<template>
  <div v-if="!isLoading && anniversaryNotes.length > 0" class="anniversary-banner" @click="handleBannerClick">
    <span v-if="isAnniversaryViewActive">
      {{ t('notes.anniversary_total', { count: anniversaryNotes.length }) }}
    </span>
    <span v-else>
      {{ t('notes.anniversary_found', { count: anniversaryNotes.length }) }}
    </span>
  </div>
</template>

<style scoped>
.anniversary-banner {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 1rem;
  transition: all 0.2s ease-in-out;
}
.anniversary-banner:hover {
  background-color: #e0e7ff;
  transform: translateY(-1px);
}
.dark .anniversary-banner {
  background-color: #312e81;
  color: #c7d2fe;
}
.dark .anniversary-banner:hover {
  background-color: #3730a3;
}
</style>
