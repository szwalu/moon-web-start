<script setup lang="ts">
import { computed, defineComponent, h, ref, watch } from 'vue'
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
const { t } = useI18n()

function onAvatarClick() {
  handleItemClick('account')
}

// ===========================================================================
// 🔥 递归渲染组件 (已修改：支持点击后自动关闭)
// ===========================================================================
const RecursiveMenu = defineComponent({
  props: ['items'],
  emits: ['itemClick'], // ✨ 1. 声明自定义事件
  setup(props, { emit }) {
    const resolve = (val: any) => (typeof val === 'function' ? val() : val)

    const renderNode = (item: any): any => {
      // 1. Render 类型 (如搜索框、分割线等，不处理点击关闭)
      if (item.type === 'render')
        return h('div', { key: item.key, class: 'render-node' }, [resolve(item.render)])

      // 2. Group 类型 (分组标题，不处理点击关闭)
      if (item.type === 'group') {
        return h('div', { key: item.key, class: 'group-node' }, [
          h('div', { class: 'group-label' }, [resolve(item.label)]),
          h('div', { class: 'group-children' }, item.children.map(renderNode)),
        ])
      }

      // 3. 普通标签项 (✨ 关键修改：拦截点击事件)
      // 提取原始的 props
      const originalProps = item.props || {}

      // 创建包装后的 props
      const wrappedProps = {
        ...originalProps,
        onClick: (e: MouseEvent) => {
          // A. 先执行原有的筛选逻辑 (来自于 useTagMenu.ts)
          if (originalProps.onClick)
            originalProps.onClick(e)

          // B. 发送信号通知父组件关闭侧边栏
          emit('itemClick')
        },
      }

      return h(
        'div',
        {
          key: item.key,
          class: 'menu-node hover-effect',
          ...wrappedProps, // ✨ 使用包装后的事件
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
const totalChars = ref(0)
const journalingDays = ref(0)
const hasFetched = ref(false)

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

const userAvatar = computed(() => props.user?.user_metadata?.avatar_url || null)

async function fetchStats() {
  if (!props.user)
    return
  try {
    const { data } = await supabase.from('notes').select('content').eq('user_id', props.user.id)
    totalChars.value = data?.reduce((sum, n) => sum + (n.content?.length || 0), 0) ?? 0
  }
  catch (e) { /* ignore */ }

  try {
    const { data } = await supabase.from('notes').select('created_at').eq('user_id', props.user.id).order('created_at', { ascending: true }).limit(1).single()
    if (data?.created_at) {
      const first = new Date(data.created_at)
      const today = new Date()
      const diffTime = Math.abs(today.getTime() - first.getTime())
      journalingDays.value = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }
    else {
      journalingDays.value = 0
    }
  }
  catch (e) { /* ignore */ }
}

watch(() => props.show, (val) => {
  if (val && !hasFetched.value) {
    fetchStats()
    hasFetched.value = true
  }
})

const settingsExpanded = ref(false)

function handleItemClick(key: string) {
  if (key === 'settings-group') {
    settingsExpanded.value = !settingsExpanded.value
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
                <img v-if="userAvatar" :src="userAvatar" alt="Avatar">
                <div v-else class="avatar-placeholder">
                  {{ userName.charAt(0).toUpperCase() }}
                </div>
              </div>
              <div class="user-name">{{ userName }}</div>
              <div v-if="props.user?.email === 'vip'" class="user-badge">高级</div>
            </div>
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-num">{{ totalNotes }}</div>
                <div class="stat-label">{{ t('notes.notes_bj') || '笔记' }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-num">{{ totalChars }}</div>
                <div class="stat-label">{{ t('notes.total_chars') || '字符' }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-num">{{ journalingDays }}</div>
                <div class="stat-label">{{ t('notes.days') || '天数' }}</div>
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
    </div>
  </Teleport>
</template>

<style scoped>
/* Sidebar 层级 3500 */
.sidebar-container {
  position: fixed;
  top: 0; left: 0; width: 310px; height: 100dvh;
  background: white;
  z-index: 3500;
  display: flex; flex-direction: column;
  box-shadow: 4px 0 15px rgba(0,0,0,0.1);
  overflow-y: auto;
  scrollbar-width: none;
}
.sidebar-container::-webkit-scrollbar { display: none; }
:global(.dark) .sidebar-container { background: #1e1e1e; }

/* 🎨 [修改] 顶部卡片配色：紫色渐变
   从上 (#6366f1) 到下 (#818cf8) 变淡，模拟主页按钮色调
*/
.sidebar-header-card {
  background: linear-gradient(to bottom, #6366f1 0%, #818cf8 100%);
  /* ⚡️ [关键修改] padding-top 增加安全区域计算，防止顶到状态栏 */
  padding-top: calc(2rem + env(safe-area-inset-top));
  padding-right: 1.5rem;
  padding-bottom: 1.5rem;
  padding-left: 1.5rem;
  color: white; position: relative; flex-shrink: 0;
}

/* ⚡️ [修改] 增加 cursor: pointer 和交互效果 */
.user-info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  margin-top: 10px;

  /* 新增交互样式 */
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  border-radius: 8px; /* 可选：加一点圆角让点击区域更明显 */
  margin-left: -8px;  /* 补偿 padding 的位移 */
  padding: 8px;       /* 增加点击热区 */
}

/* 悬停微调 */
.user-info-row:hover {
  background: rgba(255, 255, 255, 0.1); /* 在紫色背景上加一点微亮的层 */
}

/* 点击时的缩放反馈 */
.user-info-row:active {
  opacity: 0.8;
  transform: scale(0.98);
}
.avatar-circle { width: 54px; height: 54px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.8); overflow: hidden; background: rgba(255,255,255,0.2); }
.avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; color: white; }
.user-name { font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
.user-badge { background: rgba(255,255,255,0.3); font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
.stats-grid { display: flex; justify-content: space-between; }
.stat-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.stat-num { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.stat-label { font-size: 12px; opacity: 0.9; }

.menu-list {
  /* 确保底部没有 padding，使用 !important 覆盖默认样式 */
  padding: 10px 0 0 0 !important;
  flex: 1;
}

/* 紧凑行距 */
.menu-item {
  display: flex; align-items: center;
  padding: 6px 20px;
  cursor: pointer; color: #333;
  transition: background 0.1s;
  font-size: 15px; gap: 16px;
  position: relative;
  min-height: 36px;
}
:global(.dark) .menu-item { color: #e0e0e0; }
.menu-item:hover { background: rgba(0,0,0,0.03); }
:global(.dark) .menu-item:hover { background: rgba(255,255,255,0.05); }
.menu-item.has-arrow { justify-content: space-between; }
.item-left { display: flex; align-items: center; gap: 16px; }
.caret { transition: transform 0.2s; color: #999; }
.caret.rotated { transform: rotate(90deg); }
.submenu { background: #fafafa; overflow: hidden; }
:global(.dark) .submenu { background: #151515; }

.menu-item.sub {
  padding-left: 56px;
  font-size: 14px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.divider { height: 1px; background: #f0f0f0; margin: 8px 24px; }
:global(.dark) .divider { background: #333; }
.menu-section-label { padding: 12px 24px 4px 24px; font-size: 12px; color: #999; font-weight: 500; }

.sidebar-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 3499; /* 比 Sidebar 低 1 */
  backdrop-filter: blur(2px);
}
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

:deep(.render-node) {
  position: relative;
  margin-left: -35px !important;
  width: calc(100% + 35px) !important;
}
:deep(.menu-node), :deep(.group-node) {
  position: relative;
}
:deep(.hover-effect) {
  cursor: pointer;
  min-height: 36px;
  display: flex;
  align-items: center;
}
:deep(.hover-effect:hover) {
  background-color: rgba(0,0,0,0.03);
}
:global(.dark) :deep(.hover-effect:hover) {
  background-color: rgba(255,255,255,0.06);
}
:deep(.group-label) {
  pointer-events: none;
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
