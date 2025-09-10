<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits(['toggleView'])
const { t } = useI18n()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

const anniversaryNotes = ref<any[]>([])
const isLoading = ref(true)
const isAnniversaryViewActive = ref(false)

// 缓存 Key 不再需要日期，因为数据库函数总会返回当天的结果
const CACHE_KEY = `anniversary_notes_${user.value!.id}`

async function loadAnniversaryNotes() {
  isLoading.value = true
  try {
    const cachedData = localStorage.getItem(CACHE_KEY)
    if (cachedData) {
      anniversaryNotes.value = JSON.parse(cachedData)
    }
    else {
      // 调用我们在 Supabase 中创建的数据库函数
      const { data, error } = await supabase.rpc('get_anniversary_notes', {
        p_user_id: user.value!.id,
      })

      if (error)
        throw error

      // 按时间倒序排序
      anniversaryNotes.value = data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // 缓存今天的结果
      localStorage.setItem(CACHE_KEY, JSON.stringify(anniversaryNotes.value))

      // 清理其他可能的旧缓存
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('anniversary_notes_') && key !== CACHE_KEY)
          localStorage.removeItem(key)
      })
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
  emit('toggleView', isAnniversaryViewActive.value ? anniversaryNotes.value : null)
}

function setView(isActive: boolean) {
  isAnniversaryViewActive.value = isActive
}

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
