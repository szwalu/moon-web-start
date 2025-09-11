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

// 在 AnniversaryBanner.vue 中

async function loadAnniversaryNotes() {
  isLoading.value = true;
  try {
    // 尝试从缓存读取数据，直接使用字符串
    const cachedData = localStorage.getItem(`anniversary_notes_${user.value!.id}`);
    
    if (cachedData) {
      // 如果缓存中有数据，则直接使用
      anniversaryNotes.value = JSON.parse(cachedData);
    } else {
      // 如果缓存中没有，才从服务器获取
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const clientDateString = `${year}-${month}-${day}`;

      const { data, error } = await supabase.rpc('get_anniversary_notes_for_date', {
        p_user_id: user.value!.id,
        p_client_date: clientDateString,
        p_timezone: userTimezone
      });

      if (error) {
        throw error;
      }
      
      anniversaryNotes.value = data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created.at).getTime());
      
      // 将新数据存入缓存，直接使用字符串
      localStorage.setItem(`anniversary_notes_${user.value!.id}`, JSON.stringify(anniversaryNotes.value));

      // 清理旧的缓存
      Object.keys(localStorage).forEach((key) => {
        const cacheKeyString = `anniversary_notes_${user.value!.id}`;
        if (key.startsWith('anniversary_notes_') && key !== cacheKeyString) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch (err) {
    console.error('获取那年今日笔记失败:', err);
  } finally {
    isLoading.value = false;
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
