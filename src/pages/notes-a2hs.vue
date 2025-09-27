<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()
const isStandalone = ref(false)

function detectStandalone() {
  // iOS Safari
  const iosStandalone = (window as any).navigator?.standalone === true
  // PWA 通用
  const pwaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true
  return iosStandalone || pwaStandalone
}

onMounted(async () => {
  document.title = '我abc · 笔记'
  isStandalone.value = detectStandalone()

  // 记一个“入口标记”，用于兜底纠偏（见 main.ts 里的补丁）
  try {
    localStorage.setItem('a2hs_entry', 'notes')
  }
  catch {}

  if (isStandalone.value) {
    // ✅ 只有从桌面图标启动时才做重定向逻辑
    const { data: { session } } = await supabase.auth.getSession()
    if (session)
      router.replace('/auth')
    else
      router.replace({ path: '/auth', query: { from: 'notes-a2hs' } })
  }
  // ⚠️ 在浏览器里（非 standalone）不跳转，这样你就能在 /notes-a2hs 这个URL上“添加到主屏幕”
})
</script>

<template>
  <!-- 浏览器里展示一页极简提示，引导用户添加到主屏幕；从桌面图标启动时几乎看不到这个页面 -->
  <div class="h-screen w-screen flex items-center justify-center px-6 text-center selection:bg-black/10 dark:selection:bg-white/10">
    <div>
      <div class="mb-3 text-3xl font-semibold">添加“我abc · 笔记”到主屏幕</div>
      <div class="leading-relaxed opacity-70">
        请点击浏览器底部的分享按钮，选择
        <strong>“添加到主屏幕”</strong>。添加后，从桌面图标进入将自动打开笔记页。
      </div>
    </div>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
</style>
