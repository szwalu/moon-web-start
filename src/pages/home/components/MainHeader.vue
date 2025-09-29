<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()

const isMobile = ref(false)
const isMobileSafari = ref(false)

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

function detectMobileSafari() {
  const ua = navigator.userAgent
  const isiOS
    = /iP(hone|od|ad)/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  const isSafari
    = /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Mercury)/.test(ua)
  return isiOS && isSafari
}

/**
 * 在 setup 同步阶段就设置默认状态，避免 iOS Safari 首帧“先开再关”：
 * - PC：默认打开
 * - 其它移动端：默认关闭
 * - iOS Safari：强制关闭
 * 同时在首帧禁用过渡，mounted 后恢复。
 */
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-booting', '1')

  isMobileSafari.value = detectMobileSafari()
  updateIsMobile()

  if (isMobileSafari.value)
    settingStore.isSideNavOpen = false
  else
    settingStore.isSideNavOpen = !isMobile.value
}

onMounted(() => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

// ✅ iOS Safari 聚焦输入时，阻止默认把目标“顶到页面最上方”——改为就近可见
if (isMobileSafari.value) {
  const onFocusIn = (e: Event) => {
    const t = e.target as HTMLElement | null
    if (!t)
      return
    const isEditable
      = t instanceof HTMLInputElement
      || t instanceof HTMLTextAreaElement
      || t.getAttribute('contenteditable') === 'true'
      || t.getAttribute('role') === 'searchbox'
    if (!isEditable)
      return

    // 让浏览器先完成自身的滚动，再在下一帧“拉回到就近位置”，避免被塞进刘海
    requestAnimationFrame(() => {
      try {
        t.scrollIntoView({ block: 'nearest', inline: 'nearest' /* behavior: 'instant' 默认即可 */ })
      }
      catch {}
    })
  }
  document.addEventListener('focusin', onFocusIn, { passive: true })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', onFocusIn as any)
  })
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
})

const user = ref<any>(null)
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})

const logoPath = ref('/logow.jpg')
onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session)
    logoPath.value = '/logo.jpg'
})

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}

async function handleSettingsClick() {
  await manualSaveData()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session) {
    setTimeout(() => {
      loadRemoteDataOnceAndMergeToLocal()
    }, 2500)
  }
  else {
    const hasLoggedInBefore = localStorage.getItem('hasLoggedInBefore')
    if (hasLoggedInBefore) {
      // $message.warning(t('auth.please_login'))
    }
  }

  router.push('/setting')
}
</script>

<template>
  <div
    class="flex items-center justify-between px-4 lg:px-8 md:px-6"
    :style="safeTopStyle"
  >
    <div class="header-left flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />
      <RouterLink v-if="isMobile && !settingStore.isSideNavOpen" to="/auth">
        <img
          :src="logoPath"
          alt="Logo"
          class="w-auto h-32"
        >
      </RouterLink>
    </div>

    <div class="flex items-center gap-x-11">
      <RouterLink
        v-if="settingStore.isSetting"
        class="text-7xl"
        :class="[getIconClass('home')]"
        to="/"
        i-carbon:home
        icon-btn
      />
      <div
        v-else
        class="text-7xl"
        i-carbon:settings
        icon-btn
        @click="handleSettingsClick"
      />
      <div
        class="text-7xl"
        i-carbon:moon
        dark:i-carbon:light
        icon-btn
        @click="() => toggleDark()"
      />
    </div>
  </div>
</template>

<style scoped>
/* 可选：如果你的侧栏/遮罩类名是 .SideNav / .SideNavOverlay，可以用下面这段消除首帧过渡 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}

/* ✅ 自动滚动时预留顶部安全区 + 你原有的 8px；不改变静态布局 */
:global(html),
:global(body) {
  scroll-padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
}
@supports (padding: constant(safe-area-inset-top)) {
  :global(html),
  :global(body) {
    scroll-padding-top: calc(constant(safe-area-inset-top) + 8px);
  }
}

/* ✅ 只影响自动滚动：常见输入控件给出上边距，避免对齐到“刘海下方” */
:global(input[type="search"]),
:global(input[type="text"]),
:global(textarea),
:global([contenteditable="true"]),
:global([role="searchbox"]) {
  scroll-margin-top: calc(env(safe-area-inset-top, 0px) + 8px);
}
@supports (padding: constant(safe-area-inset-top)) {
  :global(input[type="search"]),
  :global(input[type="text"]),
  :global(textarea),
  :global([contenteditable="true"]),
  :global([role="searchbox"]) {
    scroll-margin-top: calc(constant(safe-area-inset-top) + 8px);
  }
}

/* ✅ 防止 iOS 的“滚动锚定”在动态高度变动时把视口猛地回拉产生跳动 */
.header-left {
  overflow-anchor: none;
}
</style>
