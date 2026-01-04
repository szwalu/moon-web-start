<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import { NSelect, useDialog, useMessage } from 'naive-ui'
import { v4 as uuidv4 } from 'uuid'
import { House, X } from 'lucide-vue-next'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import { CACHE_KEYS, getCalendarDateCacheKey, getTagCacheKey } from '@/utils/cacheKeys'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'
import AnniversaryBanner from '@/components/AnniversaryBanner.vue'
import NoteActions from '@/components/NoteActions.vue'
import 'easymde/dist/easymde.min.css'
import { useTagMenu } from '@/composables/useTagMenu'
import { useSettingStore } from '@/stores/setting'
import * as S from '@/utils/settings'
import { isOnline, queuePendingDelete, queuePendingNote, queuePendingUpdate, readNotesSnapshot, saveNotesSnapshot } from '@/utils/offline-db'

import { useOfflineSync } from '@/composables/useSync'

import HelpDialog from '@/components/HelpDialog.vue'
import ActivationModal from '@/components/ActivationModal.vue'
import AvatarImage from '@/components/AvatarImage.vue'
const Sidebar = defineAsyncComponent(() => import('@/components/Sidebar.vue'))
const showSidebar = ref(false) // [新增] 控制侧边栏显示
const authStore = useAuthStore()
const settingStore = useSettingStore()
const showActivation = ref(false)
const canDismissActivation = ref(false)
const DataBackup = defineAsyncComponent(() => import('@/components/DataBackup.vue'))
const showDataBackup = ref(false)
const user = computed(() => authStore.user)
const showHelpDialog = ref(false)
const isUserActivated = ref(false)
const daysRemaining = ref(7)
watch(user, async (currentUser) => {
  if (currentUser) {
    const registeredAt = new Date(currentUser.created_at)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - registeredAt.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    const TRIAL_DAYS = 7
    daysRemaining.value = Math.max(0, TRIAL_DAYS - diffDays)
    const { data, error } = await supabase
      .from('users')
      .select('is_active')
      .eq('id', currentUser.id)
      .single()

    // ✅ [新增] 记录激活状态
    isUserActivated.value = (data && data.is_active === true)

    // 原有弹窗拦截逻辑 (保持不变)
    if (error || !data || data.is_active !== true) {
      if (diffDays <= TRIAL_DAYS) {
        canDismissActivation.value = true
      }
      else {
        canDismissActivation.value = false
        showActivation.value = true
      }
    }
  }
}, { immediate: true })
function onActivationSuccess() {
  showActivation.value = false
  // 激活成功后，刷新页面以确保所有数据流重新初始化
  window.location.reload()
}

const { manualSync: _manualSync } = useOfflineSync()

// ---- 只保留这一处 useI18n 声明 ----
const { t } = useI18n()
// ---- 只保留这一处 allTags 声明（如果后文已有一处，请删除后文那处）----
const allTags = ref<string[]>([])

const SettingsModal = defineAsyncComponent(() => import('@/components/SettingsModal.vue'))
const AccountModal = defineAsyncComponent(() => import('@/components/AccountModal.vue'))
const CalendarView = defineAsyncComponent(() => import('@/components/CalendarView.vue'))
const RandomRoam = defineAsyncComponent(() => import('@/components/RandomRoam.vue'))

const MobileDateRangePicker = defineAsyncComponent(() => import('@/components/MobileDateRangePicker.vue'))

// 避免 ESLint 误报这些异步组件“未使用”
const TrashModal = defineAsyncComponent(() => import('@/components/TrashModal.vue'))
const _usedAsyncComponents = [SettingsModal, AccountModal, CalendarView, MobileDateRangePicker, TrashModal] // 把 TrashModal 追加进去
const showTrashModal = ref(false)

useDark()
const messageHook = useMessage()
const dialog = useDialog()

const noteListRef = ref(null)

// ===== 年月跳转相关 =====
const jumpYear = ref(new Date().getFullYear())
const jumpMonth = ref(new Date().getMonth() + 1)

const yearOptions = computed(() => {
  const years: { label: string; value: number }[] = []

  for (let y = 2000; y <= 2100; y++) {
    years.push({
      label: `${y}`,
      value: y,
    })
  }

  // 让当前年份附近排在上面：倒序
  return years.reverse()
})

const monthOptions = Array.from({ length: 12 }, (_, i) => {
  const m = i + 1
  return {
    label: `${String(m).padStart(2, '0')}`,
    value: m,
  }
})
// === 图片加载后，通知 NoteList 触发 DynamicScroller 的 remeasure ===
function handleMdImageLoad() {
  // NoteList 里暴露了 forceUpdate（见第3步备注）
  (noteListRef.value as any)?.forceUpdate?.()
}
const newNoteEditorContainerRef = ref(null)
const newNoteEditorRef = ref(null)
const noteActionsRef = ref<any>(null)
const showCalendarView = ref(false)
const showRandomRoam = ref(false)
const showSettingsModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const showSearchBar = ref(false)
const compactWhileTyping = ref(false)
const isCreating = ref(false)
const notes = ref<any[]>([])
const newNoteContent = ref('')
const isLoadingNotes = ref(false)
const showNotesList = ref(true)
const currentPage = ref(1)
const notesPerPage = 30
const totalNotes = ref(0)
const hasMoreNotes = ref(true)
const oldestLoadedAt = ref<string | null>(null)
const hasPreviousNotes = ref(false)
const maxNoteLength = 20000
const searchQuery = ref('')
const hasSearchRun = ref(false)
const isExporting = ref(false)
const isReady = ref(false)
const isEditorActive = ref(false)
const isSelectionModeActive = ref(false)
const selectedNoteIds = ref<string[]>([])
const anniversaryBannerRef = ref<InstanceType<typeof AnniversaryBanner> | null>(null)
const anniversaryNotes = ref<any[] | null>(null)
const isAnniversaryViewActive = ref(false)
const loading = ref(false)
const lastSavedId = ref<string | null>(null)
const editingNote = ref<any | null>(null)
const cachedNotes = ref<any[]>([])
const headerCollapsed = ref(false)
const isMonthJumpView = ref(false)
// === 新增：控制“+”唤起输入框的开关 ===
const showComposer = ref(false)
const SESSION_SCROLL_Y = 'session_scroll_y'
const themeStyle = computed(() => {
  const currentKey = settingStore.settings.theme
  const themeItem = S.theme.children.find(item => item.key === currentKey)
  // 默认兜底颜色 (Indigo)
  const val = themeItem?.value || {
    primaryC: '#6366f1',
    primaryDarkC: '#4338ca',
    primaryLightC: '#818cf8',
  }

  return {
    // 定义核心 CSS 变量，供模板使用
    '--theme-primary': val.primaryC, // 主色 (如 +号按钮背景)
    '--theme-primary-dark': val.primaryDarkC, // 深色 (如 横幅文字)
    '--theme-primary-light': val.primaryLightC, // 亮色 (如 深色模式下的文字)
  }
})

const currentThemeColor = computed(() => {
  const currentKey = settingStore.settings.theme
  const themeItem = S.theme.children.find(item => item.key === currentKey)
  // 返回 primaryC，如果没有找到则返回默认的紫色
  return themeItem?.value?.primaryC || '#6366f1'
})

// === 新增辅助函数：不依赖组件实例，强制修正“那年今日”的本地缓存 ===
function forceUpdateAnniversaryCache(idsToDelete: string[]) {
  if (!user.value || idsToDelete.length === 0)
    return

  // 1. 计算缓存键名（需要与 AnniversaryBanner 里的逻辑一致）
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const ymd = `${y}-${m}-${day}`
  const cacheKey = `anniv_results_${user.value.id}_${ymd}`

  // 2. 读取缓存
  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list) && list.length > 0) {
        // 3. 过滤掉被删除的笔记
        const deleteSet = new Set(idsToDelete)
        const newList = list.filter((n: any) => !deleteSet.has(n.id))

        // 4. 写回缓存
        if (newList.length !== list.length)
          localStorage.setItem(cacheKey, JSON.stringify(newList))
      }
    }
  }
  catch (e) {
    console.warn('手动更新那年今日缓存失败', e)
  }
}

// ✨✨✨ 新增函数：处理更新（即使组件不在也能更新缓存） ===
function forceUpdateAnniversaryCacheForUpdate(updatedNote: any) {
  if (!user.value || !updatedNote)
    return

  // 1. 计算缓存键名 (与 AnniversaryBanner 保持一致)
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const ymd = `${y}-${m}-${day}`
  const cacheKey = `anniv_results_${user.value.id}_${ymd}`

  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        // 2. 查找并更新
        const index = list.findIndex((n: any) => n.id === updatedNote.id)
        if (index !== -1) {
          list[index] = { ...list[index], ...updatedNote }
          // 3. 写回缓存
          localStorage.setItem(cacheKey, JSON.stringify(list))
        }
      }
    }
  }
  catch (e) {
    console.warn('手动更新那年今日(编辑)缓存失败', e)
  }
}

// 1. 手动写入新增缓存（即使组件未挂载）
function forceUpdateAnniversaryCacheForAdd(newNote: any) {
  if (!user.value || !newNote)
    return

  // 只有“今天”创建的笔记才需要加入那年今日
  const d = new Date()
  const todayYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // 简单截取 created_at 前10位对比
  const noteYmd = newNote.created_at ? newNote.created_at.substring(0, 10) : ''

  if (noteYmd !== todayYmd)
    return

  const cacheKey = `anniv_results_${user.value.id}_${todayYmd}`
  try {
    const raw = localStorage.getItem(cacheKey)
    // 如果没有缓存，就不强制创建了，等组件自己加载；如果有缓存，才追加
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        // 避免重复
        if (!list.some((n: any) => n.id === newNote.id)) {
          list.unshift(newNote) // 加到最前
          localStorage.setItem(cacheKey, JSON.stringify(list))
        }
      }
    }
  }
  catch (e) {
    console.warn('手动更新那年今日(新增)缓存失败', e)
  }
}

// 2. 统一的新增通知函数
function notifyAnniversaryAdd(newNote: any) {
  // 路径 A：组件在线，直接调用
  if (anniversaryBannerRef.value)
    anniversaryBannerRef.value.addNote(newNote)

  // 路径 B：组件离线，手动修缓存
  else
    forceUpdateAnniversaryCacheForAdd(newNote)

  // 路径 C：同步当前视图变量（如果在显示）
  if (Array.isArray(anniversaryNotes.value)) {
    const d = new Date()
    const todayYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const noteYmd = newNote.created_at ? newNote.created_at.substring(0, 10) : ''

    // 如果当前视图显示的是今天的数据，且内存里还没有这条笔记
    if (noteYmd === todayYmd && !anniversaryNotes.value.some(n => n.id === newNote.id))
      anniversaryNotes.value.unshift(newNote)
  }
}
// === 封装一个统一的更新通知函数 ===
function notifyAnniversaryUpdate(updatedNote: any) {
  // 路径 A：如果组件活着（在屏幕上），调用组件方法（它会处理内存+缓存）
  if (anniversaryBannerRef.value)
    anniversaryBannerRef.value.updateNote(updatedNote)

  // 路径 B：如果组件死了（例如正在编辑时被隐藏），我们手动修缓存
  // 这样当编辑完成、组件重新挂载时，就能读到最新的数据
  else
    forceUpdateAnniversaryCacheForUpdate(updatedNote)

  // 路径 C：无论组件是否活着，如果父组件正持有这份数据，也同步更新它
  // (这是为了防止视图切换瞬间的数据不一致)
  if (Array.isArray(anniversaryNotes.value)) {
    const annivIndex = anniversaryNotes.value.findIndex(n => n.id === updatedNote.id)
    if (annivIndex !== -1)
      anniversaryNotes.value[annivIndex] = { ...anniversaryNotes.value[annivIndex], ...updatedNote }
  }
}

// === 封装一个统一的删除通知函数 ===
function notifyAnniversaryDelete(ids: string[]) {
  // 路径 A：如果组件活着（在屏幕上），直接调用组件方法（更新内存+缓存+视图）
  if (anniversaryBannerRef.value)
    ids.forEach(id => anniversaryBannerRef.value.removeNoteById(id))

  // 路径 B：如果组件死了（被隐藏），我们手动修缓存
  // 这样下次组件挂载时，读到的就是干净的数据
  else
    forceUpdateAnniversaryCache(ids)
}

const LOCAL_CONTENT_KEY = 'new_note_content_draft'
const LOCAL_NOTE_ID_KEY = 'last_edited_note_id'

function openComposer() {
  // ✅ 1. 新增：每次打开输入框前，强制从 LocalStorage 读取最新草稿
  // 这样就能读到刚才在日历组件里写的内容了
  try {
    const raw = localStorage.getItem(LOCAL_CONTENT_KEY) // 即 'new_note_content_draft'
    if (raw) {
      // 尝试解析 JSON（因为日历组件存的是 JSON 格式: {"content": "..."}）
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.content === 'string') {
          newNoteContent.value = parsed.content
        }
        else {
          // 兼容旧数据的纯文本格式
          newNoteContent.value = raw
        }
      }
      catch {
        // 解析失败说明是纯文本，直接赋值
        newNoteContent.value = raw
      }
    }
    else {
      // 如果没有缓存，清空内容（防止残留上次的字）
      newNoteContent.value = ''
    }
  }
  catch (e) {
    console.error('读取草稿失败', e)
  }

  // ✅ 2. 原有打开逻辑保持不变
  showComposer.value = true
  headerCollapsed.value = false
  isEditorActive.value = true
  compactWhileTyping.value = true
  nextTick(() => (newNoteEditorRef.value as any)?.focus?.())
}
function closeComposer() {
  showComposer.value = false
  isEditorActive.value = false
  compactWhileTyping.value = false
}

const calendarViewRef = ref(null)
const activeTagFilter = ref<string | null>(null)
const filteredNotesCount = ref(0)
const isShowingSearchResults = ref(false) // ++ 新增：用于控制搜索结果横幅的显示
const PREFETCH_LAST_TS_KEY = 'home_prefetch_last_ts'
const PREFETCH_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
let authListener: any = null
const noteListKey = ref(0)
const isOffline = ref(false)
let offlineToastShown = false
const isPrefetching = ref(false)
const SILENT_PREFETCH_PAGES = 5 // 5 页 * 30 条 = 150 条

const isTopEditing = ref(false)
const authResolved = ref(false)

// ++ 新增：定义用于sessionStorage的键
const SESSION_SEARCH_QUERY_KEY = 'session_search_query'
const SESSION_SHOW_SEARCH_BAR_KEY = 'session_show_search_bar'
const SESSION_TAG_FILTER_KEY = 'session_tag_filter'
const SESSION_SEARCH_RESULTS_KEY = 'session_search_results'
// ++ 新增：那年今日持久化键
const SESSION_ANNIV_ACTIVE_KEY = 'session_anniv_active'
const SESSION_ANNIV_RESULTS_KEY = 'session_anniv_results'
// ++ 新增：用于控制“回到顶部”按钮的 ref 和计时器变量
const showScrollTopButton = ref(false)
const latestScrollTop = ref(0)
let scrollTimer: any = null
const _TAG_CACHE_DIRTY_TS = 'tag_cache_dirty_ts'
// 组合式：放在 t / allTags 之后
const {
  _mainMenuVisible,
  tagMenuChildren,
  UNTAGGED_SENTINEL,
  refreshTags,
  tagCounts,
} = useTagMenu(allTags, onSelectTag, t)

