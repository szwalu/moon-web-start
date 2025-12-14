<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, ref, watch } from 'vue'

// [修改 1] 引入 defineAsyncComponent
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import {
  Calendar,
  CheckSquare,
  ChevronRight,
  Download,
  HelpCircle,
  MessageSquare,
  Settings,
  Shuffle,
  Trash2,
  Type,
  User as UserIcon,
} from 'lucide-vue-next'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  show: { type: Boolean, required: true },
  user: { type: Object as () => User | null, required: true },
  totalNotes: { type: Number, default: 0 },
  tagCount: { type: Number, default: 0 },
  tagMenuOptions: { type: Array as () => any[], default: () => [] },
})

const emit = defineEmits(['close', 'menuClick'])

// [修改 2] 异步引入 Feedback 组件
// 注意：请根据你的实际文件路径调整，假设是在 views 或 components 下
const Feedback = defineAsyncComponent(() => import('@/components/Feedback.vue'))

const { t } = useI18n()

// [修改 3] 控制反馈组件显示的内部状态
const showFeedback = ref(false)

function onAvatarClick() {
  handleItemClick('account')
}

// ===========================================================================
// 🔥 递归渲染组件 (保持不变)
// ===========================================================================
const RecursiveMenu = defineComponent({
  props: ['items'],
  emits: ['itemClick'],
  setup(props, { emit }) {
    const resolve = (val: any) => (typeof val === 'function' ? val() : val)

    const renderNode = (item: any): any => {
      if (item.type === 'render') {
        return h(
          'div',
          {
            key: item.key,
            class: 'render-node',
            onClick: () => {
              if (item.key !== 'tag-search' && item.key !== 'pinned-header')
                emit('itemClick')
            },
          },
          [resolve(item.render)],
        )
      }

      if (item.type === 'group') {
        const groupProps = item.props || {}
        return h('div', { key: item.key, class: 'group-node' }, [
          h(
            'div',
            {
              class: 'group-label',
              onClick: (e: MouseEvent) => {
                if (groupProps.onClick)
                  groupProps.onClick(e)
                emit('itemClick')
              },
            },
            [resolve(item.label)],
          ),
          h('div', { class: 'group-children' }, item.children.map(renderNode)),
        ])
      }

      const originalProps = item.props || {}
      const wrappedProps = {
        ...originalProps,
        onClick: (e: MouseEvent) => {
          if (originalProps.onClick)
            originalProps.onClick(e)
          emit('itemClick')
        },
      }

      return h(
        'div',
        {
          key: item.key,
          class: 'menu-node hover-effect',
          ...wrappedProps,
        },
        [resolve(item.label)],
      )
    }

    return () => {
      if (!props.items || props.items.length === 0)
        return null
      return h('div', { class: 'tag-menu-root' }, props.items.map(renderNode))
    }
  },
})

// --- 统计数据逻辑 ---
const journalingDays = ref(0)

const userName = computed(() => {
  const meta = props.user?.user_metadata
  if (meta?.full_name)
    return meta.full_name
  if (meta?.name)
    return meta.name
  if (meta?.display_name)
    return meta.display_name
  return props.user?.email?.split('@')[0] || t('auth.default_nickname')
})

const userSignature = computed(() => {
  return props.user?.user_metadata?.signature || t('auth.default_signature')
})

const userAvatar = ref<string | null>(null)

watch(() => props.user, (u) => {
  const remoteUrl = u?.user_metadata?.avatar_url
  if (!u || !remoteUrl || remoteUrl === 'null' || remoteUrl.trim() === '') {
    userAvatar.value = null
    return
  }
  const cacheKey = `avatar_cache_${u.id}`
  const cachedBase64 = localStorage.getItem(cacheKey)
  if (cachedBase64) {
    userAvatar.value = cachedBase64
    if (remoteUrl !== cachedBase64) {
      const img = new Image()
      img.src = remoteUrl
      img.onload = () => {
        userAvatar.value = remoteUrl
      }
    }
  }
  else {
    userAvatar.value = remoteUrl
  }
}, { immediate: true })

