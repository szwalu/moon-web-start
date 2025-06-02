<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref } from 'vue'
import type { Category } from '@/types'

const modalStore = useModalStore()
const siteStore = useSiteStore()
const route = useRoute()
const settingStore = useSettingStore()

const activeSubMenuIndex = ref(-1)

// 用于存放延迟关闭菜单的计时器ID
const leaveTimer = ref<number | null>(null)

// 当鼠标进入整个导航组件区域时
function handleNavEnter() {
  // 如果存在关闭菜单的计时器，则清除它，阻止菜单关闭
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
}

// 当鼠标离开整个导航组件区域时
function handleNavLeave() {
  // 启动一个延迟计时器，150毫秒后关闭二级菜单
  leaveTimer.value = window.setTimeout(() => {
    activeSubMenuIndex.value = -1
  }, 150)
}

// 核心修正：移除了不再使用的 handleEnd
const { draggableOptions, handleStart } = useDrag()

const subMenuRows = computed(() => {
  if (activeSubMenuIndex.value < 0 || activeSubMenuIndex.value >= siteStore.data.length)
    return []
  const activeCate = siteStore.data[activeSubMenuIndex.value]
  if (!activeCate || !activeCate.groupList || !activeCate.groupList.length)
    return []
  const half = Math.ceil(activeCate.groupList.length / 2)
  return [
    activeCate.groupList.slice(0, half),
    activeCate.groupList.slice(half),
  ].filter(row => row.length > 0)
})

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
  activeSubMenuIndex.value = -1
}

// handleDragEnd 函数已在此版本中被完全删除
</script>

<template>
  <section
    class="relative flex-center flex-col text-14"
    @mouseleave="handleNavLeave"
    @mouseenter="handleNavEnter"
  >
    <div class="w-full flex items-center justify-center">
      <draggable
        class="nav w-auto flex gap-x-6 w-90p sm:gap-x-12 sm:max-w-480"
        :list="siteStore.data"
        item-key="id"
        :component-data="{
          tag: 'div',
          type: 'transition-group',
        }"
        v-bind="draggableOptions"
        @start="handleStart"
        @end="handleEnd"
      >
        <template #item="{ element: cate, index: i }: { element: Category, index: number }">
          <div
            class="dragging nav__item flex shrink-0 items-center gap-x-2"
            :class="{
              'hover:text-$primary-c': !settingStore.isSetting,
              'nav__item--active': siteStore.cateIndex === i,
            }"
            cursor-pointer px-8 py-10 transition-color duration-300
            @click="handleCateClick(i)"
          >
            <span>{{ cate.name }}</span>
            <div
              v-if="cate.groupList && cate.groupList.length > 0"
              i-carbon-chevron-down text-12 transition-transform duration-300
              :class="{ 'rotate-180': activeSubMenuIndex === i }"
            />
          </div>
        </template>
      </draggable>

      <n-button
        v-if="settingStore.isSetting"
        class="ml-4"
        type="primary"
        size="small"
        :focusable="false"
        secondary
        circle
        @click="modalStore.showModal('add', 'cate')"
      >
        <template #icon>
          <div i-carbon:add />
        </template>
      </n-button>
    </div>

    <transition name="slide-fade">
      <div
        v-if="subMenuRows.length > 0"
        class="sub-nav-container"
      >
        <div v-for="(row, rowIndex) in subMenuRows" :key="rowIndex" class="sub-nav-row" mb-2 flex-center flex-wrap gap-x-4 gap-y-2>
          <div
            v-for="subItem in row"
            :key="subItem.id"
            class="sub-nav-item"
            cursor-pointer rounded-full bg-gray-100 px-10 py-4 text-12 transition-colors duration-300 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600
            @click="handleSubMenuClick(subItem)"
          >
            {{ subItem.name }}
          </div>
        </div>
      </div>
    </transition>
  </section>
</template>

<style lang="scss" scoped>
/* 一级菜单样式 */
.nav {
  overflow-x: scroll;
  -webkit-overflow-scrolling: touch;
  &::-webkit-scrollbar {
    display: none;
  }
}
.nav__item {
  position: relative;
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 0;
    height: 2px;
    border-radius: 2px;
    background-color: var(--primary-c);
    transition: all .3s;
    left: 50%;
    transform: translateX(-50%);
  }
  &--active {
    color: var(--primary-c);
    &::after {
      width: 100%;
    }
  }
}

/* 二级菜单容器样式 (最终微调版) */
.sub-nav-container {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 10px;
  width: auto;
  min-width: 260px;
  max-width: 500px;
  padding: 10px 8px;
  background-color: var(--main-bg-c);
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  border: 1px solid var(--border-c);
  z-index: 100;
}

.sub-nav-row {
  justify-content: center;
}

/* 动画样式 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease-in-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}
</style>