function onSelectTag(tag: string) {
  // 1. 获取并清理当前输入框内容
  const trimmedContent = (newNoteContent.value || '').trim()

  // 2. 检查两个条件
  const isInputEmpty = trimmedContent === ''
  // 新增检查：内容是否以'#'开头，并且除了开头的'#'外不再包含任何空格
  const isOnlyTag = trimmedContent.startsWith('#') && !trimmedContent.slice(1).includes(' ')

  // 3. 如果输入框是空的，或者里面只有一个标签，就更新它
  if ((isInputEmpty || isOnlyTag) && tag !== UNTAGGED_SENTINEL)
    newNoteContent.value = `${tag} ` // 无论是新增还是替换，操作都是一样的
    // 若要强制聚焦，去掉下面三行注释
    // nextTick(() => {
  //  newNoteEditorRef.value?.focus()
    // })

  // 4. 无论如何，都执行筛选逻辑
  fetchNotesByTag(tag)
}

watch(searchQuery, (newValue) => {
  if (newValue && newValue.trim()) {
    sessionStorage.setItem(SESSION_SEARCH_QUERY_KEY, newValue)
  }
  else {
    sessionStorage.removeItem(SESSION_SEARCH_QUERY_KEY)
    // ++ 新增：当关键词被清除时，必须同时清除对应的结果缓存
    sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
  }
})

// ++ 新增：监听搜索栏显示状态变化，并存入sessionStorage
watch(showSearchBar, (newValue) => {
  sessionStorage.setItem(SESSION_SHOW_SEARCH_BAR_KEY, String(newValue))
})

// ++ 新增：监听标签筛选变化，并存入sessionStorage
watch(activeTagFilter, (newValue) => {
  if (newValue)
    sessionStorage.setItem(SESSION_TAG_FILTER_KEY, newValue)
  else
    sessionStorage.removeItem(SESSION_TAG_FILTER_KEY)
})

// ++ 新增：专门用于控制“那年今日”横幅显示的计算属性
const showAnniversaryBanner = computed(() => {
  // 如果正在编辑新笔记，则隐藏
  if (compactWhileTyping.value)
    return false

  // ✅ 新增：如果正在编辑现有笔记，也隐藏
  if (isTopEditing.value)
    return false

  // 如果激活了标签筛选，则隐藏
  if (activeTagFilter.value)
    return false

  // 如果搜索框内有文字，则隐藏
  if (searchQuery.value && searchQuery.value.trim() !== '')
    return false

  // ++ 新增：选择模式下隐藏“那年今日”
  if (isSelectionModeActive.value)
    return false

  // 满足所有条件，才显示
  return true
})

watch(notes, (newNotes) => {
  if (isLoadingNotes.value || !newNotes || newNotes.length === 0)
    return
  let newestNote = newNotes[0]
  const scanLimit = Math.min(newNotes.length, 5)

  for (let i = 1; i < scanLimit; i++) {
    if (new Date(newNotes[i].created_at) > new Date(newestNote.created_at))
      newestNote = newNotes[i]
    if (!newestNote.is_pinned)
      break
  }

  const noteDate = new Date(newestNote.created_at).toDateString()
  const todayDate = new Date().toDateString()
  if (noteDate === todayDate && anniversaryBannerRef.value) {
    anniversaryBannerRef.value.updateNote(newestNote)
    anniversaryBannerRef.value.addNote(newestNote)
  }
}, { deep: false })

// [修改] 监听初始化完成：确保用户已登录 + 无笔记 + 无筛选 时才弹出帮助
watch(authResolved, (isReady) => {
  if (
    isReady
    && user.value // ✅ 关键新增：必须已登录
    && totalNotes.value === 0
    && notes.value.length === 0
  ) {
    // 再次确认没有处于搜索、标签筛选或那年今日视图
    if (!searchQuery.value && !activeTagFilter.value && !isAnniversaryViewActive.value)
      showHelpDialog.value = true
  }
})

onMounted(() => {
  // === [PATCH-3] 预热一次 session，避免仅依赖 onAuthStateChange 导致“未知”状态 ===
  ;(async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (!error) {
        const currentUser = data?.session?.user ?? null
        if (authStore.user?.id !== currentUser?.id)
          authStore.user = currentUser
      }
    }
    catch {}
  })()
  // === [PATCH-3 END] ===
  setTimeout(() => {
    if (!authResolved.value)
      authResolved.value = true
  }, 2500)

  // isLoadingNotes.value = true
  const loadCache = async () => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEYS.HOME)
      if (cachedData) {
        notes.value = JSON.parse(cachedData)

        // 🔥 新增：数据恢复后，尝试恢复滚动位置
        const savedScrollY = sessionStorage.getItem(SESSION_SCROLL_Y)
        if (savedScrollY) {
          await nextTick() // 等待 Vue 渲染列表 DOM
          // 尝试找到滚动容器并设置 scrollTop
          // 注意：这里我们通过 ref 获取 DOM 元素，'.scroller' 是 NoteList 组件内部的类名
          const scrollerEl = noteListRef.value?.$el?.querySelector('.scroller')
          if (scrollerEl) {
            // 恢复位置
            scrollerEl.scrollTop = Number(savedScrollY)
          }
        }
      }
    }
    catch (e) {
      console.error('Failed to load notes from cache', e)
      localStorage.removeItem(CACHE_KEYS.HOME)
    }
  }
  setTimeout(() => {
    loadCache()
  }, 0)

  // ✅ IndexedDB 快照兜底（仅当上面的 localStorage 没恢复任何内容时才触发）
  ;(async () => {
    try {
      // 等一帧，给 loadCache() 一个机会先把 localStorage 填进来
      await Promise.resolve()
      if (!notes.value || notes.value.length === 0) {
        const local = await readNotesSnapshot()
        if (local && local.length) {
          notes.value = local
          isOffline.value = typeof navigator !== 'undefined' && 'onLine' in navigator ? !navigator.onLine : false
        }
      }
    }
    catch {}
  })()

  document.addEventListener('visibilitychange', handleVisibilityChange)
  const result = supabase.auth.onAuthStateChange(
    (event, session) => {
      const currentUser = session?.user ?? null
      if (authStore.user?.id !== currentUser?.id)
        authStore.user = currentUser

      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && currentUser))) {
        nextTick(async () => {
          // --- 重构后的逻辑 ---
          // 1. 优先检查所有可能的缓存状态
          const savedSearchQuery = sessionStorage.getItem(SESSION_SEARCH_QUERY_KEY)
          const savedSearchResults = sessionStorage.getItem(SESSION_SEARCH_RESULTS_KEY)
          const savedTagFilter = sessionStorage.getItem(SESSION_TAG_FILTER_KEY)
          // ++ 新增：那年今日缓存
          const savedAnnivActive = localStorage.getItem(SESSION_ANNIV_ACTIVE_KEY) === 'true'
          const savedAnnivResults = localStorage.getItem(SESSION_ANNIV_RESULTS_KEY)
          // 2. 根据缓存情况决定执行路径
          if (savedSearchQuery && savedSearchResults) {
            // 路径A：有完整的搜索缓存，直接恢复，不请求网络
            searchQuery.value = savedSearchQuery
            // 统一兜底：清理/还原搜索 UI 状态，避免残留
            showSearchBar.value = sessionStorage.getItem(SESSION_SHOW_SEARCH_BAR_KEY) === 'true'
            if (!showSearchBar.value)
              sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)

            try {
              notes.value = JSON.parse(savedSearchResults)
            }
            catch (e) {
              console.error('Failed to parse cached search results:', e)
              sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
            }
            isLoadingNotes.value = false // 确保没有加载动画
            hasMoreNotes.value = false
            // 恢复后，再去获取标签等次要信息
            //  fetchAllTags()
            anniversaryBannerRef.value?.loadAnniversaryNotes()

            authResolved.value = true // ✅ 判定完成（路径A）
          }
          else if (savedSearchQuery) {
            // 路径B：只有关键词，需要重新搜索（函数内部会处理加载状态）
            searchQuery.value = savedSearchQuery
            // 统一兜底：清理/还原搜索 UI 状态，避免残留
            showSearchBar.value = sessionStorage.getItem(SESSION_SHOW_SEARCH_BAR_KEY) === 'true'
            if (!showSearchBar.value)
              sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)

            noteActionsRef.value?.executeSearch()
            // fetchAllTags()
            anniversaryBannerRef.value?.loadAnniversaryNotes()

            authResolved.value = true // ✅ 判定完成（路径B）
          }
          else if (savedTagFilter) {
            // 路径C：有标签筛选，执行标签筛选（函数内部会处理加载状态）
            await fetchNotesByTag(savedTagFilter)
            // fetchAllTags()
            anniversaryBannerRef.value?.loadAnniversaryNotes()

            authResolved.value = true // ✅ 判定完成（路径C）
          }
          // ++ 路径E：那年今日
          else if (savedAnnivActive) {
            // 与搜索/标签互斥：确保只呈现那年今日
            isShowingSearchResults.value = false
            activeTagFilter.value = null
            showSearchBar.value = false // 恢复时关闭搜索栏较合理

            if (savedAnnivResults) {
              try {
                const parsed = JSON.parse(savedAnnivResults)
                anniversaryNotes.value = parsed
                isAnniversaryViewActive.value = true
                hasMoreNotes.value = false
                nextTick(() => {
                  anniversaryBannerRef.value?.setView(true)
                })
              }
              catch {
                // 解析失败则让 Banner 重新加载
                anniversaryBannerRef.value?.loadAnniversaryNotes()
              }
            }
            else {
              // 没存下具体结果：重新计算
              anniversaryBannerRef.value?.loadAnniversaryNotes()
            }

            // 附带拉取标签等
            // fetchAllTags()
            anniversaryBannerRef.value?.loadAnniversaryNotes()

            authResolved.value = true // ✅ 判定完成（路径E）
          }
          // 替换 auth.vue 中 onAuthStateChange 里的 else 分支
          else {
            // 路径D：无缓存或常规加载
            if (!notes.value || notes.value.length === 0) {
              await fetchNotes(true)
            }
            else {
              // =========================================================
              // 1. 🔥 核心逻辑：静默更新
              // =========================================================
              try {
                const { data: latestData } = await supabase
                  .from('notes')
                  .select('id, content, weather, created_at, updated_at, is_pinned, is_favorited')
                  .eq('user_id', user.value.id)
                  .order('is_pinned', { ascending: false })
                  .order('created_at', { ascending: false })
                  .limit(notesPerPage)

                if (latestData && latestData.length > 0) {
                  const existingMap = new Map(notes.value.map(n => [n.id, n]))
                  const newItems: any[] = []

                  for (const remoteNote of latestData) {
                    if (existingMap.has(remoteNote.id)) {
                      // A. 原地更新
                      const localNote = existingMap.get(remoteNote.id)
                      if (
                        localNote.updated_at !== remoteNote.updated_at
                        || localNote.is_pinned !== remoteNote.is_pinned
                      ) {
                        const idx = notes.value.findIndex(n => n.id === remoteNote.id)
                        if (idx !== -1)
                          notes.value[idx] = remoteNote
                      }
                    }
                    else {
                      // B. 收集新笔记
                      newItems.push(remoteNote)
                    }
                  }

                  // C. 插入新笔记
                  if (newItems.length > 0) {
                    notes.value = [...newItems, ...notes.value]
                    // 只增不减，不需要严格校对 totalNotes，防止误判
                    totalNotes.value = (typeof totalNotes.value === 'number' ? totalNotes.value : notes.value.length) + newItems.length

                    try {
                      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
                      localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
                    }
                    catch {}
                  }
                }
              }
              catch (err) {
                console.warn('[Silent Update Failed] Continuing with cached data:', err)
              }

              // =========================================================
              // 2. 🚑【关键修复 - 最终版】
              // =========================================================
              if (notes.value.length > 0) {
                // (1) 修正游标：确保知道从哪里开始加载下一页
                let minCreated = notes.value[0].created_at
                for (const n of notes.value) {
                  if (n.created_at && new Date(n.created_at).getTime() < new Date(minCreated).getTime())
                    minCreated = n.created_at
                }
                oldestLoadedAt.value = minCreated

                // (2) 修正页码
                currentPage.value = Math.max(1, Math.ceil(notes.value.length / notesPerPage))

                // (3) 🔥【重要修改】：只要列表里有数据，就默认允许尝试加载更多。
                //     不要在这里判断 totalNotes，因为缓存的 totalNotes 可能滞后。
                //     如果真的没数据了，fetchNotes 会在请求后自动把 hasMoreNotes 设为 false。
                hasMoreNotes.value = true
              }
              else {
                // 理论上进不来这里（外层已判断），但做个兜底
                hasMoreNotes.value = false
              }
            }

            // === 通用后续逻辑 ===
            // fetchAllTags()
            anniversaryBannerRef.value?.loadAnniversaryNotes()
            authResolved.value = true
          }
        })
      }
      else if (event === 'SIGNED_OUT') {
        notes.value = []
        allTags.value = []
        newNoteContent.value = ''
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('cached_notes_'))
            localStorage.removeItem(key)
        })
        localStorage.removeItem(LOCAL_CONTENT_KEY)
      }
      else {
        // [PATCH-4] 兜底：未知事件也同步一次 user，避免卡在未知态
        authStore.user = session?.user ?? null
      }
    },
  )
  authListener = result.data.subscription
  const savedContent = localStorage.getItem(LOCAL_CONTENT_KEY)
  if (savedContent)
    newNoteContent.value = savedContent

  isReady.value = true
  window.addEventListener('md-img-load', handleMdImageLoad)
})

onUnmounted(() => {
  if (authListener)
    authListener.unsubscribe()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('md-img-load', handleMdImageLoad)
})

watch(newNoteContent, (val) => {
  if (isReady.value) {
    if (val)
      localStorage.setItem(LOCAL_CONTENT_KEY, val)
    else
      localStorage.removeItem(LOCAL_CONTENT_KEY)
  }
})

// ✨ 2. 添加一个新的函数，用于遍历并清除所有 localStorage 中的搜索缓存
function invalidateAllSearchCaches() {
  const searchPrefix = CACHE_KEYS.SEARCH_PREFIX
  // 从后往前遍历以安全地删除项目
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && key.startsWith(searchPrefix))
      localStorage.removeItem(key)
  }
}

function invalidateCachesOnDataChange(note: any) {
  if (!note || !note.content)
    return

  // ✅ 宽松提取：允许中文/英文/数字/下划线/斜杠（兼容你现在的内容写法）
  //    只要是 "#XXXX" 且后面是空白或结尾，就当作标签记一次
  const tagRegex = /#([^\s#.,?!;:"'()\[\]{}]+)(?=\s|$)/g

  const seen = new Set<string>()
  let match: RegExpExecArray | null = tagRegex.exec(note.content)

  while (match !== null) {
    const full = match[1] // 例如 '运动/跑步' 或 '运动'
    if (full) {
      // a) 失效完整标签缓存：#运动/跑步
      const fullTag = `#${full}`
      if (!seen.has(fullTag)) {
        localStorage.removeItem(getTagCacheKey(fullTag))
        seen.add(fullTag)
      }

      // b) 失效所有祖先：#运动
      const parts = full.split('/')
      for (let i = 1; i < parts.length; i++) {
        const ancestor = `#${parts.slice(0, i).join('/')}`
        if (!seen.has(ancestor)) {
          localStorage.removeItem(getTagCacheKey(ancestor))
          seen.add(ancestor)
        }
      }
    }

    // 放到循环尾部，避免 while 条件里的赋值
    match = tagRegex.exec(note.content)
  }

  // ✅ “无标签”哨兵：如果这条笔记不含任何标签，则它的变化会影响无标签筛选
  const isNoteUntagged = !/#([^\s#.,?!;:"'()\[\]{}]+)(?=\s|$)/.test(note.content)
  if (isNoteUntagged)
    localStorage.removeItem(getTagCacheKey(UNTAGGED_SENTINEL))

  // ✅ 日历相关
  const noteDate = new Date(note.created_at)
  localStorage.removeItem(getCalendarDateCacheKey(noteDate))
  localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)

  // ✅ 搜索相关
  invalidateAllSearchCaches()
  sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)

  // 标记“刚发生标签相关改动”，用于 3 秒内绕过旧缓存
  try {
    localStorage.setItem('tag_cache_dirty_ts', String(Date.now()))
  }
  catch {}
}

