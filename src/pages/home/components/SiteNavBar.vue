<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Category } from '@/types'
import { useSettingStore } from '@/stores/setting'

// 这些路径按你项目实际，如不同请改回原路径
import { useModalStore } from '@/stores/modal'
import { useSiteStore } from '@/stores/site'

// 增加登陆按钮。
import { supabase } from '@/utils/supabaseClient'

const modalStore = useModalStore()
const siteStore = useSiteStore()
const route = useRoute()
const settingStore = useSettingStore()

const activeSubMenuIndex = ref(-1)
const isMobile = ref(false)

function closeSideNav() {
  activeSubMenuIndex.value = -1
  settingStore.isSideNavOpen = false
}

const draggableOptions = {
  animation: 200,
  forceFallback: true,
  ghostClass: 'dragging',
  chosenClass: 'drag-chosen',
  dragClass: 'drag-dragging',
}
function handleStart() {}
function handleEnd() {}

onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

watch(
  () => settingStore.isSideNavOpen,
  (open) => {
    const root = document.body
    if (open)
      root.classList.add('side-nav-open')
    else
      root.classList.remove('side-nav-open')
  },
  { immediate: true },
)

function handleCateClick(cateIndex: number) {
  if (route.name === 'setting' && siteStore.cateIndex === cateIndex) {
    modalStore.showModal('update', 'cate')
    return
  }
  siteStore.setCateIndex(cateIndex)

  const clickedCate = siteStore.data[cateIndex]
  if (clickedCate.groupList && clickedCate.groupList.length > 0)
    activeSubMenuIndex.value = activeSubMenuIndex.value === cateIndex ? -1 : cateIndex

  else
    activeSubMenuIndex.value = -1
}

const subMenuRows = computed(() => {
  if (activeSubMenuIndex.value < 0 || activeSubMenuIndex.value >= siteStore.data.length)
    return []
  const activeCate = siteStore.data[activeSubMenuIndex.value]
  return activeCate?.groupList?.length ? [activeCate.groupList] : []
})

function handleSubMenuClick(subItem: any) {
  const element = document.getElementById(String(subItem.id))
  if (element) {
    const headerElement = document.querySelector('[sticky]')
    const headerHeight = headerElement ? (headerElement as HTMLElement).clientHeight : 80
    const elementPosition = element.getBoundingClientRect().top
    const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 10
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' })
  }
  requestAnimationFrame(() => closeSideNav())
}

const user = ref<any>(null)
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})
</script>

