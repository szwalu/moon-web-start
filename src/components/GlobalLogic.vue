<script setup lang="ts">
import { onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import { useAutoSave } from '@/composables/useAutoSave'

// 1. 在这里，我们处于 Provider 的“内部”，可以安全地调用 useMessage()
const message = useMessage()

// 2. 将 message 对象传递给我们的自动保存逻辑
const { autoLoadData, startWatching, supabase } = useAutoSave(message)

// 3. 在这里执行所有应用启动时的逻辑
onMounted(() => {
  startWatching()

  supabase.auth.onAuthStateChange(async (event, _session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      autoLoadData()
  })
})
</script>

<template>
  <div />
</template>