/**
 * 遍历并清除所有 localStorage 中的标签缓存
 */
function invalidateAllTagCaches() {
  const tagPrefix = CACHE_KEYS.TAG_PREFIX
  // 从后往前遍历以安全地在循环中删除项目
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && key.startsWith(tagPrefix))
      localStorage.removeItem(key)
  }
}

async function _reloadNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('id, content, weather, created_at, updated_at, is_pinned, is_favorited') // 👈 包含 weather
    .order('created_at', { ascending: false })
  if (error)
    throw error
  notes.value = data ?? []
}

// 接收 NoteEditor.vue 发来的 { content, weather }

async function handleCreateNote(content: string, weather?: string | null) {
  isCreating.value = true
  try {
    const saved = await saveNote(content, null, { showMessage: true, weather }) // 👈 透传 weather
    if (saved) {
      // ✅ 老版草稿 key（字符串版）
      localStorage.removeItem(LOCAL_CONTENT_KEY)
      // ✅ 新版 NoteEditor 草稿 key（带 editor-v2 后缀）
      localStorage.removeItem(`${LOCAL_CONTENT_KEY}:editor-v2`)

      newNoteContent.value = ''
      nextTick(() => {
        (newNoteEditorRef.value as any)?.reset?.()
        ;(newNoteEditorRef.value as any)?.blur?.()
      })
      isEditorActive.value = false
      compactWhileTyping.value = false
      headerCollapsed.value = false
      showComposer.value = false
    }
  }
  finally {
    isCreating.value = false
  }
}

async function handleUpdateNote({ id, content }: { id: string; content: string }, callback: (success: boolean) => void) {
  const saved = await saveNote(content, id, { showMessage: true })
  if (callback)
    callback(!!saved)
}

// 构造一条“本地新建”的笔记对象（与线上结构一致）
function buildLocalNote(content: string, weather?: string | null) {
  const nowIso = new Date().toISOString()
  return {
    id: uuidv4(),
    content: content.trim(),
    weather: weather ?? null,
    created_at: nowIso,
    updated_at: nowIso,
    is_pinned: false,
    user_id: user.value!.id, // 已登录前提
    _localOnly: true as const, // 仅用于 UI 标记（可选）
  }
}

async function saveNote(
  contentToSave: string,
  noteIdToUpdate: string | null,
  { showMessage = false, weather = null }: { showMessage?: boolean; weather?: string | null } = {},
) {
  // 基本校验
  if (!contentToSave.trim() || !user.value?.id) {
    if (!user.value?.id)
      messageHook.error(t('auth.session_expired'))
    return null
  }
  if (contentToSave.length > maxNoteLength) {
    messageHook.error(t('notes.max_length_exceeded', { max: maxNoteLength }))
    return null
  }

  // ====== A0) 编辑 旧笔记 且 当前离线：本地更新 + 入队 update ======
  if (noteIdToUpdate && !isOnline()) {
    const nowIso = new Date().toISOString()
    const trimmed = contentToSave.trim()

    // 1) 先更新 UI 列表
    const idx = notes.value.findIndex(n => n.id === noteIdToUpdate)
    if (idx >= 0) {
      const old = notes.value[idx]
      const updated = { ...old, content: trimmed, updated_at: nowIso }
      notes.value[idx] = updated
    }
    else {
      // 兜底插入
      notes.value.unshift({
        id: noteIdToUpdate,
        content: trimmed,
        created_at: nowIso,
        updated_at: nowIso,
        is_pinned: false,
        weather: null,
        user_id: user.value!.id,
      })
    }
    // 排序
    notes.value.sort((a: any, b: any) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))

    // 2) 刷新缓存
    try {
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
    }
    catch {}

    try {
      await saveNotesSnapshot(notes.value)
    }
    catch (e) {
      console.warn('[offline] snapshot failed', e)
    }

    // 3) 入队 outbox
    try {
      await queuePendingUpdate(noteIdToUpdate, { content: trimmed, updated_at: nowIso, user_id: user.value!.id })
    }
    catch (e) {
      console.warn('[offline] queuePendingUpdate failed', e)
    }

    messageHook.success(t('notes.offline_update_success'))
    const updatedObj = notes.value.find(n => n.id === noteIdToUpdate) || null
    if (updatedObj)
      notifyAnniversaryUpdate(updatedObj)
    return updatedObj
  }

  // ====== A) 新建 且 当前离线：本地落盘 + outbox 入队 ======
  if (!noteIdToUpdate && !isOnline()) {
    const localNote = buildLocalNote(contentToSave, weather)
    notes.value = [localNote, ...notes.value].sort((a: any, b: any) => b.is_pinned - a.is_pinned || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    try {
      totalNotes.value = (totalNotes.value || 0) + 1
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
    }
    catch {}

    try {
      await saveNotesSnapshot(notes.value)
    }
    catch (e) {
      console.warn('[offline] snapshot failed', e)
    }

    try {
      await queuePendingNote(localNote)
    }
    catch (e) {
      console.warn('[offline] queuePendingNote failed', e)
    }

    notifyAnniversaryAdd(localNote)
    messageHook.success(t('notes.offline_save_success'))
    return localNote
  }

  // ====== B) 在线模式（已移除重试，改为单次尝试） ======
  const noteData = {
    content: contentToSave.trim(),
    updated_at: new Date().toISOString(),
    user_id: user.value.id,
  }

  let savedNote: any
  try {
    if (noteIdToUpdate) {
      // --- 在线更新 (移除 withRetry) ---
      const { data: updatedData, error: updateError } = await supabase
        .from('notes')
        .update(noteData)
        .eq('id', noteIdToUpdate)
        .eq('user_id', user.value.id)
        .select()

      if (updateError)
        throw new Error(updateError.message)
      if (!updatedData?.length)
        throw new Error('No data returned')

      savedNote = updatedData[0]

      updateNoteInList(savedNote)
      if (showMessage)
        messageHook.success(t('notes.update_success'))
    }
    else {
      // --- 在线新建 (移除 withRetry) ---
      const newId = uuidv4()
      const insertPayload: any = { ...noteData, id: newId, weather: weather ?? null }

      const { data: insertedData, error: insertError } = await supabase
        .from('notes')
        .insert(insertPayload)
        .select()

      if (insertError)
        throw new Error(insertError.message)
      if (!insertedData?.length)
        throw new Error(t('auth.insert_failed_create_note'))

      savedNote = insertedData[0]

      addNoteToList(savedNote)
      if (showMessage)
        messageHook.success(t('notes.auto_saved'))
    }

    // 后续处理
    invalidateCachesOnDataChange(savedNote)
    await refreshTags()
    try {
      await saveNotesSnapshot(notes.value)
    }
    catch {}

    return savedNote
  }
  catch (error: any) {
    console.error('在线保存失败，尝试降级处理:', error)

    // ====== C) 自动降级逻辑：失败立即转入离线队列 ======

    // 场景 1: 更新笔记失败 -> 降级为离线更新
    if (noteIdToUpdate) {
      try {
        console.warn('更新失败，转入离线队列')
        // 1. 本地更新 UI
        const idx = notes.value.findIndex(n => n.id === noteIdToUpdate)
        let updatedObj = null
        const nowIso = new Date().toISOString()

        if (idx >= 0) {
          notes.value[idx] = { ...notes.value[idx], content: contentToSave.trim(), updated_at: nowIso }
          updatedObj = notes.value[idx]
        }

        // 2. 刷新缓存
        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))

        // 3. 入队 Pending Update
        await queuePendingUpdate(noteIdToUpdate, {
          content: contentToSave.trim(),
          updated_at: nowIso,
          user_id: user.value.id,
        })

        // 4. 假装成功
        messageHook.success(t('notes.network_unstable_saved_locally') || '网络不稳定，已暂存至本地')
        if (updatedObj)
          notifyAnniversaryUpdate(updatedObj)
        return updatedObj
      }
      catch (offlineErr) {
        console.error('离线更新降级也失败了:', offlineErr)
      }
    }
    // 场景 2: 新建笔记失败 -> 降级为离线新建
    else {
      try {
        console.warn('新建失败，转入离线队列')
        // 1. 生成本地对象
        const localNote = buildLocalNote(contentToSave, weather)

        // 2. 更新 UI
        notes.value = [localNote, ...notes.value]

        // 3. 入队 Pending Note
        await queuePendingNote(localNote)

        // 4. 刷新缓存
        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
        if (totalNotes.value !== undefined) {
          totalNotes.value += 1
          localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
        }

        // 5. 假装成功
        notifyAnniversaryAdd(localNote)
        messageHook.success(t('notes.network_unstable_saved_locally') || '网络不稳定，已暂存至本地')
        return localNote
      }
      catch (offlineErr) {
        console.error('离线新建降级也失败了:', offlineErr)
      }
    }

    // 如果连降级都失败了，或者有其他未知错误，显示红框报错
    messageHook.error(`${t('notes.operation_error')}: ${error.message || '未知错误'}`)
    return null
  }
}

const displayedNotes = computed(() => {
  // 1. 最高优先级：如果正在显示搜索结果，则必须返回 notes 数组（它此刻装着搜索结果）
  if (isShowingSearchResults.value)
    return notes.value

  // 2. 第二优先级：如果不在搜索模式，但在“那年今日”视图，则返回那年今日的笔记
  if (isAnniversaryViewActive.value)
    return anniversaryNotes.value

  // 3. 默认情况：返回主列表的笔记
  return notes.value
})

const MIN_NOTES_FOR_HIDE = 6

// —— 安全的计数：兼容 ref 和非 ref，避免 TDZ 和形态判断散落各处 ——
const notesCount = computed(() => {
  if (Array.isArray((displayedNotes as any)?.value))
    return (displayedNotes as any).value.length
  if (Array.isArray(displayedNotes as any))
    return (displayedNotes as any).length
  return 0
})

// 统一规则：只有当可见笔记数 ≥ 6 时才允许隐藏（主页 / 那年今日 / 标签 / 搜索 全部适用）
const canHideTopChrome = computed(() => notesCount.value >= MIN_NOTES_FOR_HIDE)

// —— 视图切换 / 列表变化时，若不满足门槛则钉住展开 ——
watch([notesCount, isAnniversaryViewActive, isShowingSearchResults, activeTagFilter], () => {
  if (!canHideTopChrome.value)
    headerCollapsed.value = false
}, { immediate: true })

function restoreHomepageFromCache(): boolean {
  isMonthJumpView.value = false
  const cachedNotesData = localStorage.getItem(CACHE_KEYS.HOME)
  const cachedMetaData = localStorage.getItem(CACHE_KEYS.HOME_META)
  if (cachedNotesData && cachedMetaData) {
    const cachedNotes = JSON.parse(cachedNotesData)
    const meta = JSON.parse(cachedMetaData)
    notes.value = cachedNotes
    totalNotes.value = meta.totalNotes
    currentPage.value = Math.max(1, Math.ceil(cachedNotes.length / notesPerPage))
    hasMoreNotes.value = cachedNotes.length < meta.totalNotes

    if (notes.value.length > 0) {
      let minCreated = notes.value[0].created_at
      for (const n of notes.value) {
        if (n.created_at && new Date(n.created_at).getTime() < new Date(minCreated).getTime())
          minCreated = n.created_at
      }
      oldestLoadedAt.value = minCreated
    }
    else {
      oldestLoadedAt.value = null
    }

    // ⭐ 恢复到首页视图
    isMonthJumpView.value = false

    return true
  }
  // 兜底：没有缓存时也当作不在跳转视图
  isMonthJumpView.value = false
  return false
}

function handleSearchStarted() {
  // ++ 新增：进入搜索时清理“那年今日”持久化，保证互斥
  hasSearchRun.value = true
  sessionStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
  sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)

  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }
  sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
  isLoadingNotes.value = true
  notes.value = []
  isShowingSearchResults.value = false // ++ 新增
}

function handleSearchCompleted({ data, error }: { data: any[] | null; error: Error | null }) {
  hasSearchRun.value = true
  if (error) {
    messageHook.error(`${t('notes.fetch_error')}: ${error.message}`)
    notes.value = []
    sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY) // ++ 搜索失败，清除缓存
    isShowingSearchResults.value = false
  }
  else {
    notes.value = data || []
    // ++ 搜索成功，将结果存入 sessionStorage
    sessionStorage.setItem(SESSION_SEARCH_RESULTS_KEY, JSON.stringify(notes.value))
    isShowingSearchResults.value = true
  }
  hasMoreNotes.value = false
  hasPreviousNotes.value = false
  isLoadingNotes.value = false
}

function handleSearchCleared() {
  // 1. 【优先】确保搜索词和 UI 状态立即被清空
  searchQuery.value = ''
  hasSearchRun.value = false
  isShowingSearchResults.value = false // 让搜索结果横幅立刻消失

  // 2. 【推迟】主页数据恢复
  setTimeout(() => {
    if (!restoreHomepageFromCache()) {
      currentPage.value = 1
      oldestLoadedAt.value = null
      fetchNotes(true)
    }
  }, 10)
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const { data, error } = await supabase.auth.getSession()
    if ((!data.session || error) && authStore.user) {
      messageHook.warning(t('auth.session_expired_relogin'))
      authStore.user = null
      notes.value = []
      allTags.value = []
      newNoteContent.value = ''
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('cached_notes_'))
          localStorage.removeItem(key)
      })
      localStorage.removeItem(LOCAL_CONTENT_KEY)
    }
    anniversaryBannerRef.value?.loadAnniversaryNotes(true)
  }
}

let editorHideTimer: number | null = null
function onEditorFocus() {
  if (editorHideTimer) {
    clearTimeout(editorHideTimer)
    editorHideTimer = null
  }
  isEditorActive.value = true
  compactWhileTyping.value = true
}
function onEditorBlur() {
  // 稍微等一下，避免点击工具栏等交互导致瞬时闪烁
  editorHideTimer = window.setTimeout(() => {
    isEditorActive.value = false
    compactWhileTyping.value = false
  }, 120)
}

function handleExportTrigger() {
  // ++ 修改逻辑：如果正在显示搜索结果或标签筛选结果，则导出当前列表
  if (isShowingSearchResults.value || activeTagFilter.value) {
    handleExportResults()
  }
  else {
    // 否则，执行包含所有笔记的批量导出
    handleBatchExport()
  }
}

function onListScroll(top: number) {
  latestScrollTop.value = top
  sessionStorage.setItem(SESSION_SCROLL_Y, String(top))
  // 不管能不能隐藏，都强制设为 false（不折叠）
  headerCollapsed.value = false

  /* 注释掉原有的折叠判断逻辑
  if (!canHideTopChrome.value) {
    headerCollapsed.value = false
    return
  }
  headerCollapsed.value = top > 8
  */

  showScrollTopButton.value = false
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (latestScrollTop.value > 400)
      showScrollTopButton.value = true
  }, 250)
}

