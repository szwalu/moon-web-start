<script setup lang="ts">
import draggable from 'vuedraggable'
import { onMounted, ref } from 'vue'
import type { Category } from '@/types'
import { useSettingStore } from '@/stores/setting'

// 增加登陆按钮

import { supabase } from '@/utils/supabaseClient'

const modalStore = useModalStore()
const siteStore = useSiteStore()
const route = useRoute()
const settingStore = useSettingStore()

const { draggableOptions, handleStart, handleEnd } = useDrag()

const activeSubMenuIndex = ref(-1)

const isMobile = ref(false)

onMounted(() => {
  // 检查初始状态
  isMobile.value = window.innerWidth <= 768
  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

function checkIsMobileDevice(): boolean {
  if (typeof navigator !== 'undefined')
    return /Mobi|Android|iPhone/i.test(navigator.userAgent)

  return false
}

function handleCateClick(cateIndex: number) {
  if (route.name === 'setting' && siteStore.cateIndex === cateIndex) {
    modalStore.showModal('update', 'cate')
    return
  }
  siteStore.setCateIndex(cateIndex)

  const clickedCate = siteStore.data[cateIndex]
  if (clickedCate.groupList && clickedCate.groupList.length > 0) {
    if (activeSubMenuIndex.value === cateIndex)
      activeSubMenuIndex.value = -1

    else
      activeSubMenuIndex.value = cateIndex
  }
  else {
    activeSubMenuIndex.value = -1
  }
}

const subMenuRows = computed(() => {
  if (activeSubMenuIndex.value < 0 || activeSubMenuIndex.value >= siteStore.data.length)
    return []
  const activeCate = siteStore.data[activeSubMenuIndex.value]
  if (!activeCate || !activeCate.groupList || !activeCate.groupList.length)
    return []
  return [activeCate.groupList]
})

function handleSubMenuClick(subItem: any) {
  const element = document.getElementById(String(subItem.id))
  if (element) {
    const headerElement = document.querySelector('[sticky]')
    const headerHeight = headerElement ? headerElement.clientHeight : 80
    const elementPosition = element.getBoundingClientRect().top
    const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 10
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    })
  }
  if (checkIsMobileDevice()) {
    activeSubMenuIndex.value = -1
    settingStore.toggleSideNav()
  }
}

// 创建一个本地的响应式变量来存储用户状态
const user = ref<any>(null)

// 在组件挂载后，设置一个监听器来实时更新用户状态
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})
</script>

<template>
  <section
    class="site-navbar-sidebar pb-12 text-16" :class="{ 'is-open': settingStore.isSideNavOpen }"
  >
    <div v-if="!isMobile || (isMobile && settingStore.isSideNavOpen)" class="sidebar-logo-container flex items-center justify-center py-7 p-4">
      <img src="/logo.jpg" alt="Logo" class="w-auto h-40">
    </div>

    <draggable
      class="nav flex flex-col gap-y-20 pb-8 pt-16 p-2" :list="siteStore.data"
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
            cursor-pointer rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200
            @click="handleCateClick(i)"
          >
            <span class="flex-grow truncate text-center">{{ cate.name }}</span>
            <div
              v-if="cate.groupList && cate.groupList.length > 0"
              class="chevron-icon ml-0.5 flex-shrink-0"
              i-carbon-chevron-right text-13 transition-transform duration-300
              :class="{ 'rotate-90': activeSubMenuIndex === i }"
            />
            <div v-else class="chevron-placeholder flex-shrink-0" />
          </div>
          <transition name="slide-fade-vertical">
            <div v-if="activeSubMenuIndex === i && subMenuRows.length > 0" class="sub-nav-container-vertical mt-1.5 py-1 pl-3 pr-1">
              <div
                v-for="subItem in subMenuRows[0]" :key="subItem.id"
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
        <template #icon>
          <div i-carbon:add />
        </template>
        {{ $t('button.addCategory') }}
      </n-button>
    </div>
    <div class="divider mx-4 border-t border-gray-200 dark:border-gray-700" />

    <div class="static-links-container flex flex-col gap-y-20 px-2 pb-4 pt-8">
      <a
        href="https://www.woabc.com/apply"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
        target="_blank"
      >
        <span class="flex-grow truncate text-center">{{ $t('navbar.apply') }}</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>
      <a
        href="https://www.woabc.com/apply"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
        target="_blank"
      >
        <span class="flex-grow truncate text-center">{{ $t('navbar.links') }}</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>
      <a
        href="https://www.woabc.com/about"
        target="_blank"
        rel="noopener noreferrer"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">{{ $t('navbar.about') }}</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>

      <router-link
        v-if="!user"
        to="/auth"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">{{ $t('navbar.auth') }}</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </router-link>

      <router-link
        v-else
        to="/auth"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">{{ $t('navbar.account') }}</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </router-link>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* 所有CSS部分与您提供的版本完全一致，无需修改 */
.site-navbar-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 130px;
  height: 100vh;
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
}
.site-navbar-sidebar::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.site-navbar-sidebar.is-open {
  transform: translateX(0);
}
.sidebar-logo-container img {
  max-width: 90%;
  object-fit: contain;
}
.nav {
  /* 移除了 flex-grow，让它只占据内容所需高度 */
  &::-webkit-scrollbar {
    display: none;
  }
}
.nav__item {
  position: relative;
  span {
    display: inline-block;
  }
  &::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 0%;
    border-radius: 1.5px;
    background-color: var(--primary-c);
    transition: height 0.2s ease-in-out, background-color 0.2s ease-in-out;
  }
  &--active {
    color: var(--primary-c);
    &::after {
      height: 70%;
    }
  }
  &:not(.nav__item--active):hover {
    background-color: rgba(var(--primary-c-rgb), 0.05);
    color: var(--primary-c);
  }
}
.chevron-icon, .chevron-placeholder {
  width: 13px;
  height: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sub-nav-container-vertical {
  /* Spacing classes are in the template */
}
.sub-nav-item-vertical {
  padding: 5px 6px;
  font-size: 0.9em;
  color: var(--text-c-2);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
  text-align: center;
  display: block;
  width: 100%;

  &:hover {
    background-color: rgba(var(--primary-c-rgb), 0.08);
    color: var(--primary-c);
  }
}
.slide-fade-vertical-enter-active,
.slide-fade-vertical-leave-active {
  transition: all 0.25s ease-out;
  max-height: 200px;
}
.slide-fade-vertical-enter-from,
.slide-fade-vertical-leave-to {
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transform: translateY(-10px);
}
</style>