function calculateDays(dateStr: string) {
  const first = new Date(dateStr)
  const today = new Date()
  const diffTime = Math.abs(today.getTime() - first.getTime())
  journalingDays.value = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

async function fetchStats() {
  if (!props.user)
    return
  const STORAGE_KEY = `journal_start_date_${props.user.id}`
  const cachedDate = localStorage.getItem(STORAGE_KEY)

  if (cachedDate) {
    calculateDays(cachedDate)
  }
  else {
    try {
      const { data } = await supabase
        .from('notes')
        .select('created_at')
        .eq('user_id', props.user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (data?.created_at) {
        localStorage.setItem(STORAGE_KEY, data.created_at)
        calculateDays(data.created_at)
      }
      else {
        journalingDays.value = 0
      }
    }
    catch (e) {
      console.error('Fetch stats error:', e)
    }
  }
}

watch(() => props.show, (val) => {
  if (val)
    fetchStats()
})

const settingsExpanded = ref(false)

function handleItemClick(key: string) {
  if (key === 'settings-group') {
    settingsExpanded.value = !settingsExpanded.value
    return
  }

  // [修改 4] 拦截 'feedback' 事件，内部处理，不再向父组件 emit 菜单点击
  if (key === 'feedback') {
    showFeedback.value = true
    emit('close') // 关闭侧边栏
    return
  }

  emit('menuClick', key)
  if (key !== 'settings-group')
    emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="sidebar-wrapper-root">
      <Transition name="slide-sidebar">
        <div v-if="show" class="sidebar-container">
          <div class="sidebar-header-card">
            <div class="user-info-row" @click="onAvatarClick">
              <div class="avatar-circle">
                <img
                  v-if="userAvatar"
                  :src="userAvatar"
                  alt="Avatar"
                  @error="userAvatar = null"
                >
                <div v-else class="avatar-placeholder">
                  {{ userName.charAt(0).toUpperCase() }}
                </div>
              </div>

              <div class="user-text-col">
                <div class="user-name-line">
                  <div class="user-name">
                    {{ userName }}
                  </div>
                  <div v-if="props.user?.email === 'vip'" class="user-badge">
                    高级
                  </div>
                </div>
                <div class="user-signature">
                  {{ userSignature }}
                </div>
              </div>
            </div>

            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-num">
                  {{ totalNotes }}
                </div>
                <div class="stat-label">
                  {{ t('notes.notes_bj') || '笔记' }}
                </div>
              </div>
              <div class="stat-item">
                <div class="stat-num">
                  {{ tagCount }}
                </div>
                <div class="stat-label">
                  {{ t('notes.search_filter_tag') || '标签' }}
                </div>
              </div>
              <div class="stat-item">
                <div class="stat-num">
                  {{ journalingDays }}
                </div>
                <div class="stat-label">
                  {{ t('notes.days') || '天数' }}
                </div>
              </div>
            </div>
          </div>

          <div class="menu-list">
            <div class="menu-item" @click="handleItemClick('calendar')">
              <Calendar :size="20" /><span>{{ t('auth.Calendar') }}</span>
            </div>
            <div class="menu-item" @click="handleItemClick('toggleSelection')">
              <CheckSquare :size="20" /><span>{{ t('notes.select_notes') }}</span>
            </div>
            <div class="menu-item has-arrow" @click="handleItemClick('settings-group')">
              <div class="item-left">
                <Settings :size="20" />
                <span>{{ t('settings.title') || '设置' }}</span>
              </div>
              <ChevronRight :size="18" class="caret" :class="{ rotated: settingsExpanded }" />
            </div>

            <div v-if="settingsExpanded" class="submenu">
              <div class="menu-item sub" @click="handleItemClick('settings')">
                <Type :size="18" /><span>{{ t('settings.font_title') }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('export')">
                <Download :size="18" /><span>{{ t('notes.export_all') }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('account')">
                <UserIcon :size="18" /><span>{{ t('auth.account_title') }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('help')">
                <HelpCircle :size="18" /><span>{{ t('notes.help_title') || '使用帮助' }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('feedback')">
                <MessageSquare :size="18" /><span>{{ t('notes.feedback_title') || '反馈建议' }}</span>
              </div>
            </div>

            <div class="menu-item" @click="handleItemClick('randomRoam')">
              <Shuffle :size="20" /><span>{{ t('notes.random_roam.title') || '随机漫游' }}</span>
            </div>
            <div class="menu-item" @click="handleItemClick('trash')">
              <Trash2 :size="20" /><span>{{ t('auth.trash') }}</span>
            </div>

            <div class="divider" />
            <div class="tag-menu-container">
              <RecursiveMenu :items="tagMenuOptions" @item-click="emit('close')" />
            </div>

            <div style="height: 60px;" />
          </div>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="show" class="sidebar-overlay" @click="emit('close')" />
      </Transition>

      <Transition name="fade">
        <Feedback
          v-if="showFeedback"
          :modal-mode="true"
          @close="showFeedback = false"
        />
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* ===========================================================================
   🎨 主题变量定义
   =========================================================================== */
.sidebar-container {
  /* --- 默认浅色模式变量 --- */
  --sb-bg: white;
  --sb-text: #333;
  --sb-text-sub: #999;
  --sb-hover: rgba(0,0,0,0.03);
  --sb-submenu-bg: #fafafa;
  --sb-divider: #f0f0f0;
  --sb-shadow: rgba(0,0,0,0.1);
}

@media (prefers-color-scheme: dark) {
  .sidebar-container {
    --sb-bg: #1e1e1e;
    --sb-text: #e0e0e0;
    --sb-text-sub: #bbb;
    --sb-hover: rgba(255,255,255,0.06);
    --sb-submenu-bg: #151515;
    --sb-divider: #333;
    --sb-shadow: rgba(0,0,0,0.4);
  }
}

:global(.dark) .sidebar-container {
  --sb-bg: #1e1e1e;
  --sb-text: #e0e0e0;
  --sb-text-sub: #bbb;
  --sb-hover: rgba(255,255,255,0.06);
  --sb-submenu-bg: #151515;
  --sb-divider: #333;
  --sb-shadow: rgba(0,0,0,0.4);
}

/* ===========================================================================
   📐 布局与样式
   =========================================================================== */

/* Sidebar 容器 */
.sidebar-container {
  position: fixed;
  top: 0; left: 0; width: 310px; height: 100dvh;
  z-index: 3500;
  display: flex; flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;

  background: var(--sb-bg);
  color: var(--sb-text);
  box-shadow: 4px 0 15px var(--sb-shadow);
  transition: background-color 0.3s, color 0.3s;

  /* 🔥 核心修改：设置侧边栏的基础字号为全局 UI 字号 */
  font-size: var(--ui-font, 14px);
}
.sidebar-container::-webkit-scrollbar { display: none; }

.sidebar-header-card {
  background: linear-gradient(to bottom, #6366f1 0%, #818cf8 100%);
  padding-top: calc(2rem + env(safe-area-inset-top));
  padding-right: 1.5rem;
  padding-bottom: 1.5rem;
  padding-left: 1.5rem;
  color: white;
  position: relative;
  flex-shrink: 0;
}

/* 用户信息行 */
.user-info-row {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 24px; margin-top: 10px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  border-radius: 8px;
  margin-left: -8px; padding: 8px;
}
.user-info-row:hover { background: rgba(255, 255, 255, 0.1); }
.user-info-row:active { opacity: 0.8; transform: scale(0.98); }

.avatar-circle { width: 54px; height: 54px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.8); overflow: hidden; background: rgba(255,255,255,0.2); }
.avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; color: white; }

/* 🔥 修改：用户名大小使用 calc 计算 */
.user-name {
  font-size: calc(var(--ui-font, 14px) * 1.4); /* 原 20px */
  font-weight: 600;
  letter-spacing: 0.5px;
}

.user-badge { background: rgba(255,255,255,0.3); font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }

/* 🔥 修改：签名文字大小 */
.user-signature {
  font-size: calc(var(--ui-font, 14px) * 0.85); /* 原 12px */
  opacity: 0.85; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px;
}

.stats-grid { display: flex; justify-content: space-between; }
.stat-item { display: flex; flex-direction: column; align-items: center; flex: 1; }

/* 🔥 修改：统计数字大小 */
.stat-num {
  font-size: calc(var(--ui-font, 14px) * 1.4); /* 原 20px */
  font-weight: 700; margin-bottom: 4px;
  color: #ffffff;
  font-family: inherit;
}

/* 🔥 修改：统计标签大小 */
.stat-label {
  font-size: calc(var(--ui-font, 14px) * 0.85); /* 原 12px */
  opacity: 0.9;
}

/* 菜单列表区域 */
.menu-list {
  padding: 10px 0 0 0 !important;
  flex: 1;
}

/* 菜单项 */
.menu-item {
  display: flex; align-items: center;
  padding: 6px 20px;
  cursor: pointer;
  transition: background 0.1s;

  /* 🔥 修改：主菜单字号跟随系统设置 */
  font-size: var(--ui-font, 15px);

  gap: 16px;
  position: relative;
  min-height: 36px;
  color: var(--sb-text);
}
.menu-item:hover {
  background: var(--sb-hover);
}
.menu-item.has-arrow { justify-content: space-between; }
.item-left { display: flex; align-items: center; gap: 16px; }

.caret { transition: transform 0.2s; color: var(--sb-text-sub); }
.caret.rotated { transform: rotate(90deg); }

/* 子菜单 */
.submenu {
  background: var(--sb-submenu-bg);
  overflow: hidden;
}

.menu-item.sub {
  padding-left: 56px;

  /* 🔥 修改：子菜单字号稍微小一点 */
  font-size: calc(var(--ui-font, 14px) * 0.93); /* 原 14px */

  padding-top: 6px;
  padding-bottom: 6px;
}

/* 分割线 */
.divider {
  height: 1px;
  background: var(--sb-divider);
  margin: 8px 24px;
}

.menu-section-label {
  padding: 12px 24px 4px 24px;
  /* 🔥 修改 */
  font-size: calc(var(--ui-font, 14px) * 0.85);
  color: var(--sb-text-sub);
  font-weight: 500;
}

.sidebar-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 3499;
  backdrop-filter: blur(2px);
}

/* 动画 */
.slide-sidebar-enter-active, .slide-sidebar-leave-active { transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1); }
.slide-sidebar-enter-from, .slide-sidebar-leave-to { transform: translateX(-100%); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 标签菜单布局修正 */
.tag-menu-container {
  padding-left: 35px;
  padding-right: 0;
  overflow: visible;
}

/* 递归组件样式透传 (:deep) */
:deep(.render-node) {
  position: relative;
  margin-left: -35px !important;
  width: calc(100% + 35px) !important;
}
:deep(.menu-node), :deep(.group-node) {
  position: relative;
  color: var(--sb-text);
  /* 🔥 新增：确保标签列表继承字号，或者明确设置 */
  font-size: var(--ui-font, 14px);
}
:deep(.hover-effect) {
  cursor: pointer;
  min-height: 36px;
  display: flex;
  align-items: center;
}
:deep(.hover-effect:hover) {
  background-color: var(--sb-hover);
}
:deep(.group-label) {
  pointer-events: none;
  color: var(--sb-text);
}
</style>

<style>
body > .v-binder-follower-container,
body > .v-binder-follower-content,
body > .n-dropdown-menu,
body > .n-popover,
body > .n-modal-mask,
body > .n-modal-container,
body > .n-dialog-container,
body > .n-dialog-mask {
  z-index: 10000 !important;
}
</style>