// ++ 新增：按钮的点击处理函数
function handleScrollTopClick() {
  // ✅ 在“年月跳转视图”下：先恢复 HOME，再滚到顶部（今天 + 置顶笔记）
  // ✅ 在普通 HOME 下：就是原来的 scrollToTop
  restoreHomeAndScrollTop()
}

function handleExportResults() {
  if (isExporting.value)
    return

  isExporting.value = true
  messageHook.info(t('notes.exporting_search_results'), { duration: 3000 })
  try {
    const notesToExport = displayedNotes.value
    if (!notesToExport || notesToExport.length === 0) {
      messageHook.warning(t('notes.no_search_results_to_export'))
      return
    }
    const textContent = notesToExport.map((note: any) => {
      const separator = '----------------------------------------'
      const date = new Date(note.created_at).toLocaleString('zh-CN')
      return `${separator}\n${t('notes.created_at_label')}： ${date}\n${separator}\n\n${note.content}\n\n========================================\n\n`
    }).join('')
    const blob = new Blob([textContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    a.download = `notes_search_results_${timestamp}.md`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 100)
    messageHook.success(t('notes.export_all_success', { count: notesToExport.length }))
  }
  catch (error: any) {
    messageHook.error(`${t('notes.export_all_error')}: ${error.message}`)
  }
  finally {
    isExporting.value = false
  }
}

function openYearMonthPicker() {
  if (!yearOptions.value.length) {
    messageHook.warning(t('notes.no_notes_to_jump') || '当前没有可跳转的笔记')
    return
  }

  dialog.info({
    title: t('notes.jump_to_month_title') || '选择要跳转的年月',
    content: () =>
      h(
        'div',
        { style: 'display:flex;gap:12px;margin-top:8px;' },
        [
          h(NSelect, {
            'value': jumpYear.value,
            'onUpdate:value': (v: number) => { jumpYear.value = v },
            'options': yearOptions.value,
            'style': 'flex:1;',
          }),
          h(NSelect, {
            'value': jumpMonth.value,
            'onUpdate:value': (v: number) => { jumpMonth.value = v },
            'options': monthOptions,
            'style': 'flex:1;',
          }),
        ],
      ),
    positiveText: t('common.confirm') || '确定',
    negativeText: t('notes.cancel') || '取消',
    onPositiveClick: () => {
      jumpToMonth(jumpYear.value, jumpMonth.value)
    },
  })
}

function handleDateOrContentUpdate(payload: any) {
  if (payload && payload.id) {
    updateNoteInList(payload)

    // ✅ [修复] 强制清理该笔记相关的所有缓存（标签、日历、搜索等）
    // 这样当你随后点击标签筛选时，系统会发现缓存已被清除，从而重新拉取包含最新评论的数据
    invalidateCachesOnDataChange(payload)
  }
}

async function fetchNotesByMonth(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`
  const toMonth = month === 12 ? 1 : month + 1
  const toYear = month === 12 ? year + 1 : year
  const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01T00:00:00`

  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', user.value.id)
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })

  if (error)
    console.error(error)

  return data || []
}

async function jumpToMonth(year: number, month: number) {
  // 0. 如果当前就是普通主页视图，且已经有这个月份的数据，
  //    直接让虚拟列表滚过去即可（不需要重新拉）
  if (
    !isAnniversaryViewActive.value
    && !activeTagFilter.value
    && !isShowingSearchResults.value
    && (noteListRef.value as any)?.scrollToMonth?.(year, month)
  )
    return

  // 1. 退出所有“特殊视图”，但**不要**去重置 HOME / 清空 notes
  // —— 那年今日
  isAnniversaryViewActive.value = false
  anniversaryNotes.value = null
  localStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
  localStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)

  // —— 标签筛选
  activeTagFilter.value = null

  // —— 搜索
  isShowingSearchResults.value = false
  hasSearchRun.value = false
  searchQuery.value = ''
  showSearchBar.value = false
  sessionStorage.removeItem(SESSION_SEARCH_QUERY_KEY)
  sessionStorage.removeItem(SESSION_SEARCH_RESULTS_KEY)
  sessionStorage.removeItem(SESSION_SHOW_SEARCH_BAR_KEY)
  sessionStorage.removeItem(SESSION_TAG_FILTER_KEY)

  // 🚫 不再清空 notes / currentPage / oldestLoadedAt
  // notes.value = []
  // currentPage.value = 1
  // hasMoreNotes.value = true
  // oldestLoadedAt.value = null

  isLoadingNotes.value = true

  try {
    // 2. 拉取该月全部笔记
    const monthNotes = await fetchNotesByMonth(year, month)

    if (!monthNotes || monthNotes.length === 0) {
      messageHook.warning(t('notes.no_notes_in_month') || '该月没有笔记')
      return
    }

    // 3. 把“目标月份”的结果并入当前 notes，而不是覆盖
    const map = new Map<string, any>()
    for (const n of notes.value)
      map.set(n.id, n)
    for (const n of monthNotes)
      map.set(n.id, n)

    const merged = Array.from(map.values())

    // 与主页同一排序：先置顶，再按 created_at 倒序
    merged.sort(
      (a, b) =>
        (b.is_pinned - a.is_pinned)
        || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    )

    notes.value = merged

    // 4. 重新计算“最早 created_at”作为向过去翻页的锚点
    if (notes.value.length > 0) {
      let minCreated = notes.value[0].created_at
      for (const n of notes.value) {
        if (n.created_at && new Date(n.created_at).getTime() < new Date(minCreated).getTime())
          minCreated = n.created_at
      }
      oldestLoadedAt.value = minCreated
    }
    else {
      oldestLoadedAt.value = null
    }

    // 年月跳转只是“临时观察窗口”，保留这个标记即可
    isMonthJumpView.value = true

    // 5. 等 DOM 渲染完，再滚动到指定月份位置
    await nextTick()
    ;(noteListRef.value as any)?.scrollToMonth?.(year, month)
  }
  finally {
    isLoadingNotes.value = false
  }
}

function addNoteToList(newNote: any) {
  if (notes.value.some(note => note.id === newNote.id))
    return

  // 1. 实时更新当前界面显示的列表 (这部分不变)
  notes.value.unshift(newNote)
  if (anniversaryBannerRef.value) {
    anniversaryBannerRef.value.addNote(newNote)
  }
  else {
    // 如果组件不在屏幕上，手动写缓存，确保下次出来时有这条笔记
    forceUpdateAnniversaryCacheForAdd(newNote)
  }

  // 如果当前刚好在看那年今日视图（虽然新建时通常不在，但防万一），同步显示变量
  if (Array.isArray(anniversaryNotes.value)) {
    // 简单判断是否属于今天（通常新建的都是今天）
    const isToday = new Date(newNote.created_at).toDateString() === new Date().toDateString()
    if (isToday)
      anniversaryNotes.value.unshift(newNote)
  }
  totalNotes.value += 1
  localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))

  // 2. 智能更新主页的本地缓存
  if (activeTagFilter.value || isShowingSearchResults.value) {
    // 如果当前在筛选或搜索视图中，则执行安全的“读取-修改-写回”操作
    try {
      const homeCacheRaw = localStorage.getItem(CACHE_KEYS.HOME)
      if (homeCacheRaw) {
        const homeCache = JSON.parse(homeCacheRaw)
        // 将新笔记添加到已缓存的完整列表的开头
        homeCache.unshift(newNote)
        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(homeCache))
      }
      // 如果 homeCache 不存在，我们就不操作，避免写入不完整的数据
    }
    catch (e) {
      console.error('未能安全地更新主笔记缓存:', e)
    }
  }
  else {
    // 如果当前就在主列表视图，直接完整保存即可
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
  }
}

// auth.vue

async function handlePinToggle(note: any) {
  if (!note || !user.value)
    return

  const newPinStatus = !note.is_pinned

  // --- 离线分支 ---
  if (!isOnline()) {
    try {
      const noteId = note.id
      const updatedNote = { ...note, is_pinned: newPinStatus, updated_at: new Date().toISOString() }

      // 1. 更新 UI 列表
      const index = notes.value.findIndex(n => n.id === noteId)
      if (index !== -1) {
        notes.value[index] = updatedNote
        notes.value.sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      }

      // 2. 刷新本地缓存
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      await saveNotesSnapshot(notes.value)

      // ✅ [新增] 强制清理该笔记对应日期的日历缓存
      // 这样下次打开日历时，会重新加载数据，从而正确显示置顶图标
      invalidateCachesOnDataChange(updatedNote)

      // 3. 入队
      await queuePendingUpdate(noteId, { is_pinned: newPinStatus, updated_at: updatedNote.updated_at, user_id: user.value.id })

      messageHook.success(newPinStatus ? t('notes.pinned_success') : t('notes.unpinned_success'))
      return
    }
    catch (e: any) {
      console.warn('[offline] pin failed:', e)
      messageHook.error(`${t('notes.operation_error')}: ${e?.message || t('notes.try_again')}`)
      return
    }
  }

  // --- 在线分支 ---
  try {
    const { error } = await supabase
      .from('notes')
      .update({ is_pinned: newPinStatus })
      .eq('id', note.id)
      .eq('user_id', user.value.id)

    if (error)
      throw error

    const updatedNote = { ...note, is_pinned: newPinStatus }

    // 1. 更新主页列表
    updateNoteInList(updatedNote)

    // ✅ [新增] 强制清理日历缓存
    invalidateCachesOnDataChange(updatedNote)

    messageHook.success(newPinStatus ? t('notes.pinned_success') : t('notes.unpinned_success'))

    // ✅ [修改] 如果日历当前正开着，直接“注入”新状态，而不是 reload
    if (showCalendarView.value && calendarViewRef.value) {
      // @ts-expect-error: calendar method exposed via defineExpose
      (calendarViewRef.value as any).commitUpdate?.(updatedNote)
    }
  }
  catch (err: any) {
    messageHook.error(`${t('notes.operation_error')}: ${err.message}`)
  }
}

async function handleFavoriteNote(note: any) {
  if (!note || !user.value?.id)
    return

  const newValue = !note.is_favorited

  // ====== A) 离线模式：仿效置顶的逻辑 (新增部分) ======
  if (!isOnline()) {
    try {
      const noteId = note.id
      const nowIso = new Date().toISOString()
      // 构造更新后的对象
      const updatedNote = {
        ...note,
        is_favorited: newValue,
        updated_at: nowIso,
      }

      // 1. 更新 UI 列表
      const index = notes.value.findIndex(n => n.id === noteId)
      if (index !== -1) {
        notes.value[index] = updatedNote
        // 保持原有的排序逻辑 (通常收藏不改变顺序，但为了数据一致性重新sort一下)
        notes.value.sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      }

      // 2. 刷新本地缓存 (LocalStorage)
      try {
        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      }
      catch {}

      // 3. 写入 IndexedDB 快照
      try {
        await saveNotesSnapshot(notes.value)
      }
      catch (e) {
        console.warn('[offline] snapshot failed (favorite)', e)
      }

      // 4. 入队 Update (等上线后同步)
      await queuePendingUpdate(noteId, {
        is_favorited: newValue,
        updated_at: nowIso,
        user_id: user.value.id,
      })

      // 5. 关键：收藏状态会影响搜索/筛选，清理搜索缓存
      try {
        invalidateAllSearchCaches()
      }
      catch (e) {
        console.warn('invalidateAllSearchCaches failed', e)
      }

      // 6. 提示成功 (使用通用的离线更新提示)
      messageHook.success(t('notes.offline_update_success'))
      return
    }
    catch (e: any) {
      console.warn('[offline] favorite failed:', e)
      messageHook.error(`${t('notes.operation_error')}: ${e?.message || t('notes.try_again')}`)
      return
    }
  }

  // ====== B) 在线模式 (原有逻辑保持不变) ======
  try {
    const { data, error } = await supabase
      .from('notes')
      .update({ is_favorited: newValue })
      .eq('id', note.id)
      .eq('user_id', user.value.id)
      .select()
      .single()

    if (error)
      throw error

    // 用服务器返回的最新记录为准（包含 updated_at 等字段）
    const updatedNote = data ? { ...data } : { ...note, is_favorited: newValue }

    // ✅ 统一走 updateNoteInList
    updateNoteInList(updatedNote)
    invalidateCachesOnDataChange(updatedNote)

    // 2. 清理搜索缓存
    try {
      invalidateAllSearchCaches()
    }
    catch (e) { /* ignore */ }

    // 3. 如果日历当前正开着，直接通知它热更新 (上一轮加的代码)
    if (showCalendarView.value && calendarViewRef.value) {
      // @ts-expect-error: calendar method exposed via defineExpose
      (calendarViewRef.value as any).commitUpdate?.(updatedNote)
    }
  }
  catch (err: any) {
    console.error(err)
    messageHook.error(`${t('notes.operation_error')}: ${err.message || t('notes.try_again')}`)
  }
}

function updateNoteInList(updatedNote: any) {
  // 1. 【原样】更新当前视图中的笔记 UI
  const index = notes.value.findIndex(n => n.id === updatedNote.id)
  if (index !== -1) {
    notes.value[index] = { ...updatedNote }
    notes.value.sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
  }

  // 2. 【修改这里】处理标签筛选的缓存同步
  // 原逻辑是直接 removeItem 删除，导致数据丢失或需要重新加载
  // 现改为：读取 -> 修改 -> 写回，确保评论被保存
  if (activeTagFilter.value) {
    try {
      const key = getTagCacheKey(activeTagFilter.value)
      const cachedRaw = localStorage.getItem(key)
      if (cachedRaw) {
        const cachedData = JSON.parse(cachedRaw)

        // 兼容处理：你的标签缓存结构是 { notes: [...], currentPage: ... }
        // 所以我们只操作 cachedData.notes
        const list = Array.isArray(cachedData) ? cachedData : (cachedData.notes || [])

        const targetIdx = list.findIndex((n: any) => n.id === updatedNote.id)
        if (targetIdx !== -1) {
          // 找到了！把带评论的新笔记塞进去
          list[targetIdx] = { ...updatedNote }

          // 如果是对象结构，要把 notes 放回去
          if (!Array.isArray(cachedData)) {
            cachedData.notes = list
            localStorage.setItem(key, JSON.stringify(cachedData))
          }
          else {
            localStorage.setItem(key, JSON.stringify(list))
          }
        }
      }
    }
    catch (e) {
      // 出错也不影响主流程，仅控制台警告
      console.warn('标签缓存同步微调失败', e)
    }
  }

  // 3. 【原样】智能地更新 LocalStorage 中的主缓存 (这部分你原来的代码写得很好，不动它)
  if (activeTagFilter.value || isShowingSearchResults.value) {
    try {
      const homeCacheRaw = localStorage.getItem(CACHE_KEYS.HOME)
      if (homeCacheRaw) {
        const homeCache = JSON.parse(homeCacheRaw)
        const masterIndex = homeCache.findIndex((n: any) => n.id === updatedNote.id)
        if (masterIndex !== -1) {
          homeCache[masterIndex] = { ...updatedNote }
          localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(homeCache))
        }
      }
    }
    catch (e) {
      console.error('未能安全地更新主笔记缓存:', e)
    }
  }
  else {
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
  }

  // 4. 【原样】日历 UI 实时同步
  if (showCalendarView.value && calendarViewRef.value)
    (calendarViewRef.value as any).commitUpdate?.(updatedNote)

  // 5. 【原样】那年今日更新
  notifyAnniversaryUpdate(updatedNote)

  // 6. 【原样】(保持你刚刚修复的) 强制同步日历缓存文件
  if (updatedNote.created_at) {
    try {
      const dateObj = new Date(updatedNote.created_at)
      const calCacheKey = getCalendarDateCacheKey(dateObj)
      const raw = localStorage.getItem(calCacheKey)
      if (raw) {
        const dayNotes = JSON.parse(raw)
        const idx = dayNotes.findIndex((n: any) => n.id === updatedNote.id)
        if (idx !== -1) {
          dayNotes[idx] = { ...dayNotes[idx], ...updatedNote }
          localStorage.setItem(calCacheKey, JSON.stringify(dayNotes))
        }
      }
    }
    catch (e) {}
  }
}

