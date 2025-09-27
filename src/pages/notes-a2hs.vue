<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/utils/supabaseClient'

const router = useRouter()

function setNotesManifest() {
  // 移除现有 manifest
  const old = document.querySelector('link[rel="manifest"]')
  if (old)
    old.parentNode?.removeChild(old)

  // 挂上“笔记专用 manifest”
  const link = document.createElement('link')
  link.setAttribute('rel', 'manifest')
  link.setAttribute('href', '/manifest-notes.webmanifest')
  document.head.appendChild(link)
}

function isStandalone() {
  // iOS Safari
  const ios = (navigator as any).standalone === true
  // PWA 通用
  const pwa = window.matchMedia?.('(display-mode: standalone)')?.matches === true
  return ios || pwa
}

onMounted(async () => {
  document.title = '我abc · 笔记'
  // ✅ 在浏览器里先切换成“笔记 manifest”，这样从本页添加图标 = 启动 /auth
  setNotesManifest()

  // 仅从桌面图标启动时才立即跳转；浏览器打开时不要跳（否则你没法在本页添加图标）
  if (isStandalone()) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session)
      router.replace('/auth')
    else router.replace({ path: '/auth', query: { from: 'notes-a2hs' } })
  }
})
</script>

<template>
  <!-- 引导用户在本页“添加到主屏幕” -->
  <div class="h-screen w-screen flex items-center justify-center px-6 text-center selection:bg-black/10 dark:selection:bg-white/10">
    <div>
      <div class="mb-3 text-3xl font-semibold">添加“我abc · 笔记”到主屏幕</div>
      <div class="leading-relaxed opacity-70">
        请点击浏览器底部的分享按钮，选择<strong>“添加到主屏幕”</strong>。<br>
        通过这个图标进入时，将直接打开笔记页。
      </div>
    </div>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
</style>
