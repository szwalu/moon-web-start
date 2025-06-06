<script setup lang="ts">
// ... (script部分与您提供的版本完全一致，此处省略) ...
import draggable from 'vuedraggable'
import type { Category } from '@/types'
import { useSettingStore } from '@/stores/setting'

const modalStore = useModalStore()
const siteStore = useSiteStore()
const route = useRoute()
const settingStore = useSettingStore()

const { draggableOptions, handleStart, handleEnd } = useDrag()

const activeSubMenuIndex = ref(-1)

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
</script>

<template>
  <section
    class="site-navbar-sidebar pb-12 text-16" :class="{ 'is-open': settingStore.isSideNavOpen }"
  >
    <div class="sidebar-logo-container flex items-center justify-center py-7 p-4">
      <img src="/logo.jpg" alt="Logo" class="w-auto h-40">
    </div>

    <draggable
      class="nav flex flex-grow flex-col gap-y-4 pt-4 p-2 md:gap-y-12 md:pt-10"
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

    <div class="static-links-container mb-4 flex flex-col gap-y-4 px-2 pb-2 pt-4">
      <a
        href="mailto:ming@woabc.com"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">网站提交</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>
      <a
        href="mailto:ming@woabc.com"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">友情链接</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>
      <a
        href="https://www.woabc.com/about.html"
        target="_blank"
        rel="noopener noreferrer"
        class="nav__item w-full flex items-center rounded-md py-1.5 pl-0.5 pr-1 transition-colors duration-200 hover:bg-[rgba(var(--primary-c-rgb),0.05)] hover:text-$primary-c"
        role="menuitem"
      >
        <span class="flex-grow truncate text-center">关于导航</span>
        <div class="chevron-placeholder h-[13px] w-[13px] flex-shrink-0" />
      </a>
    </div>

    <div v-if="settingStore.isSetting" class="mt-auto border-t border-$border-c p-2">
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
        添加分类
      </n-button>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* CSS部分与上一版完全一致，此处省略以保持简洁 */
.site-navbar-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 130px; /* 您设定的宽度 */
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