// 重写：支持 reset / silent，并使用 created_at 游标向过去翻页
async function fetchNotes(arg?: boolean | { reset?: boolean; silent?: boolean }) {
  let reset = false
  let silent = false

  if (typeof arg === 'boolean') {
    reset = arg
  }
  else if (arg && typeof arg === 'object') {
    reset = !!arg.reset
    silent = !!arg.silent
  }

  if (!user.value)
    return

  // 避免重复加载：正常加载时如果还在 loading 就直接返回
  if (isLoadingNotes.value && !silent)
    return

  if (reset) {
    currentPage.value = 1
    oldestLoadedAt.value = null
    isMonthJumpView.value = false
  }

  // reset 首次加载时要拿到 totalNotes，用 count
  const selectOptions = reset ? { count: 'exact' as const } : { count: 'none' as const }

  let query = supabase
    .from('notes')
    .select('id, content, weather, created_at, updated_at, is_pinned, is_favorited', selectOptions)
    .eq('user_id', user.value.id)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(notesPerPage)

  // 非 reset 情况：只拉“当前最旧 created_at 之前”的一页
  if (!reset && oldestLoadedAt.value)
    query = query.lt('created_at', oldestLoadedAt.value)

  if (!silent)
    isLoadingNotes.value = true

  try {
    const { data, error, count } = await query

    if (error)
      throw error

    const newNotes = data || []

    if (reset) {
      notes.value = newNotes
      totalNotes.value = typeof count === 'number' ? count : totalNotes.value
    }
    else {
      // 追加时做一次去重，避免 prefetch / 手动加载造成重复
      const existing = new Set(notes.value.map(n => n.id))
      const toAppend = newNotes.filter(n => !existing.has(n.id))
      notes.value = [...notes.value, ...toAppend]
      currentPage.value += 1
    }

    // 是否还有下一页：按“这一页是否满页”来判断即可
    hasMoreNotes.value = newNotes.length === notesPerPage

    // 更新“最旧 created_at” 游标
    if (notes.value.length > 0) {
      let minCreated = notes.value[0].created_at
      for (const n of notes.value) {
        if (n.created_at && new Date(n.created_at).getTime() < new Date(minCreated).getTime())
          minCreated = n.created_at
      }
      oldestLoadedAt.value = minCreated
    }
    else {
      oldestLoadedAt.value = null
    }

    // ====== 缓存 & 快照逻辑保持原样 ======
    if (notes.value.length > 0) {
      try {
        localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
        localStorage.setItem(
          CACHE_KEYS.HOME_META,
          JSON.stringify({ totalNotes: totalNotes.value || notes.value.length }),
        )
      }
      catch { /* ignore */ }

      try {
        await saveNotesSnapshot(notes.value)
      }
      catch (e) {
        console.warn('[offline] saveNotesSnapshot failed:', e)
      }
    }

    // ✅ 首次加载时仍然可以走静默预取逻辑（不动你的 silentPrefetchMore）
    if (reset) {
      const TARGET = Math.min(
        (totalNotes.value || Number.POSITIVE_INFINITY), (1 + SILENT_PREFETCH_PAGES) * notesPerPage - 5)
      const loadedEnough = Array.isArray(notes.value) && notes.value.length >= TARGET

      let fresh = false
      try {
        const tsRaw = localStorage.getItem(PREFETCH_LAST_TS_KEY)
        const ts = tsRaw ? Number.parseInt(tsRaw, 10) : 0
        fresh = ts > 0 && (Date.now() - ts) < PREFETCH_TTL_MS
      }
      catch {}

      if (hasMoreNotes.value && !(fresh && loadedEnough))
        silentPrefetchMore()
    }

    // ✅ 拉取成功 => 复位“离线只弹一次”的开关
    offlineToastShown = false
  }
  catch (err: any) {
    const msg = String(err?.message || err)
    const offline = navigator.onLine === false
      || /Failed to fetch|NetworkError|TypeError.*fetch/i.test(msg)

    if (offline) {
      if (!offlineToastShown) {
        offlineToastShown = true
        messageHook.error(t('notes.fetch_error'))
      }
      hasMoreNotes.value = false
    }
    else {
      messageHook.error(t('notes.fetch_error'))
    }
  }
  finally {
    if (!silent)
      isLoadingNotes.value = false
  }
}

async function loadRandomBatchForRandomRoam() {
  if (!user.value)
    return

  // 随机选一个起点
  const total = totalNotes.value || 0
  if (total === 0)
    return

  const BATCH_SIZE = 60
  const randomStart = Math.max(
    0,
    Math.floor(Math.random() * Math.max(1, total - BATCH_SIZE)),
  )
  const randomEnd = randomStart + BATCH_SIZE - 1

  const { data, error } = await supabase
    .from('notes')
    .select('id, content, weather, created_at, updated_at, is_pinned, is_favorited')
    .eq('user_id', user.value.id)
    .order('created_at', { ascending: false })
    .range(randomStart, randomEnd)

  if (error || !data)
    return

  // 合并去重
  const existing = new Set(notes.value.map(n => n.id))
  const toAdd = data.filter(n => !existing.has(n.id))

  if (toAdd.length) {
    notes.value = [...notes.value, ...toAdd]
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
  }
}

async function silentPrefetchMore() {
  // 只在“主页列表”模式下预取；搜索/标签/那年今日时不预取
  if (isPrefetching.value
    || !user.value
    || isAnniversaryViewActive.value
    || activeTagFilter.value
    || isShowingSearchResults.value)
    return

  // 已经没有更多也不预取
  if (!hasMoreNotes.value)
    return

  // 离线不预取
  if (navigator.onLine === false)
    return

  isPrefetching.value = true
  try {
    let page = currentPage.value + 1
    let fetchedPages = 0

    while (fetchedPages < SILENT_PREFETCH_PAGES) {
      // 根据 totalNotes 估算是否还有数据
      const from = (page - 1) * notesPerPage
      const to = from + notesPerPage - 1
      if (totalNotes.value && from >= totalNotes.value)
        break

      // 与 fetchNotes 同样的查询，但不触发任何加载动画
      const { data, error } = await supabase
        .from('notes')
        .select('id, content, weather, created_at, updated_at, is_pinned')
        .eq('user_id', user.value.id)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error)
        break
      const pageNotes = data || []
      if (pageNotes.length === 0)
        break

      // 直接“默默地”并入现有列表
      const existing = new Set(notes.value.map(n => n.id))
      const toAppend = pageNotes.filter(n => !existing.has(n.id))
      if (toAppend.length) {
        notes.value = [...notes.value, ...toAppend]
        try {
          localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
          localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
          await saveNotesSnapshot(notes.value)
        }
        catch {}
      }

      currentPage.value = page
      page++
      fetchedPages++

      if (pageNotes.length < notesPerPage)
        break

      await Promise.resolve()
    }

    hasMoreNotes.value = notes.value.length < (totalNotes.value || 0)

    // ✅ 仅当确实抓到数据时，记录 24 小时冷却时间戳
    if (fetchedPages > 0) {
      try {
        localStorage.setItem(PREFETCH_LAST_TS_KEY, String(Date.now()))
      }
      catch {}
    }
  }
  finally {
    isPrefetching.value = false
  }
}

