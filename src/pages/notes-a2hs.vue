<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()

onMounted(async () => {
  // 给桌面图标一个易识别的标题
  document.title = '我abc · 笔记'

  // 读取会话
  const { data: { session } } = await supabase.auth.getSession()

  // 已登录：直达笔记主页；未登录：跳到登录页（你的 /auth 同时也是笔记页）
  if (session) {
    router.replace('/auth')
  }
  else {
    // 带个来源标记，后续若需更智能的登录后回跳，可用到该参数
    router.replace({ path: '/auth', query: { from: 'notes-a2hs' } })
  }
})
</script>

<template>
  <!-- 占位空壳页：用于被“添加到主屏幕”成为二级图标 -->
  <div class="h-screen w-screen" />
</template>

<style>
/* 防止个别环境下出现空白闪烁时的滚动条 */
html, body, #app { height: 100%; margin: 0; }
</style>

<!--
使用说明（iOS）：
1. 打开 https://www.woabc.com/notes-a2hs
2. 使用 Safari 的“添加到主屏幕”
3. 新生成的图标名为“我abc · 笔记”，点击即可直达 /auth（已登录）或进入登录
-->
