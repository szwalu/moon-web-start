<script setup lang="ts">
import { ref } from 'vue'

const host = ref('google.com')
</script>

<template>
  <div class="p-4 space-y-4">
    <h2 class="text-lg font-bold">Favicon 测试器</h2>

    <!-- 输入域名 -->
    <input
      v-model="host"
      type="text"
      placeholder="请输入域名，如 google.com"
      class="border rounded p-2 w-64"
    >

    <!-- 显示图标 -->
    <div v-if="host" class="flex items-center space-x-2">
      <img
        :src="`/api/get-favicon?host=${host}`"
        alt="favicon"
        class="h-8 w-8"
      >
      <span class="text-sm text-gray-600">/api/get-favicon?host={{ host }}</span>
    </div>
  </div>
</template>