// ✨ 统一的标签分页加载器（支持有/无标签）
async function fetchNotesByTagPage(hashTag: string, page = 1) {
  // ✅ 使用局部固定键名，避免 TDZ
  const KEY_TAG_CACHE_DIRTY = 'tag_cache_dirty_ts'

  isLoadingNotes.value = true
  try {
    const isUntagged = hashTag === UNTAGGED_SENTINEL
    let notesData: any[] = []
    let totalCount = 0

    const from = (page - 1) * notesPerPage
    const to = from + notesPerPage - 1

    // === 脏窗口：刚有标签相关改动 → 清掉本标签旧缓存，强制用新数据覆盖 ===
    const cacheKey = getTagCacheKey(hashTag)
    let hitDirtyBypass = false
    try {
      const tsRaw = localStorage.getItem(KEY_TAG_CACHE_DIRTY)
      if (tsRaw && Date.now() - Number(tsRaw) < 3000) { // 3s 窗口
        hitDirtyBypass = true
        if (page === 1)
          localStorage.removeItem(cacheKey)
      }
    }
    catch { /* ignore */ }

    if (isUntagged) {
      const { data: rpcData, error } = await supabase
        .rpc('get_untagged_notes_paginated', {
          p_user_id: user.value!.id,
          p_limit: notesPerPage,
          p_offset: from,
        })
      if (error)
        throw error

      notesData = rpcData || []
      totalCount = rpcData?.[0]?.total_count || 0
    }
    else {
      // 父标签能命中子标签：'#运动' 会命中包含 '#运动/跑步' 的内容
      const { data, error, count } = await supabase
        .from('notes')
        .select('id, content, weather, created_at, updated_at, is_pinned, is_favorited', { count: 'exact' })
        .eq('user_id', user.value!.id)
        .ilike('content', `%${hashTag}%`)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error)
        throw error
      notesData = data || []
      totalCount = count || 0
    }

    // 更新 UI
    notes.value = page === 1 ? notesData : [...notes.value, ...notesData]
    filteredNotesCount.value = totalCount
    hasMoreNotes.value = notes.value.length < totalCount

    // 覆盖写入“新鲜缓存”
    const cachePayload = {
      notes: notes.value,
      currentPage: page,
      totalCount,
      hasMore: hasMoreNotes.value,
      _cachedAt: Date.now(),
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(cachePayload))
    }
    catch {
      /* ignore quota */
    }

    // 刷新过第一页后可移除脏标记（避免长期绕过缓存）
    if (hitDirtyBypass && page === 1) {
      try {
        localStorage.removeItem(KEY_TAG_CACHE_DIRTY)
      }
      catch {
        /* ignore */
      }
    }
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message || err}`)
    hasMoreNotes.value = false
  }
  finally {
    isLoadingNotes.value = false
  }
}
async function handleTrashRestored(restoredNotes?: any[]) {
  // ✅ 1. 先清理标签缓存（移到这里）
  invalidateAllTagCaches()

  // 如果当前不是主页列表（有搜索/标签/那年今日），保持不打断，仅刷新数据源
  const inFilteredView = isAnniversaryViewActive.value || activeTagFilter.value || isShowingSearchResults.value

  if (Array.isArray(restoredNotes) && restoredNotes.length > 0 && !inFilteredView) {
    // 主页列表：把恢复的笔记插到最前，去重后按置顶/时间重新排
    const existIds = new Set(notes.value.map(n => n.id))
    const toInsert = restoredNotes.filter(n => n && !existIds.has(n.id))

    if (toInsert.length > 0) {
      notes.value = [...toInsert, ...notes.value]
      // 与现有排序规则保持一致：先 is_pinned，再 created_at desc
      notes.value.sort(
        (a, b) =>
          (b.is_pinned - a.is_pinned)
          || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      )
      // 元数据与缓存
      totalNotes.value = (totalNotes.value || 0) + toInsert.length
      localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
      localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
    }
  }
  else {
    currentPage.value = 1
    oldestLoadedAt.value = null
    await fetchNotes(true)
  }

  // ⭐ 核心修复：强制刷新“那年今日”，绕过本地缓存
  if (anniversaryBannerRef.value?.loadAnniversaryNotes)
    await anniversaryBannerRef.value.loadAnniversaryNotes(true)
}

async function handleTrashPurged() {
  // ✅ 1. 先清理标签缓存
  invalidateAllTagCaches()

  // 2. 重新拉取列表
  await fetchNotes(true)
}

function handleHeaderClick() {
  // 行为与右下角箭头保持一致：
  // 在年月跳转视图下 → 回到今天页；
  // 在 HOME 下 → 单纯滚到顶部。
  restoreHomeAndScrollTop()
}

// ⭐ 统一处理“回到顶部 / 回到首页”逻辑：
// - 在年月跳转视图下：先恢复首页，再滚到顶部
// - 其余情况下：只滚到顶部，不清理搜索/标签/那年今日等状态
async function restoreHomeAndScrollTop() {
  // 1. 仅当当前是“年月跳转视图”时，才尝试恢复首页数据
  if (isMonthJumpView.value) {
    const restored = restoreHomepageFromCache()

    // 如果没有缓存、且在线，再兜底拉一遍首页
    if (!restored && navigator.onLine !== false)
      await fetchNotes(true)
  }

  // 2. 回到顶部（对当前视图：主页 / 搜索结果 / 标签筛选 / 那年今日 都只滚动）
  await nextTick()
  if (noteListRef.value)
    (noteListRef.value as any).scrollToTop?.()

  showScrollTopButton.value = false
}

async function nextPage() {
  if (isLoadingNotes.value || !hasMoreNotes.value)
    return

  currentPage.value++

  if (activeTagFilter.value) {
    // 标签筛选下的翻页（含无标签）
    isLoadingNotes.value = true
    try {
      await fetchNotesByTagPage(activeTagFilter.value, currentPage.value)
    }
    catch (e: any) {
      messageHook.error(`${t('notes.fetch_error')}: ${e.message || e}`)
      hasMoreNotes.value = false
    }
    finally {
      isLoadingNotes.value = false
    }
  }
  else {
    // 主页翻页
    await fetchNotes()
  }
}

// 本地应用“删除”并刷新缓存/快照（单条或批量都可复用）
async function applyLocalDeletion(idsToDelete: string[]) {
  // 1) 更新 UI 列表
  const toDelete = new Set(idsToDelete)
  const deletedNotes = notes.value.filter(n => toDelete.has(n.id)) // 用于缓存失效
  notes.value = notes.value.filter(n => !toDelete.has(n.id))
  cachedNotes.value = cachedNotes.value.filter(n => !toDelete.has(n.id))
  notifyAnniversaryDelete(idsToDelete)
  // 如果当前正在查看“那年今日”视图（虽然applyLocalDeletion通常发生在这里），也同步内存变量
  if (anniversaryNotes.value && anniversaryNotes.value.length > 0)
    anniversaryNotes.value = anniversaryNotes.value.filter(n => !toDelete.has(n.id))

  // 2) 维护 total / 分页元数据
  const delta = idsToDelete.length
  totalNotes.value = Math.max(0, (totalNotes.value || 0) - delta)
  hasMoreNotes.value = currentPage.value * notesPerPage < totalNotes.value
  hasPreviousNotes.value = currentPage.value > 1

  // 3) 失效相关缓存（标签、日历、搜索）
  for (const note of deletedNotes) {
    try {
      invalidateCachesOnDataChange(note)
    }
    catch {
      // 忽略单条缓存失效异常
    }
  }

  // 4) 刷新 localStorage
  try {
    localStorage.setItem(CACHE_KEYS.HOME, JSON.stringify(notes.value))
    localStorage.setItem(CACHE_KEYS.HOME_META, JSON.stringify({ totalNotes: totalNotes.value }))
  }
  catch {
    // 忽略 localStorage 写入异常
  }

  // 5) 写入 IndexedDB 快照（离线冷启动直接还原）
  try {
    await saveNotesSnapshot(notes.value)
  }
  catch (e) {
    console.warn('[offline] saveNotesSnapshot failed after deletion:', e)
  }
}

async function triggerDeleteConfirmation(id: string) {
  if (!id || !user.value?.id)
    return

  dialog.warning({
    title: t('notes.delete_confirm_title'),
    content: t('notes.delete_confirm_content'),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      try {
        // —— A) 离线分支 (保持不变) ——
        if (!isOnline()) {
          await queuePendingDelete(id)
          await applyLocalDeletion([id])
          if (showCalendarView.value && calendarViewRef.value) {
            ;(calendarViewRef.value as any).commitDelete?.(id)
          }
          messageHook.success(t('notes.delete_success'))
          return
        }

        // —— B) 在线分支 ——

        // 1. 先请求服务器删除
        const { error } = await supabase
          .from('notes')
          .delete()
          .eq('id', id)
          .eq('user_id', user.value!.id)

        if (error)
          throw new Error(error.message)

        // 2. 🔥【核心修改】服务器删成功了，立刻调用本地强力清理函数
        // applyLocalDeletion 会同时处理：
        // - notes.value (内存)
        // - localStorage (主页缓存)
        // - IndexedDB (离线快照) <-- 之前可能漏了这里
        // - 标签/日历缓存失效
        await applyLocalDeletion([id])

        // 3. 额外的 UI 清理
        anniversaryBannerRef.value?.removeNoteById(id)
        if (showCalendarView.value && calendarViewRef.value) {
          ;(calendarViewRef.value as any).commitDelete?.(id)
        }

        // 4. 清理全局搜索缓存 (以防万一)
        invalidateAllSearchCaches()

        messageHook.success(t('notes.delete_success'))
      }
      catch (err: any) {
        messageHook.error(`删除失败: ${err.message || '请稍后重试'}`)
      }
    },
  })
}

async function handleNoteContentClick({ noteId, itemIndex }: { noteId: string; itemIndex: number }) {
  const noteToUpdate = notes.value.find(n => n.id === noteId)
  if (!noteToUpdate)
    return

  const originalContent = noteToUpdate.content
  try {
    const lines = originalContent.split('\n')
    const taskLineIndexes: number[] = []
    lines.forEach((line, index) => {
      if (line.trim().match(/^\-\s\[( |x)\]/))
        taskLineIndexes.push(index)
    })
    if (itemIndex < taskLineIndexes.length) {
      const lineIndexToChange = taskLineIndexes[itemIndex]
      const lineContent = lines[lineIndexToChange]
      lines[lineIndexToChange] = lineContent.includes('[ ]') ? lineContent.replace('[ ]', '[x]') : lineContent.replace('[x]', '[ ]')
      const newContent = lines.join('\n')
      noteToUpdate.content = newContent
      await supabase.from('notes').update({ content: newContent, updated_at: new Date().toISOString() }).eq('id', noteId).eq('user_id', user.value!.id)
    }
  }
  catch (err: any) {
    noteToUpdate.content = originalContent
    messageHook.error(`${t('notes.update_error')}: ${err.message}`)
  }
}

async function handleCopy(noteContent: string) {
  if (!noteContent)
    return

  try {
    await navigator.clipboard.writeText(noteContent)
    messageHook.success(t('notes.copy_success'))
  }
  catch (err) {
    messageHook.error(t('notes.copy_error'))
  }
}

function toggleSearchBar() {
  const willShow = !showSearchBar.value
  showSearchBar.value = willShow
  showDropdown.value = false

  // 🔒 互斥规则：打开“搜索”时，若当前有标签筛选，则关闭标签筛选
  if (willShow && activeTagFilter.value)
    clearTagFilter()
}

function handleCancelSearch() {
  // 1. 【优先】立即隐藏搜索栏
  searchQuery.value = ''
  showSearchBar.value = false

  // 2. 调用上面的函数（由于上面的函数内部已经加了 setTimeout，这里直接调即可）
  handleSearchCleared()
}

// 在 auth.vue 中找到这个函数

function handleAnniversaryToggle(data: any[] | null) {
  if (data) {
    // 进入“那年今日”视图
    anniversaryNotes.value = data
    isAnniversaryViewActive.value = true
    hasMoreNotes.value = false

    // ++ 新增：持久化“那年今日”状态与结果
    localStorage.setItem(SESSION_ANNIV_ACTIVE_KEY, 'true')
    try {
      localStorage.setItem(SESSION_ANNIV_RESULTS_KEY, JSON.stringify(data))
    }
    catch {
      // 若超出容量，仅保留激活标记
      sessionStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
    }
  }
  else {
    // 退出“那年今日”视图
    anniversaryNotes.value = null
    isAnniversaryViewActive.value = false
    hasMoreNotes.value = notes.value.length < totalNotes.value

    // ++ 新增：清理持久化
    localStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
    localStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)
  }
}

// === 选择模式：仅修改选择相关逻辑 ===
function toggleSelectionMode() {
  const willEnable = !isSelectionModeActive.value
  isSelectionModeActive.value = willEnable

  if (willEnable) {
    // 进入选择模式：立刻隐藏搜索条（条幅将显示）
    // showSearchBar.value = false
  }
  else {
    // 退出选择模式：清空选择
    selectedNoteIds.value = []
  }

  showDropdown.value = false
}

function finishSelectionMode() {
  isSelectionModeActive.value = false
  selectedNoteIds.value = []
}

function handleToggleSelect(noteId: string) {
  if (!isSelectionModeActive.value)
    return

  const index = selectedNoteIds.value.indexOf(noteId)
  if (index > -1)
    selectedNoteIds.value.splice(index, 1)
  else
    selectedNoteIds.value.push(noteId)
}

async function handleCopySelected() {
  if (selectedNoteIds.value.length === 0)
    return

  const notesToCopy = notes.value.filter(note => selectedNoteIds.value.includes(note.id))
  const textContent = notesToCopy.map(note => note.content).join('\n\n---\n\n')
  try {
    await navigator.clipboard.writeText(textContent)
    messageHook.success(t('notes.copy_success_multiple', { count: notesToCopy.length }))
  }
  catch (err) {
    messageHook.error(t('notes.copy_error'))
  }
  finally {
    isSelectionModeActive.value = false
    selectedNoteIds.value = []
  }
}

// 1. 触发弹窗：让用户选择标签
function handleBatchTagTrigger() {
  if (selectedNoteIds.value.length === 0)
    return

  const selectedTagToAdd = ref<string | null>(null)

  // 构造下拉选项
  const tagOptions = allTags.value.map(tag => ({
    label: tag,
    value: tag,
  }))

  dialog.info({
    title: t('notes.batch_tag_title'), // 替换标题
    content: () => h('div', { style: 'display:flex;flex-direction:column;gap:8px;' }, [
      // 替换带变量的内容
      h('div', {}, t('notes.batch_tag_content', { count: selectedNoteIds.value.length })),
      h(NSelect, {
        filterable: true,
        tag: true,
        placeholder: t('notes.tag_placeholder'), // 替换占位符
        options: tagOptions,
        onUpdateValue: (v: string) => { selectedTagToAdd.value = v },
      }),
    ]),
    positiveText: t('notes.confirm_add'), // 替换确定按钮
    negativeText: t('notes.cancel'), // 替换取消按钮
    onPositiveClick: async () => {
      if (!selectedTagToAdd.value) {
        messageHook.warning(t('notes.select_tag_first')) // 替换警告
        return false
      }
      // 执行批量添加
      await executeBatchAddTag(selectedTagToAdd.value)
    },
  })
}

// 2. 执行更新逻辑
async function executeBatchAddTag(tagRaw: string) {
  // 确保标签格式化 (比如加 #)
  const tag = tagRaw.startsWith('#') ? tagRaw : `#${tagRaw}`
  const cleanTag = tag.trim()

  loading.value = true
  try {
    const ids = [...selectedNoteIds.value]
    let successCount = 0

    // 循环处理每一条选中的笔记
    // 💡 为什么不用批量 update? 因为每条笔记原本的内容不一样，必须 append
    for (const id of ids) {
      const note = notes.value.find(n => n.id === id)
      if (!note)
        continue

      // 检查是否已经有这个标签，避免重复 (简单检查)
      if (note.content.includes(cleanTag))
        continue

      // 在末尾追加标签 (前面加空格)
      const newContent = `${note.content} ${cleanTag}`

      // 复用你已有的 saveNote 函数（它已经完美处理了 离线/在线/队列/缓存）
      // 注意：这里不需要 showMessage，否则会弹几十次提示
      await saveNote(newContent, id, { showMessage: false })
      successCount++
    }

    messageHook.success(t('notes.batch_tag_success', { count: successCount }))

    // 退出选择模式
    isSelectionModeActive.value = false
    selectedNoteIds.value = []
  }
  catch (e: any) {
    messageHook.error(t('notes.batch_tag_error', { msg: e.message }))
  }
  finally {
    loading.value = false
  }
}

async function handleDeleteSelected() {
  // ✅ 修复点1：换行写 return
  if (selectedNoteIds.value.length === 0)
    return

  dialog.warning({
    title: t('dialog.delete_note_title'),
    content: t('dialog.delete_note_content2', { count: selectedNoteIds.value.length }),
    positiveText: t('notes.confirm_delete'),
    negativeText: t('notes.cancel'),
    onPositiveClick: async () => {
      try {
        loading.value = true
        const idsToDelete = [...selectedNoteIds.value]

        // —— A) 离线分支 ——
        if (!isOnline()) {
          for (const id of idsToDelete) {
            // ✅ 修复点2：展开 try-catch，避免同样的 linter 报错
            try {
              await queuePendingDelete(id)
            }
            catch (e) {
              console.warn('[offline] queue failed', e)
            }
          }
          await applyLocalDeletion(idsToDelete)

          // 清理编辑状态
          if (lastSavedId.value && idsToDelete.includes(lastSavedId.value)) {
            newNoteContent.value = ''
            lastSavedId.value = null
            editingNote.value = null
            localStorage.removeItem(LOCAL_NOTE_ID_KEY)
            localStorage.removeItem(LOCAL_CONTENT_KEY)
          }

          isSelectionModeActive.value = false
          selectedNoteIds.value = []
          messageHook.success(t('notes.delete_success_multiple', { count: idsToDelete.length }))
          return
        }

        // —— B) 在线分支 ——

        // 1. 数据库删除
        const { error } = await supabase
          .from('notes')
          .delete()
          .in('id', idsToDelete)
          .eq('user_id', user.value!.id)

        if (error)
          throw new Error(error.message)

        // 2. 🔥【核心修改】直接调用统一清理函数
        // 它会负责把这批 ID 从 内存、LocalStorage 和 IndexedDB 中彻底抹去
        await applyLocalDeletion(idsToDelete)

        // 3. 扫尾工作
        invalidateAllSearchCaches() // 搜索缓存全部作废

        // 清理编辑区
        if (lastSavedId.value && idsToDelete.includes(lastSavedId.value)) {
          newNoteContent.value = ''
          lastSavedId.value = null
          editingNote.value = null
          localStorage.removeItem(LOCAL_NOTE_ID_KEY)
          localStorage.removeItem(LOCAL_CONTENT_KEY)
        }

        // 退出选择模式
        isSelectionModeActive.value = false
        selectedNoteIds.value = []

        messageHook.success(t('notes.delete_success_multiple', { count: idsToDelete.length }))
      }
      catch (err: any) {
        messageHook.error(`${t('notes.delete_error')}: ${err.message || t('notes.try_again')}`)
      }
      finally {
        loading.value = false
      }
    },
  })
}

function handleMainMenuSelect(key: string) {
  // 处理来自 Sidebar 的点击事件
  if (key === 'calendar') {
    showCalendarView.value = true
  }
  else if (key === 'toggleSelection') {
    toggleSelectionMode()
  }
  else if (key === 'settings') {
    showSettingsModal.value = true
  }
  else if (key === 'export') {
    showDataBackup.value = true
  }
  else if (key === 'account') {
    showAccountModal.value = true
  }
  else if (key === 'randomRoam') {
    showRandomRoam.value = true
  }
  else if (key === 'trash') {
    showTrashModal.value = true
  }
  else if (key === 'help') {
    showHelpDialog.value = true
  }
  else if (key === 'activation') {
    canDismissActivation.value = true
    showActivation.value = true
  }
  else if (key === 'defaultCity') {
    showCitySelectionDialog.value = true
  }
  else if (key === 'feedback') {
    window.location.href = '/apply?from=auth'
  }
}

async function handleDataRefresh() {
  // 重置分页并重新拉取
  await fetchNotes({ reset: true })
}

async function handleEditFromCalendar(noteToFind: any) {
  // 1. 关闭日历视图并清理所有筛选状态（这部分保持不变）
  showCalendarView.value = false
  if (isAnniversaryViewActive.value)
    handleAnniversaryToggle(null)
  if (activeTagFilter.value)
    clearTagFilter()
  if (searchQuery.value || isShowingSearchResults.value)
    handleCancelSearch()
  await nextTick()

  // 2. 检查笔记是否已在当前加载的列表中
  const noteExists = notes.value.some(n => n.id === noteToFind.id)

  if (noteExists) {
    // 情况A：笔记已在列表中，这是理想情况，直接定位即可
    if (noteListRef.value)
      (noteListRef.value as any).focusAndEditNote(noteToFind.id)

    return
  }

  // 情况B：笔记不在列表中，这是问题的核心，需要从服务器分页加载直到找到它
  isLoadingNotes.value = true // 显示加载动画
  notes.value = [] // 清空当前列表
  currentPage.value = 1 // 重置页码
  hasMoreNotes.value = true // 假定有更多数据可以加载

  // 循环加载，直到找到笔记或加载完所有笔记
  while (hasMoreNotes.value) {
    // fetchNotes 会根据 currentPage 加载该页数据并追加到 notes 数组
    await fetchNotes()

    // 检查新加载的这页数据里是否包含我们的目标笔记
    const found = notes.value.some(n => n.id === noteToFind.id)
    if (found) {
      // 找到了！
      isLoadingNotes.value = false // 隐藏加载动画
      await nextTick() // 等待DOM更新
      if (noteListRef.value) {
        // 命令 NoteList 组件定位并编辑
        (noteListRef.value as any).focusAndEditNote(noteToFind.id)
      }
      return // 任务完成，退出函数
    }

    // 如果当前页没找到，且服务器确认还有更多数据，则准备加载下一页
    if (hasMoreNotes.value)
      currentPage.value++
  }

  // 如果循环结束但仍未找到笔记（这是一种边缘情况，比如笔记在别处被删了）
  isLoadingNotes.value = false
  // 作为最后的保障，使用旧的 unshift 方法，至少让用户能编辑这条笔记，即使位置不对
  notes.value.unshift(noteToFind)
  await nextTick()
  if (noteListRef.value)
    (noteListRef.value as any).focusAndEditNote(noteToFind.id)
}

useOfflineSync()