<template>
  <section
    class="site-navbar-sidebar pb-12 text-16"
    :class="{ 'is-open': settingStore.isSideNavOpen }"
  >
    <div
      v-if="!isMobile || (isMobile && settingStore.isSideNavOpen)"
      class="sidebar-logo-container flex items-center justify-center pt-2 p-4"
    >
      <img src="/logo.jpg" alt="Logo" class="w-auto h-40">
    </div>

    <draggable
      class="nav flex flex-col gap-y-20 pb-8 pt-16 p-2"
      :list="siteStore.data"
      item-key="id"
      tag="div"
      v-bind="draggableOptions"
      @start="handleStart"
      @end="handleEnd"
    >
      <template #item="{ element: cate, index: i }: { element: Category, index: number }">
        <div :key="cate.id" class="nav-item-wrapper">
          <div
            class="dragging nav__item w-full flex items-center gap-x-0"
            :class="{
              'hover:text-$primary-c': !settingStore.isSetting,
              'nav__item--active': siteStore.cateIndex === i && activeSubMenuIndex === -1,
            }"
            cursor-pointer
            rounded-md
            py-1.5
            pl-0.5
            pr-1
            transition-colors
            duration-200
            @click="handleCateClick(i)"
          >
            <span class="flex-grow truncate text-center">{{ cate.name }}</span>
            <div
              v-if="cate.groupList?.length"
              class="chevron-icon ml-0.5 flex-shrink-0"
              i-carbon-chevron-right
              text-13
              transition-transform
              duration-300
              :class="{ 'rotate-90': activeSubMenuIndex === i }"
            />
            <div v-else class="chevron-placeholder flex-shrink-0" />
          </div>

          <transition name="slide-fade-vertical">
            <div
              v-if="activeSubMenuIndex === i && subMenuRows.length"
              class="sub-nav-container-vertical mt-1.5 py-1 pl-3 pr-1"
            >
              <div
                v-for="subItem in subMenuRows[0]"
                :key="subItem.id"
                class="sub-nav-item-vertical"
                @click="handleSubMenuClick(subItem)"
              >
                {{ subItem.name }}
              </div>
            </div>
          </transition>
        </div>
      </template>
    </draggable>

    <div v-if="settingStore.isSetting" class="p-4">
      <n-button
        type="primary"
        size="small"
        :focusable="false"
        secondary
        block
        @click="modalStore.showModal('add', 'cate')"
      >
        <template #icon><div i-carbon:add /></template>
        {{ $t('button.addCategory') }}
      </n-button>
    </div>
    <div class="divider mx-4 border-t border-gray-200 dark:border-gray-700" />

    <div class="static-links-container flex flex-col gap-y-15 px-2 pb-4 pt-8">
      <router-link to="/auth" class="nav__item" @click="closeSideNav">
        <span class="flex-grow truncate text-center">{{ $t('navbar.cloud_Notes') }}</span>
      </router-link>

      <router-link v-if="!user" to="/auth" class="nav__item" @click="closeSideNav">
        <span class="flex-grow truncate text-center">{{ $t('navbar.auth') }}</span>
      </router-link>
      <router-link v-else to="/my-account" class="nav__item" @click="closeSideNav">
        <span class="flex-grow truncate text-center">{{ $t('navbar.account') }}</span>
      </router-link>

      <a href="https://www.woabc.com/apply" target="_blank" class="nav__item">
        <span class="flex-grow truncate text-center">{{ $t('navbar.apply') }}</span>
      </a>
      <a href="https://www.woabc.com/apply" target="_blank" class="nav__item">
        <span class="flex-grow truncate text-center">{{ $t('navbar.links') }}</span>
      </a>
      <a href="https://www.woabc.com/about" target="_blank" class="nav__item">
        <span class="flex-grow truncate text-center">{{ $t('navbar.about') }}</span>
      </a>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.site-navbar-sidebar {
  padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
  overflow-anchor: none;
  position: fixed;
  top: 0; /* 顶到最上，避免左上缺口 */
  bottom: 0;
  left: 0;
  width: 130px;
  height: auto;
  background-color: var(--main-bg-c);
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.07);
  transform: translateX(-100%);
  transition: transform 0.3s ease-in-out;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
}
.site-navbar-sidebar.is-open { transform: translateX(0); }
.site-navbar-sidebar::-webkit-scrollbar { width: 0; height: 0; }
.sidebar-logo-container img { max-width: 90%; object-fit: contain; }

.nav__item {
  display: flex;
  align-items: center;
  padding: 6px;
  border-radius: 4px;
  transition: background-color 0.2s;
}
.nav__item:hover { background: rgba(var(--primary-c-rgb), 0.05); color: var(--primary-c); }

.sub-nav-item-vertical {
  padding: 5px 6px;
  font-size: 0.9em;
  border-radius: 4px;
  text-align: center;
}
.sub-nav-item-vertical:hover {
  background-color: rgba(var(--primary-c-rgb), 0.08);
  color: var(--primary-c);
}

/* 仅在触屏设备（手机/平板）锁背景滚动；桌面端正常滚动 */
@media (hover: none) and (pointer: coarse) {
  :global(body.side-nav-open) {
    overflow: hidden;
    overscroll-behavior: contain;
  }
}

/* 桌面端显式解锁，避免任何意外样式覆盖 */
@media (hover: hover) and (pointer: fine) {
  :global(body.side-nav-open) {
    overflow: visible;
  }
}
</style>
