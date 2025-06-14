<script setup lang="ts">
import { onMounted } from 'vue'
import { useAutoSave } from '@/composables/useAutoSave'
import { supabase } from '@/utils/supabaseClient'

onMounted(() => {
  // 不再需要 useMessage，直接调用 useAutoSave
  const { autoLoadData, startWatching } = useAutoSave()

  startWatching()

  supabase.auth.onAuthStateChange(async (event, session) => {
    // 只要用户登录了，就尝试加载一次数据
    if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))
      await autoLoadData()
  })
})
</script>

<template>
  <div />
</template>