async function fetchNotesByTag(tag: string) {
  // --- 状态清理逻辑保持不变 ---
  if (isAnniversaryViewActive.value) {
    anniversaryBannerRef.value?.setView(false)
    isAnniversaryViewActive.value = false
    anniversaryNotes.value = null
  }
  if (!tag || !user.value)
    return

  const hashTag = tag === UNTAGGED_SENTINEL
    ? UNTAGGED_SENTINEL
    : (tag.startsWith('#') ? tag : `#${tag}`)

  isShowingSearchResults.value = false
  showSearchBar.value = false
  searchQuery.value = ''
  localStorage.removeItem(SESSION_ANNIV_ACTIVE_KEY)
  localStorage.removeItem(SESSION_ANNIV_RESULTS_KEY)

  activeTagFilter.value = hashTag
  isLoadingNotes.value = true

  // --- 核心修改：优先从缓存加载 ---
  const cacheKey = getTagCacheKey(hashTag)
  const cachedRaw = localStorage.getItem(cacheKey)

  if (cachedRaw) {
    try {
      const cachedData = JSON.parse(cachedRaw)
      // 从缓存恢复已加载的笔记、页码、总数和分页状态
      notes.value = cachedData.notes || []
      currentPage.value = cachedData.currentPage || 1
      filteredNotesCount.value = cachedData.totalCount || 0
      hasMoreNotes.value = cachedData.hasMore ?? true
      isLoadingNotes.value = false // 加载完成
      return // 缓存命中，直接结束函数
    }
    catch (e) {
      localStorage.removeItem(cacheKey) // 缓存损坏，清除它
    }
  }

  // --- 如果没有缓存，才执行网络请求 ---
  notes.value = [] // 首次加载前清空
  currentPage.value = 1
  hasMoreNotes.value = true
  filteredNotesCount.value = 0

  try {
    await fetchNotesByTagPage(hashTag, 1) // 调用分页加载器获取第一页
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message || err}`)
  }
  finally {
    isLoadingNotes.value = false
  }
}

function clearTagFilter() {
  // 1. 【优先】UI 状态立即变更，让横幅瞬间消失
  activeTagFilter.value = null
  headerCollapsed.value = false

  // 2. 【推迟】繁重的数据恢复逻辑，给浏览器喘息时间先渲染 UI
  setTimeout(() => {
    if (!restoreHomepageFromCache()) {
      currentPage.value = 1
      oldestLoadedAt.value = null
      fetchNotes(true)
    }
    noteListKey.value++ // 强制刷新列表
  }, 10)
}
// 避免 ESLint 误报这些在模板中使用的函数“未使用”
const _usedTemplateFns = [handleCopySelected, handleDeleteSelected, handleEditFromCalendar]

function goToLinksSite() {
  window.location.assign('/?from=notes')
}

function onCalendarCreated(note: any) {
  addNoteToList(note)
  invalidateCachesOnDataChange(note)
  refreshTags()
}

function onCalendarUpdated(updated: any) {
  updateNoteInList(updated)

  try {
    invalidateCachesOnDataChange(updated)
  }
  catch (e) {
    // noop
  }

  // fetchAllTags()

  // 异步快照：不阻塞，不抛错影响提交流程
  saveNotesSnapshot(notes.value).catch(() => {})

  if (
    isAnniversaryViewActive.value
    && Array.isArray(anniversaryNotes.value)
  ) {
    anniversaryNotes.value = anniversaryNotes.value.map(n =>
      n.id === updated.id ? { ...n, ...updated } : n,
    )
  }
}
</script>

<template>
  <div
    class="full-viewport auth-container"
    :class="{ 'is-typing': compactWhileTyping }"
    :aria-busy="!isReady"
    :style="themeStyle"
  >
    <template v-if="user || !authResolved">
      <div v-show="!isEditorActive && !isTopEditing" class="page-header" @click="handleHeaderClick">
        <div class="header-left" @click.stop="showSidebar = true">
          <AvatarImage
            v-if="user?.user_metadata?.avatar_url"
            :user-id="user.id"
            :src="user.user_metadata.avatar_url"
            class="header-avatar"
            alt="User"
          />

          <img
            v-else
            src="/icons/pwa-192.png"
            class="header-logo-btn"
            alt="Menu"
          >
        </div>
        <div class="header-actions">
          <button class="header-action-btn" @click.stop="toggleSearchBar">🔍</button>
          <button
            class="header-action-btn"
            aria-label="t('auth.go_to_links')"
            @click="goToLinksSite"
          >
            <House :size="18" />
          </button>
        </div>
      </div>
      <Sidebar
        :show="showSidebar"
        :user="user"
        :total-notes="totalNotes"
        :tag-count="allTags.length"
        :tag-menu-options="tagMenuChildren" @close="showSidebar = false"
        @menu-click="handleMainMenuSelect"
      />

      <AnniversaryBanner
        v-if="(!showSearchBar || hasSearchRun) && showAnniversaryBanner && !headerCollapsed"
        ref="anniversaryBannerRef"
        :theme-color="currentThemeColor"
        @toggle-view="handleAnniversaryToggle"
      />

      <!-- 顶部选择模式条幅（进入选择模式立刻显示；0 条也显示） -->
      <Transition name="slide-fade">
        <div
          v-if="isSelectionModeActive"
          class="selection-actions-banner"
          role="region"
          aria-live="polite"
        >
          <div class="banner-left">
            <strong>{{ $t('notes.select_notes') }}</strong>
            <span class="sep">·</span>
            <span>{{ $t('notes.items_selected', { count: selectedNoteIds.length }) }}</span>
          </div>
          <div class="banner-right">
            <button
              class="action-btn copy-btn"
              :disabled="selectedNoteIds.length === 0"
              @click="handleCopySelected"
            >
              {{ $t('notes.copy') }}
            </button>
            <button
              class="action-btn tag-btn"
              :disabled="selectedNoteIds.length === 0"
              @click="handleBatchTagTrigger"
            >
              {{ $t('notes.editor.toolbar.add_tag') || '添加标签' }}
            </button>
            <button
              class="action-btn delete-btn"
              :disabled="selectedNoteIds.length === 0"
              @click="handleDeleteSelected"
            >
              {{ $t('notes.delete') }}
            </button>
            <button
              class="close-results-btn selection-close-btn"
              aria-label="退出选择模式"
              @click="finishSelectionMode"
            >
              <X :size="18" :stroke-width="3" />
            </button>
          </div>
        </div>
      </Transition>

      <Transition name="slide-fade">
        <div v-if="showSearchBar" v-show="!isEditorActive && !isSelectionModeActive && !isTopEditing" class="search-bar-container">
          <NoteActions
            ref="noteActionsRef"
            v-model="searchQuery"
            class="search-actions-wrapper"
            :all-tags="allTags"
            :is-exporting="isExporting"
            :search-query="searchQuery"
            :user="user"
            :show-export-button="!isShowingSearchResults"
            :theme-color="currentThemeColor"
            @export="handleExportTrigger"
            @search-started="handleSearchStarted"
            @search-completed="handleSearchCompleted"
            @search-cleared="handleSearchCleared"
          />
          <button class="cancel-search-btn" @click="handleCancelSearch">{{ $t('notes.cancel') }}</button>
        </div>
      </Transition>

      <DataBackup
        v-model:show="showDataBackup"
        :user="user"
        :all-tags="allTags"
        @refresh="handleDataRefresh"
      />

      <div v-if="activeTagFilter && (!showSearchBar || hasSearchRun)" v-show="!isEditorActive && !isSelectionModeActive && !isTopEditing" class="active-filter-bar">
        <span class="banner-info">
          <span class="banner-text-main">
            {{ t('notes.filtering_by_tag') }}：<strong>{{ activeTagFilter === UNTAGGED_SENTINEL ? ($t('tags.untagged') || '∅ 无标签') : activeTagFilter }}</strong>
          </span>
          <span class="banner-text-count">
            {{ t('notes.count_notes', { count: filteredNotesCount }) }}
          </span>
        </span>

        <button
          class="close-results-btn"
          @click="clearTagFilter()"
        >
          <X :size="18" :stroke-width="3" />
        </button>
      </div>

      <div v-if="isShowingSearchResults && (!showSearchBar || hasSearchRun)" v-show="!isEditorActive && !isSelectionModeActive && !isTopEditing" class="active-filter-bar search-results-bar">
        <span class="banner-info">
          <span class="banner-text-main">
            <i18n-t keypath="notes.search_results_for" tag="span">
              <template #query>
                <strong>{{ searchQuery }}</strong>
              </template>
            </i18n-t>
          </span>
          <span class="banner-text-count">
            {{ t('notes.count_notes', { count: notes.length }) }}
          </span>
        </span>

        <button class="close-results-btn" @click="noteActionsRef ? noteActionsRef.clearSearch() : handleSearchCleared()">
          <X :size="18" :stroke-width="3" />
        </button>
      </div>

      <!-- 主页输入框：选择模式时隐藏 -->
      <div
        v-if="showComposer && !isSelectionModeActive && !isTopEditing"
        ref="newNoteEditorContainerRef"
        class="new-note-editor-container composer-active"
        :class="{ collapsed: headerCollapsed }"
      >
        <NoteEditor
          ref="newNoteEditorRef"
          v-model="newNoteContent"
          :is-editing="false"
          :is-loading="isCreating"
          :max-note-length="maxNoteLength"
          :placeholder="$t('notes.content_placeholder')"
          :all-tags="allTags"
          :tag-counts="tagCounts"
          enable-drafts
          :draft-key="LOCAL_CONTENT_KEY"
          :enable-scroll-push="true"
          @save="handleCreateNote"
          @focus="onEditorFocus"
          @blur="onEditorBlur"
          @cancel="closeComposer"
        />
      </div>

      <div v-if="showNotesList && (!showSearchBar || hasSearchRun)" class="notes-list-container">
        <NoteList
          ref="noteListRef" :key="noteListKey"
          :notes="displayedNotes"
          :is-loading="isLoadingNotes"
          :has-more="hasMoreNotes"
          :is-selection-mode-active="isSelectionModeActive"
          :selected-note-ids="selectedNoteIds"
          :all-tags="allTags"
          :max-note-length="maxNoteLength"
          :search-query="searchQuery"
          @load-more="nextPage"
          @update-note="handleUpdateNote"
          @delete-note="triggerDeleteConfirmation"
          @pin-note="handlePinToggle"
          @copy-note="handleCopy"
          @task-toggle="handleNoteContentClick"
          @toggle-select="handleToggleSelect"
          @date-updated="handleDateOrContentUpdate"
          @scrolled="onListScroll"
          @editing-state-change="isTopEditing = $event"
          @favorite-note="handleFavoriteNote"
          @month-header-click="() => {
            if (
              isAnniversaryViewActive
              || activeTagFilter
              || isShowingSearchResults
              || isSelectionModeActive //
            ) return

            openYearMonthPicker()
          }"
        />
      </div>

      <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />
      <AccountModal :show="showAccountModal" :email="user?.email" :total-notes="totalNotes" :user="user" :theme-color="currentThemeColor" @close="showAccountModal = false" />

      <Transition name="slide-up-fade">
        <CalendarView
          v-if="showCalendarView" ref="calendarViewRef"
          :theme-color="currentThemeColor"
          @close="showCalendarView = false"
          @created="onCalendarCreated"
          @updated="(payload) => {
            onCalendarUpdated(payload)
            handleDateOrContentUpdate(payload)
          }"
          @edit-note="handleEditFromCalendar"
          @copy="handleCopy"
          @pin="handlePinToggle"
          @delete="triggerDeleteConfirmation"
          @favorite="handleFavoriteNote"
        />
      </Transition>
      <Transition name="slide-up-fade">
        <RandomRoam
          v-if="showRandomRoam"
          :notes="notes"
          :theme-color="currentThemeColor"
          :total-notes="totalNotes"
          :has-more="hasMoreNotes"
          :is-loading="isLoadingNotes"
          :load-more="nextPage"
          :load-random-batch="loadRandomBatchForRandomRoam"
          @close="showRandomRoam = false"
        />
      </Transition>
      <Transition name="fade">
        <button
          v-if="showScrollTopButton && !showRandomRoam && !showCalendarView && !showComposer && !isTopEditing"
          class="scroll-top-button"
          aria-label="t('auth.back_to_top')"
          @click="handleScrollTopClick"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </Transition>
      <!-- 毛玻璃遮罩：点击空白处关闭输入框 -->
      <div
        v-if="showComposer"
        class="composer-overlay"
        aria-hidden="true"
        @click="closeComposer"
      />

      <!-- 右下角 “+” 悬浮按钮：仅在未展开输入框时显示 -->
      <button
        v-if="!showSidebar && !isSelectionModeActive && !showComposer && !isTopEditing && !showCalendarView && !showRandomRoam && !showSearchBar"
        class="fab-add"
        aria-label="新建笔记"
        @click="openComposer"
      >
        +
      </button>

      <TrashModal
        :show="showTrashModal"
        @close="showTrashModal = false"
        @restored="handleTrashRestored"
        @purged="handleTrashPurged"
      />

      <ActivationModal
        :show="showActivation"
        :allow-close="canDismissActivation"
        :activated="isUserActivated"
        :days-remaining="daysRemaining"
        :theme-color="currentThemeColor"
        @close="showActivation = false"
        @success="onActivationSuccess"
      />
    </template>
    <template v-else>
      <Authentication />
    </template>
  </div>
  <HelpDialog :show="showHelpDialog" @close="showHelpDialog = false" />
</template>

<style scoped>
.auth-container {
  max-width: 480px;
  margin: 0 auto;
  padding: 0 1.5rem; /* 安全修改：仅移除底部的 0.75rem padding */
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: system-ui, sans-serif;
  display: flex;
  flex-direction: column;

  min-height: 100%;
  overflow: visible;
  position: relative;
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}
.notes-list-container {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  overflow-y: hidden;
  position: relative;
}
.new-note-editor-container {
  padding-top: 0.5rem;
  padding-bottom: 1rem;
  flex-shrink: 0;
}
.page-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 3000; /* [PATCH-Z] 提高层级，确保 X/菜单永远可点 */
  background: white;
  height: 44px;
  padding-top: 0.75rem;
}
.dark .page-header {
  background: #1e1e1e;
}

/* 标题本身不再绝对定位，跟着 flex 正常排布就好 */
.page-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-60%, -50%);

  /* 新增：让内部内容以 flex 居中对齐 */
  display: flex;
  align-items: center;
  justify-content: center;

  margin: 0;
  padding: 0;
  font-size: 22px;
  font-weight: 600;
}

/* 新增：让 logo 和文字作为一个整体紧挨排在一起 */
.page-title-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;           /* 间距很小，几乎是“紧挨着” */
}

.page-title-logo {
  width: 36px;
  height: 36px;
  display: block;
  flex-shrink: 0;
  object-fit: contain;
  transform: translateY(2px); /* ← 只移动 Logo，不动文字 */
}

.page-title-text {
  /* 可选：以后想调字重、字距可以写在这里 */
}
.dark .page-title {
    color: #f0f0f0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header-action-btn {
  font-size: 16px;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #555;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}
.header-action-btn:hover {
  background-color: rgba(0,0,0,0.05);
}
.dark .header-action-btn {
  color: #bbb;
}
.dark .header-action-btn:hover {
  background-color: rgba(255,255,255,0.1);
}

/* [新增] Header 样式调整 */
.header-left {
  display: flex;
  align-items: center;
  padding: 4px;
  cursor: pointer;
}

.header-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #eee;
}

.header-logo-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px; /* Logo 可以稍微方一点 */
}

/* 顶部选择模式条幅 */
/* 顶部选择模式条幅 —— 统一为与搜索结果横幅一致的风格 */
.selection-actions-banner {
  position: sticky;
  top: 44px;
  z-index: 2500;

  /* 布局保持不变 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;

  /* 🔥 [修改] 背景色：使用主题主色混合 90% 白色 */
  /* 原来是 #eef2ff */
  background-color: color-mix(in srgb, var(--theme-primary), white 90%);

  /* 🔥 [修改] 文字颜色：使用主题深色 */
  /* 原来是 #4338ca，导致了左侧文字还是蓝色 */
  color: var(--theme-primary-dark);

  padding: 8px 12px;
  border-radius: 8px;
  margin: 8px 0 10px 0;
  font-size: 14px;
}

.dark .selection-actions-banner {
  /* 原来是 #312e81 */
  background-color: color-mix(in srgb, var(--theme-primary), black 60%);
  /* 原来是 #c7d2fe */
  color: color-mix(in srgb, var(--theme-primary), white 80%);
}

/* 新增：标签按钮样式 */
.selection-actions-banner .tag-btn {
  border-color: #10b981; /* Emerald-500 */
  color: #059669;        /* Emerald-600 */
}

.selection-actions-banner .tag-btn:hover {
  background-color: #10b981;
  color: #fff;
}

/* 深色模式 */
.dark .selection-actions-banner .tag-btn {
  border-color: #34d399;
  color: #6ee7b7;
}
.dark .selection-actions-banner .tag-btn:hover {
  background-color: #34d399;
  color: #064e3b;
}
/* === 📱 移动端适配：压缩选择条幅空间 === */
@media (max-width: 768px) {
  .selection-actions-banner {
    padding: 6px 8px; /* 减小外框内边距 */
    gap: 4px;         /* 左右两栏靠得更近 */
  }

  /* 1. 左侧文字：只显示“已选X项”，隐藏“选择笔记”标题和分隔符 */
  .selection-actions-banner .banner-left strong,
  .selection-actions-banner .banner-left .sep {
    display: none;
  }

  .selection-actions-banner .banner-left {
    font-size: 12px;
    white-space: nowrap; /* 防止文字换行 */
    min-width: fit-content; /* 让左侧只占用必要的宽度 */
  }

  /* 2. 右侧按钮区域：压缩间距 */
  .selection-actions-banner .banner-right {
    gap: 6px; /* 按钮间距从 10px 缩小到 6px */
    flex: 1;  /* 占据剩余空间 */
    justify-content: flex-end; /* 靠右对齐 */

    /* 防止极端小屏手机溢出，允许微量横向滚动（通常不需要） */
    overflow-x: auto;
    /* 隐藏滚动条 */
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .selection-actions-banner .banner-right::-webkit-scrollbar {
    display: none;
  }

  /* 3. 按钮本体：极简模式 */
  .selection-actions-banner .action-btn{
  background: none;
  border: 1px solid #6366f1;
    padding: 4px 6px; /* 内边距左右缩小一半 (原12px -> 6px) */
    font-size: 12px;  /* 字号缩小 */
    border-radius: 4px; /* 圆角稍微改小一点 */
  }
}

.selection-actions-banner .banner-left {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selection-actions-banner .sep {
  opacity: 0.6;
}

.selection-actions-banner .banner-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 右侧按钮：采用与“导出”按钮一致的描边样式 */
.selection-actions-banner .action-btn,
.selection-actions-banner .finish-btn {
  background: none;
  border: 1px solid #6366f1;   /* 与导出按钮一致的描边色 */
  color: #4338ca;              /* 与横幅主色一致 */
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.selection-actions-banner .action-btn:disabled,
.selection-actions-banner .finish-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* hover 与搜索“导出”按钮一致 */
.selection-actions-banner .action-btn:hover{
  background-color: #4338ca;
  color: #fff;
}
.selection-actions-banner .selection-close-btn {
  margin-left: 0 !important;
}
.dark .selection-actions-banner .action-btn{
  border-color: #a5b4fc;
  color: #c7d2fe;
}

.dark .selection-actions-banner .action-btn:hover{
  background-color: #a5b4fc;
  color: #312e81;
}

/* 如果你仍希望“删除”有弱危险提示，可保留细微差异：红色描边，但 hover 依然按统一规则 */
.selection-actions-banner .delete-btn {
  border-color: #ef4444;
  color: #b91c1c;
}
.dark .selection-actions-banner .delete-btn {
  border-color: #fca5a5;
  color: #fecaca;
}

.slide-up-fade-enter-active,
.slide-up-fade-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-up-fade-enter-from,
.slide-up-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
.search-bar-container {
  /* ✅ 修复间距的核心：改回 sticky */
  /* sticky 既能实现吸顶，也能作为内部绝对定位元素的参照物 */
  position: -webkit-sticky;
  position: sticky;
  display: block;

  /* 确保背景不透明，防止滚动时内容透出来 */
  background: var(--app-bg);
  /* 保持原有的内边距 */
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;

  /* 确保层级高于内容列表 */
  z-index: 100;
}
.dark .search-bar-container {
  background: #1e1e1e;
}
.search-actions-wrapper {
  flex: 1;
  min-width: 0;
}
@media (max-width: 768px) {
  .cancel-search-btn {
    font-size: 14px;
    padding: 0.6rem 1rem;
  }
}

/* ++ 修改：让导出按钮样式能应用于所有横幅 */
.selection-actions-banner .action-btn,
.selection-actions-banner .finish-btn,
.active-filter-bar .export-results-btn {
  background: none;

  /* 🔥 [修改] 边框和文字跟随主题 */
  border: 1px solid var(--theme-primary);
  color: var(--theme-primary-dark);

  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.selection-actions-banner .action-btn:hover,
.search-results-bar .export-results-btn:hover {
  /* 🔥 [修改] 悬停背景变为主色 */
  background-color: var(--theme-primary-dark);
  color: #fff;
}

.dark .selection-actions-banner .action-btn,
.dark .search-results-bar .export-results-btn {
  border-color: var(--theme-primary-light);
  color: color-mix(in srgb, var(--theme-primary), white 80%);
}
.dark .selection-actions-banner .action-btn:hover,
.dark .search-results-bar .export-results-btn:hover {
  background-color: var(--theme-primary-light);
  color: #1e1e1e;
}

selection-actions-banner,
.active-filter-bar {
  position: sticky;
  top: 44px;
  z-index: 2500;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;

  /* 🔥 [修改] 背景色：使用主色混合 90% 白色 (自动生成浅色背景) */
  background-color: color-mix(in srgb, var(--theme-primary), white 90%);

  /* 🔥 [修改] 文字颜色：使用主题深色 */
  color: var(--theme-primary-dark);

  padding: 8px 12px;
  border-radius: 8px;
  margin: 8px 0 10px 0;
  font-size: 14px;
}

/* 修改：让 .banner-info 成为一个 flex 容器来管理其内部元素 */
.banner-info {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between; /* 将主文本和数量推到两端 */
}

/* 新增：定义主文本区域的样式（这部分将负责收缩和显示省略号） */
.banner-text-main {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 新增：定义笔记数量的样式（这部分将受到保护，不会被压缩） */
.banner-text-count {
  flex-shrink: 0; /* 禁止收缩 */
  margin-left: 1rem; /* 与主文本保持一些距离 */
  color: #6c757d; /* 稍微调整颜色以更好地区分 */
}

/* 新增：为暗黑模式下的数量文本适配颜色 */
.dark .banner-text-count {
  color: #adb5bd;
}

.dark .selection-actions-banner,
.dark .active-filter-bar {
  /* 🔥 [修改] 深色模式背景：使用主色混合 60% 黑色 */
  background-color: color-mix(in srgb, var(--theme-primary), black 60%);

  /* 🔥 [修改] 深色模式文字：使用主题亮色 */
  color: color-mix(in srgb, var(--theme-primary), white 80%);
}

.auth-container.is-typing .new-note-editor-container {
  padding-top: 0.25rem; /* 视需要再压一点顶部间距 */
}

/* 折叠头部输入框：不改布局流、不影响虚拟列表 */
.new-note-editor-container {
  transition: height .18s ease, padding .18s ease, margin .18s ease;
}
.new-note-editor-container.collapsed {
  height: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  margin: 0 !important;
  overflow: hidden;
}
@media (min-width: 768px) {
  .auth-container {
    max-width: 960px;
  }
}

/* ++ 新增：“回到顶部”按钮的样式 ++ */
.scroll-top-button {
  position: fixed;
  bottom: 158px;
  right: 20px;
  z-index: 5000;

  width: 38px;
  height: 38px;
  border-radius: 50%; /* 圆形 */
  border: none;

  /* 半透明黑色背景，在浅色和深色模式下都适用 */
  background-color: rgba(0, 0, 0, 0.2);
  color: white;

  /* Flexbox 居中图标 */
  display: flex;
  align-items: center;
  justify-content: center;

  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.scroll-top-button:hover {
  background-color: rgba(0, 0, 0, 0.2);
}

.scroll-top-button:active {
  transform: scale(0.95);
}

/* ++ 新增：按钮的淡入淡出效果 ++ */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
/* ++ 新增：桌面端按钮位置修正 ++ */
@media (min-width: 960px) {
  .scroll-top-button {
    /* 计算逻辑:
      (100vw - 960px) / 2  ->  计算出内容区外侧，左右两边灰色区域的宽度
      + 20px                 ->  在这个灰色区域内再向内偏移20px
      这样就能保证它永远在内容区的右侧，并且离浏览器边缘的距离是合适的。
    */
    right: calc((100vw - 960px) / 2 + 20px);
  }
}

/* 让输入框容器在遮罩之上（header z-index 是 3000，这里更高） */
.composer-active {
  position: relative;
  z-index: 3600;
}

/* 毛玻璃遮罩：盖在页面内容与输入框之间，点击即可关闭 */
.composer-overlay {
  position: fixed;
  inset: 0;
  z-index: 3500;
  /* 轻微暗化 + 毛玻璃 */
  background: rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* 右下角 “+” 悬浮按钮（不与回到顶部按钮冲突，略高一点） */
.fab-add {
  position: fixed;
  right: 20px;
  bottom: 60px;
  z-index: 5000;

  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  font-size: 30px;

  /* ✅ 新增：使用 Flexbox 实现完美绝对居中 */
  display: flex;
  align-items: center;
  justify-content: center;

  /* ✅ 新增：消除行高干扰，并微调视觉重心 */
  line-height: 1;
  padding-bottom: 2px; /* 这一行是关键：因为 "+" 符号在很多字体里本身重心偏低，往上顶 2px 视觉上才是在圆心 */

  cursor: pointer;
background: var(--theme-primary); /* 原 #6366f1 */
  color: #fff;
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
  transform: translateY(-7px);
}
.fab-add:hover { transform: translateY(-3px); }
.fab-add:active { transform: scale(0.96); }

/* 桌面端右侧对齐方式与回到顶部按钮一致（内容区 960px） */
@media (min-width: 960px) {
  .fab-add {
    right: calc((100vw - 960px) / 2 + 20px);
  }
}

/* 深色模式下的微调 */
.dark .fab-add {
  background: var(--theme-primary-light); /* 原 #818cf8 */
  color: #111;}
.cancel-search-btn {
  /* 定位：垂直居中 */
  position: absolute;
  top: 24px;  /* 根据你的容器高度微调 */
  transform: translateY(-50%);
  z-index: 200;

  /* ✅ 修复 1：不要贴死边缘，给右边留出 10px 左右的安全距离 */
  right: 7px;

  /* ✅ 修复 2：使用 min-width 代替 width */
  /* 这样中文“取消”会撑开到 48px 宽（显得不那么窄，且居中） */
  /* 英文 Cancel 如果更长，会自动撑开，不会换行 */
  width: auto;
  min-width: 48px;

  /* ✅ 修复 3：布局与对齐 */
  display: flex;
  align-items: center;
  justify-content: center; /* 保证“取消”二字在 48px 里居中 */
  white-space: nowrap;     /* 保证绝对不换行 */

  /* 样式重置 */
  background: none;
  border: none;
  padding: 0 4px; /* 稍微加点内边距作为缓冲 */
  height: 44px;   /* 保持大的点击高度 */

  font-size: 15px;
  color: #666;
  cursor: pointer;
}
.dark .cancel-search-btn {
  color: #bbb;
}

.search-actions-wrapper :deep(.search-input-wrapper) {
  margin-right: 45px !important; /* 右侧留出 45px 空间 */
}

/* ✅ 新增：无背景、纯紫色的加粗叉号 */
.close-results-btn {
  /* 固定在右侧，防止被文字挤压 */
  flex-shrink: 0;

  /* 去除所有背景和边框，只留图标 */
  background: transparent;
  border: none;

  color: var(--theme-primary);

  /* 增加一点内边距方便点击，同时稍微拉开点左边距 */
  padding: 4px;
  margin-left: 8px;

  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  /* 简单的透明度过渡效果 */
  transition: opacity 0.2s;
}

.close-results-btn:hover {
  /* 悬停时稍微变浅，而不是加背景 */
  opacity: 0.7;
}

.dark .close-results-btn {
  /* 深色模式下的紫色稍微亮一点 */
  color: var(--theme-primary-light);
}
</style>

<style>
/* === 全局样式（非 scoped）=== */

/* 先“清零”所有根级下拉菜单的限制：不出现滚动条不限制高度 */
/* 让根层菜单也能滚动，避免太长溢出屏幕 */
.n-dropdown-menu {
  max-height: calc(100dvh - var(--header-height) - var(--safe-bottom)) !important;
  overflow: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* 子菜单的滚动限制 */
.n-dropdown-menu .n-dropdown-menu {
  max-height: calc(100dvh - var(--header-height) - var(--safe-bottom) - 16px) !important;
  overflow: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding-right: 4px;
}

/* 子菜单项紧凑一些 */
.n-dropdown-menu .n-dropdown-menu .n-dropdown-option {
  line-height: 1.2;
}

/* 让“设置”下面的二级菜单整体再向左挪一点 */
.n-dropdown-menu .submenu-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: -9px; /* 调整这个数值大小以控制左移距离，比如 -6px/-10px */
}

/* 移动端给子菜单更多空间 */
@media (max-width: 768px) {
  .n-dropdown-menu .n-dropdown-menu {
    max-height: 70dvh !important;
  }
}

/* 全局：定义安全区变量（iOS PWA 刘海/状态栏） */
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --header-base: 44px; /* 头部高度 */
  --header-height: calc(var(--header-base) + var(--safe-top));
}
.dark :root { --app-bg: #1e1e1e; }

/* 统一页面背景 */
html, body, #app {
  min-height: 100svh;
  min-height: 100dvh;
  min-height: 100lvh;
  min-height: calc(var(--vh, 1vh) * 100);
  margin: 0;
  background: var(--app-bg);
}

/* 容器整体：顶部留 safe-top，底部用负 margin 压进安全区 */
.auth-container {
  padding-top: calc(0.5rem + var(--safe-top)) !important;
  padding-bottom: 0 !important;                                  /* 不占位 */
  margin-bottom: calc(-1 * var(--safe-bottom)) !important;        /* 直接压进安全区，遮住 home 栏 */
  overscroll-behavior-y: contain;
  background: var(--app-bg);
  position: relative;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

/* Sticky 头部下移 safe-top */
.auth-container .page-header {
  top: var(--safe-top) !important;
  height: var(--header-base) !important;
  padding-top: 0.5rem !important;
}

/* 二级横幅、搜索栏跟随 header-height */
.search-bar-container,
.selection-actions-banner {
  top: var(--header-height) !important;
}

:root { --app-bg: #fff; }         /* ✅ 浅色默认 */
.dark :root { --app-bg: #1e1e1e; }/* ✅ 深色覆写 */

.n-dropdown-menu .menu-caret {
  display: inline-block;
  transition: transform .15s ease;
  transform: translateY(1px);
}
.n-dropdown-menu .menu-caret.rot90 {
  transform: translateY(1px) rotate(90deg);
}
</style>
