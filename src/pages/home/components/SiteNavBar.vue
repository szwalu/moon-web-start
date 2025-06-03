<script setup lang="ts">
import draggable from 'vuedraggable'
import type { Category } from '@/types'

// import { computed } from 'vue' // 如果 activeSubMenuIndex 和 subMenuRows 已移除，这个可能不需要了

const modalStore = useModalStore()
const siteStore = useSiteStore()
const route = useRoute()
const settingStore = useSettingStore()

// 1. 核心修改：确保 handleEnd 从 useDrag() 中被解构出来
const { draggableOptions, handleStart, handleEnd } = useDrag()

// --- 以下是之前二级菜单的逻辑，如果您的 SiteNavBar.vue 中已经没有二级菜单了，
// --- 并且 activeSubMenuIndex, handleNavEnter, handleNavLeave 也不再需要，可以一并移除。
// --- 我暂时保留它们，以防您还需要。
const activeSubMenuIndex = ref(-1)
const leaveTimer = ref<number | null>(null)

function handleNavEnter() {
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
}
function handleNavLeave() {
  leaveTimer.value = window.setTimeout(() => {
    activeSubMenuIndex.value = -1
  }, 150)
}
// --- 二级菜单相关逻辑结束 ---

// 2. 之前的 handleDragEnd 函数有复杂的 setCateIndex 逻辑，
//    如果这个拖拽只是 useDrag() 自身的开始/结束状态，那么直接使用 handleEnd 可能就够了。
//    如果拖拽 categories 数组并改变其顺序的逻辑还需要，我们需要恢复 handleDragEnd。
//    这里我们假设 useDrag 提供的 handleEnd 是用于结束拖拽状态的。
//    如果您的 useDrag() 需要一个更复杂的 handleDragEnd，请告诉我。

function handleCateClick(cateIndex: number) {
  // ... (原有的 handleCateClick 逻辑，包括二级菜单的展开/收起)
  if (route.name === 'setting' && siteStore.cateIndex === cateIndex) {
    modalStore.showModal('update', 'cate')
    return
  }
  siteStore.setCateIndex(cateIndex) // 更新主要内容区域的显示

  // 处理二级菜单的显示/隐藏 (如果还有二级菜单逻辑的话)
  const clickedCate = siteStore.data[cateIndex]
  if (clickedCate.groupList && clickedCate.groupList.length > 0 && activeSubMenuIndex !== undefined) { // 检查 activeSubMenuIndex 是否定义
    if (activeSubMenuIndex.value === cateIndex)
      activeSubMenuIndex.value = -1
    else
      activeSubMenuIndex.value = cateIndex
  }
  else if (activeSubMenuIndex !== undefined) {
    activeSubMenuIndex.value = -1
  }
}

// 用于二级菜单的 subMenuRows 计算属性 (如果还有二级菜单逻辑)
const subMenuRows = computed(() => {
  if (activeSubMenuIndex === undefined || activeSubMenuIndex.value < 0 || activeSubMenuIndex.value >= siteStore.data.length)
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

// 用于二级菜单项点击 (如果还有二级菜单逻辑)
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
  if (activeSubMenuIndex !== undefined)
    activeSubMenuIndex.value = -1
}
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
              v-if="cate.groupList && cate.groupList.length > 0 && activeSubMenuIndex !== undefined"
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
        v-if="subMenuRows !== undefined && subMenuRows.length > 0"
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
/* 样式部分保持不变，和您上一版完美版一致 */
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
