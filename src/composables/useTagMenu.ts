// src/composables/useTagMenu.ts
/* eslint-disable style/max-statements-per-line */
import { type Ref, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { NButton, NDropdown, NInput, useDialog, useMessage } from 'naive-ui'
import { ChevronRight, GripVertical, Pencil, RotateCcw, Settings2, Sparkles, Star, StarOff, Trash2 } from 'lucide-vue-next'
import { ICON_CATEGORIES } from './icon-data'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getTagCacheKey } from '@/utils/cacheKeys'

/** 本地存储 Key */
const PINNED_TAGS_KEY = 'pinned_tags_v1'
const TAG_ORDER_KEY = 'tag_order_v1'
const TAG_COUNT_CACHE_KEY_PREFIX = 'tag_counts_v1:'
const TAG_ICON_MAP_KEY = 'tag_icons_v1'
const LAST_KNOWN_USER_ID_KEY = 'last_known_user_id_v1'
/** 无标签筛选的固定哨兵值 */
const UNTAGGED_SENTINEL = '__UNTAGGED__'
// ✅ 展开状态持久化
const EXPANDED_GROUPS_KEY_PREFIX = 'tag_expanded_groups_v1:'
function getExpandedStorageKey(uid: string) {
  return `${EXPANDED_GROUPS_KEY_PREFIX}${uid}`
}

type SmartPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'

/** 严格判断：只有能“完整容纳”菜单才选择该方向；否则翻到另一侧 */
function computeSmartPlacementStrict(anchorEl: HTMLElement | null): SmartPlacement {
  if (!anchorEl)
    return 'top-start'
  const rect = anchorEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const MENU_W = 300
  const MENU_H = Math.min(400, Math.floor(vh * 0.7))
  const MARGIN = 8

  const spaceBelow = vh - rect.bottom - MARGIN
  const spaceAbove = rect.top - MARGIN
  const spaceRight = vw - rect.right - MARGIN
  const spaceLeft = rect.left - MARGIN

  let vertical: 'top' | 'bottom'
  if (spaceBelow >= MENU_H && spaceAbove >= MENU_H)
    vertical = 'bottom'
  else if (spaceBelow >= MENU_H)
    vertical = 'bottom'
  else if (spaceAbove >= MENU_H)
    vertical = 'top'
  else
    vertical = spaceBelow >= spaceAbove ? 'bottom' : 'top'

  let horizontal: 'start' | 'end'
  if (spaceRight >= MENU_W && spaceLeft >= MENU_W)
    horizontal = 'end'
  else if (spaceRight >= MENU_W)
    horizontal = 'end'
  else if (spaceLeft >= MENU_W)
    horizontal = 'start'
  else
    horizontal = spaceRight >= spaceLeft ? 'end' : 'start'

  return `${vertical}-${horizontal}` as SmartPlacement
}

// === iOS 输入框 16px 修复（无需单独的全局样式文件）===
// src/composables/useTagMenu.ts

function ensureTagMenuInputFontFix() {
  if (typeof document === 'undefined')
    return
  const id = 'tag-menu-ios-input-16px-fix'
  if (document.getElementById(id))
    return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    /* ... 原有的 iOS 修复代码 ... */
    .tag-search-row .n-input__input-el,
    .icon-picker-root .n-input__input-el { font-size: 16px !important; }
    .tag-search-row .n-input .n-input-wrapper { width: 100% !important; display: flex !important; }
    .tag-search-row .n-input .n-input__suffix { margin-left: auto !important; }
    .tag-search-row .n-input .n-input__input { flex: 1 1 auto !important; width: auto !important; }

    /* 🔥 新增：vuedraggable 样式 */
    .sortable-ghost {
      opacity: 0.4;
      background: #eef2ff !important; /* 拖拽时的占位背景色 */
      border: 1px dashed #6366f1 !important;
    }
    .drag-handle {
      cursor: grab;
    }
    .drag-handle:active {
      cursor: grabbing;
    }
  `
  document.head.appendChild(style)
}

/** 将标签标准化为 "#xxx" 形式 */
function normalizeTag(tag: string) {
  const v = (tag || '').trim()
  if (!v)
    return ''
  return v.startsWith('#') ? v : `#${v}`
}

/** 去掉开头的 #，便于展示 */
function tagKeyName(tag: string) {
  return tag.startsWith('#') ? tag.slice(1) : tag
}

/** 将 "#水果/苹果/小苹果" -> ["水果","苹果","小苹果"] */
function splitTagPath(tag: string): string[] {
  const name = tagKeyName(tag)
  return name.split('/').map(s => s.trim()).filter(Boolean)
}

/** 多级标签树节点 */
interface TagTreeNode {
  name: string
  /** 仅在叶子节点记录完整原始标签（含 #） */
  full?: string
  children: Record<string, TagTreeNode>
}

/** 由标签列表构建一棵树（不含置顶标签） */
function buildTagTree(tags: string[]): TagTreeNode {
  const root: TagTreeNode = { name: '', children: {} }
  for (const t of tags) {
    const parts = splitTagPath(t)
    if (parts.length === 0)
      continue
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!cur.children[part])
        cur.children[part] = { name: part, children: {} }
      cur = cur.children[part]
      if (i === parts.length - 1)
        cur.full = t
    }
  }
  return root
}

/** 统计一个节点（含所有后代）的总笔记数 */
function getNodeCount(node: TagTreeNode, counts: Record<string, number>): number {
  let sum = 0
  if (node.full && counts[node.full])
    sum += counts[node.full]

  const kids = Object.values(node.children)
  for (const c of kids)
    sum += getNodeCount(c, counts)
  return sum
}

function treeToDownwardGroups(
  root: TagTreeNode,
  counts: Record<string, number>,
  iconMap: Record<string, string>,
  makeRow: (full: string, labelName?: string, indentPx?: number) => any,
  makeHeader: (node: TagTreeNode, tagFull: string, labelName: string, expanded: boolean, onToggle: () => void, indentPx?: number) => any,
  isExpanded: (key: string) => boolean,
  toggle: (key: string) => void,
  compareFn?: (nameA: string, nameB: string) => number, // 🔥 接收比较函数
): any[] {
  const rows: any[] = []

  // 🔥 定义排序器：优先使用传入的 compareFn，否则降级为字母排序
  const sorter = compareFn || ((a, b) => a.localeCompare(b))

  // Level 1
  const level1Names = Object.keys(root.children).sort(sorter)

  for (const name1 of level1Names) {
    const node1 = root.children[name1]
    const path1 = name1
    const tag1 = node1.full ?? `#${path1}`
    const hasL2 = Object.keys(node1.children).length > 0

    if (!hasL2) {
      rows.push(makeRow(tag1, name1, 0))
      continue
    }

    rows.push(makeHeader(node1, tag1, name1, () => isExpanded(path1), () => toggle(path1), 0))

    if (!isExpanded(path1))
      continue

    // Level 2
    const level2Names = Object.keys(node1.children).sort(sorter) // 🔥 使用 sorter
    for (const name2 of level2Names) {
      const node2 = node1.children[name2]
      const path2 = `${path1}/${name2}`
      const tag2 = node2.full ?? `#${path2}`
      const hasL3 = Object.keys(node2.children).length > 0

      if (!hasL3) {
        rows.push(makeRow(tag2, name2, 24))
        continue
      }

      rows.push(makeHeader(node2, tag2, name2, () => isExpanded(path2), () => toggle(path2), 24))

      if (!isExpanded(path2))
        continue

      // Level 3
      const level3Names = Object.keys(node2.children).sort(sorter) // 🔥 使用 sorter
      for (const name3 of level3Names) {
        const node3 = node2.children[name3]
        const path3 = `${path2}/${name3}`
        const tag3 = node3.full ?? `#${path3}`
        rows.push(makeRow(tag3, name3, 48))
      }
    }
  }

  return rows
}

/**
 * 把 TagTree 转成 Naive UI 的多级菜单 children
 * - 叶子与“父节点自身”都复用 makeRow(tag)（含右侧 ⋯ 菜单）
 * - 纯分组节点（没有 full）只作为分组，不显示 ⋯
 */
function _treeToDropdownChildren(
  node: TagTreeNode,
  counts: Record<string, number>,
  iconMap: Record<string, string>,
  _select: (full: string) => void,
  makeRow: (full: string) => any,
  path: string[] = [],
): any[] {
  const items: any[] = []
  const names = Object.keys(node.children).sort((a, b) => a.localeCompare(b))

  for (const name of names) {
    const child = node.children[name]
    const hasKids = Object.keys(child.children).length > 0
    const keyBase = [...path, name].join('/')

    // 纯叶子：直接一行，带 ⋯
    if (!hasKids && child.full) {
      items.push(makeRow(child.full))
      continue
    }

    // 有子节点：先递归出子菜单
    const childrenOptions = treeToDropdownChildren(
      child,
      counts,
      iconMap,
      _select,
      makeRow,
      [...path, name],
    )

    // 若该节点自身也是一个可选标签（既是父又是标签），把自身放在子菜单第一项
    if (child.full)
      childrenOptions.unshift(makeRow(child.full))

    // 父分组项（不带 ⋯）
    const total = getNodeCount(child, counts)
    const icon = child.full ? (iconMap[child.full] || '#') : '📁'
    const left = `${icon} ${name}`
    const labelText = total > 0 ? `${left}（${total}）` : left

    items.push({
      key: `grp-${keyBase}`,
      label: labelText,
      children: childrenOptions,
    })
  }

  return items
}

/** 笔记内容里是否包含至少一个 #tag（与后端统计同源正则） */
function contentHasAnyTag(content: string | null | undefined) {
  if (!content)
    return false
  return /#([^\s#.,?!;:"'()\[\]{}]+)/u.test(content)
}

/** 读取当前用户 ID（不依赖父组件） */
async function getUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error)
    return null
  return data?.user?.id ?? null
}

/** 写入 Supabase Auth.user_metadata 的 pinned_tags（成功返回 true） */
async function savePinnedToAuth(pinned: string[]): Promise<boolean> {
  try {
    const { error } = await supabase.auth.updateUser({
      data: {
        pinned_tags: pinned,
        pinned_tags_updated_at: new Date().toISOString(),
      },
    })
    return !error
  }
  catch {
    return false
  }
}

/** 保存 tag_icons 到 Auth.user_metadata（失败静默） */
async function saveTagIconsToAuth(map: Record<string, string>): Promise<boolean> {
  try {
    const { error } = await supabase.auth.updateUser({
      data: {
        tag_icons: map,
        tag_icons_updated_at: new Date().toISOString(),
      },
    })
    return !error
  }
  catch {
    return false
  }
}

/** 🔥 新增：保存标签自定义排序到 Auth.user_metadata */
async function saveTagOrderToAuth(orderList: string[]): Promise<boolean> {
  try {
    const { error } = await supabase.auth.updateUser({
      data: {
        tag_order: orderList,
        tag_order_updated_at: new Date().toISOString(),
      },
    })
    return !error
  }
  catch {
    return false
  }
}

export function useTagMenu(
  allTags: Ref<string[]>,
  onSelectTag: (tag: string) => void,
  t: (key: string, arg?: any) => string,
) {
  // ================================================================================================
  // 可调参数
  // ================================================================================================
  const BASE_NAIVE_PADDING = 35
  const FINAL_LEFT_PADDING = 12
  const SHIFT_LEFT_PX = BASE_NAIVE_PADDING - FINAL_LEFT_PADDING
  // ================================================================================================

  const mainMenuVisible = ref(false)
  const tagSearch = ref('')
  const pinnedTags = ref<string[]>([])
  const message = useMessage()
  const dialog = useDialog()
  const isBusy = ref(false)

  const tagCounts = ref<Record<string, number>>({})
  const tagCountsSig = ref<string | null>(null)
  const isLoadingCounts = ref(false)
  const currentUserId = ref<string | null>(null)
  const tagIconMap = ref<Record<string, string>>({})
  const tagOrder = ref<string[]>([])
  let tagCountsChannel: ReturnType<typeof supabase.channel> | null = null
  let lastFetchAt = 0

  // —— 保持主菜单常开的辅助状态 —— //
  const isRowMoreOpen = ref(false)
  let lastMoreClosedByOutside = false
  const dialogOpenCount = ref(0)

  // —— 筛选状态（内建） —— //
  const selectedTag = ref<string | null>(null)
  const untaggedCount = ref<number | null>(null)
  let lastUntaggedFetchAt = 0
  let isLoadingUntagged = false
  const isUntaggedSelected = computed(() => selectedTag.value === UNTAGGED_SENTINEL)

  // 🔥 优化后的比较函数
  function compareTagsCustom(nameA: string, nameB: string) {
    // 1. 尝试直接在排序列表中找
    let indexA = tagOrder.value.indexOf(nameA)
    let indexB = tagOrder.value.indexOf(nameB)

    // 2. [关键优化] 如果找不到确切名字（比如这是个文件夹名 'parent'，而列表中只有 'parent/child'）
    // 我们尝试在 tagOrder 中找“第一个以 nameA/ 开头的项”，用它的位置代表文件夹的位置
    if (indexA === -1)
      indexA = tagOrder.value.findIndex(t => t === nameA || t.startsWith(`${nameA}/`))

    if (indexB === -1)
      indexB = tagOrder.value.findIndex(t => t === nameB || t.startsWith(`${nameB}/`))

    // 3. 比较逻辑
    if (indexA !== -1 && indexB !== -1)
      return indexA - indexB
    if (indexA !== -1)
      return -1 // A 有序，A 排前
    if (indexB !== -1)
      return 1 // B 有序，B 排前

    // 4. 都没设置过顺序，默认字母排序
    return nameA.localeCompare(nameB)
  }

  // —— 可折叠状态 —— //
  const expandedGroups = ref<Record<string, boolean>>({})

  function isExpandedKey(key: string) {
    return !!expandedGroups.value[key]
  }
  function toggleExpandedKey(key: string) {
    expandedGroups.value[key] = !expandedGroups.value[key]
    saveExpanded()
  }

  // 定义两个固定的 Key用于持久化
  const KEY_PINNED_GROUP = 'section-starred' // 原 pinned-group
  const KEY_ALL_TAGS_GROUP = 'section-every' // 原 all-tags-group

  function hydrateExpanded(uid: string) {
    try {
      const raw = localStorage.getItem(getExpandedStorageKey(uid))
      expandedGroups.value = raw ? JSON.parse(raw) : {}
    }
    catch {
      expandedGroups.value = {}
    }

    // 🔥 新增：如果本地缓存中不存在状态（即首次加载），默认将“常用”和“全部”设为展开 (true)
    if (expandedGroups.value[KEY_PINNED_GROUP] === undefined)
      expandedGroups.value[KEY_PINNED_GROUP] = true

    if (expandedGroups.value[KEY_ALL_TAGS_GROUP] === undefined)
      expandedGroups.value[KEY_ALL_TAGS_GROUP] = true
  }

  // 🔥 新增：加载/保存 排序
  function hydrateTagOrder() {
    try {
      const raw = localStorage.getItem(TAG_ORDER_KEY)
      tagOrder.value = raw ? JSON.parse(raw) : []
    }
    catch { tagOrder.value = [] }
  }

  async function saveTagOrder() {
    localStorage.setItem(TAG_ORDER_KEY, JSON.stringify(tagOrder.value))
    await saveTagOrderToAuth(tagOrder.value)
  }

  function saveExpanded() {
    const uid = currentUserId.value
    if (!uid)
      return
    try {
      localStorage.setItem(getExpandedStorageKey(uid), JSON.stringify(expandedGroups.value))
    }
    catch { /* ignore quota */ }
  }

  // 📌 MODIFIED: 将标签列表 (allTags) 也存入缓存
  function saveCountsCacheToLocal() {
    const uid = currentUserId.value
    if (!uid)
      return
    const items = Object.entries(tagCounts.value).map(([tag, cnt]) => ({ tag, cnt }))
    localStorage.setItem(
      `${TAG_COUNT_CACHE_KEY_PREFIX}${uid}`,
      JSON.stringify({ sig: tagCountsSig.value, tags: allTags.value, items, savedAt: Date.now() }),
    )
  }

  function hydrateIconsFromLocal() {
    try {
      const raw = localStorage.getItem(TAG_ICON_MAP_KEY)
      tagIconMap.value = raw ? (JSON.parse(raw) || {}) : {}
    }
    catch {
      tagIconMap.value = {}
    }
  }
  async function saveIcons() {
    localStorage.setItem(TAG_ICON_MAP_KEY, JSON.stringify(tagIconMap.value))
    await saveTagIconsToAuth(tagIconMap.value)
  }

  // 📌 MODIFIED: 从缓存中恢复标签列表 (allTags) 和数量
  function hydrateCountsFromLocal(uid: string): number | null {
    const cacheKey = TAG_COUNT_CACHE_KEY_PREFIX + uid
    const cachedRaw = localStorage.getItem(cacheKey)
    if (!cachedRaw)
      return null
    try {
      const cached = JSON.parse(cachedRaw) as {
        sig: string | null
        tags: string[]
        items: Array<{ tag: string; cnt: number }>
        savedAt: number
      }
      if (Array.isArray(cached.tags))
        allTags.value = cached.tags

      tagCountsSig.value = cached.sig
      const map: Record<string, number> = {}
      for (const it of cached.items) map[it.tag] = it.cnt
      tagCounts.value = map
      return cached.savedAt ?? null
    }
    catch {
      return null
    }
  }

  // 📌 MODIFIED: 实现基于 "数据签名" 的缓存策略，避免不必要的请求
  async function refreshTagCountsFromServer(force = false) {
    const now = Date.now()
    if (!force && now - lastFetchAt < 700) // 在非强制模式下，才检查时间间隔
      return
    lastFetchAt = now
    if (isLoadingCounts.value)
      return
    const uid = await getUserId()
    if (!uid)
      return
    currentUserId.value = uid
    try {
      isLoadingCounts.value = true
      const { data, error } = await supabase.rpc('get_tag_counts', { p_user_id: uid })
      if (error)
        throw error
      const cacheKey = TAG_COUNT_CACHE_KEY_PREFIX + uid
      if (Array.isArray(data) && data.length > 0) {
        const serverSig: string | null = data[0].last_updated

        // 修改这一行，增加 !force 条件
        // 如果是强制刷新，则不检查签名
        if (!force && serverSig && serverSig === tagCountsSig.value)
          return

        const map: Record<string, number> = {}
        const newTags: string[] = []
        for (const row of data) {
          const tg = String(row.tag)
          const cnt = Number(row.cnt ?? 0)
          map[tg] = cnt
          newTags.push(tg)
        }

        allTags.value = newTags
        tagCounts.value = map
        tagCountsSig.value = serverSig || null
        saveCountsCacheToLocal()
      }
      else {
        allTags.value = []
        tagCounts.value = {}
        tagCountsSig.value = null
        localStorage.removeItem(cacheKey)
      }
    }
    finally {
      isLoadingCounts.value = false
    }
  }

  async function refreshUntaggedCountFromServer(force = false) {
    const now = Date.now()
    if (!force && now - lastUntaggedFetchAt < 700)
      return
    lastUntaggedFetchAt = now
    if (isLoadingUntagged)
      return

    const uid = await getUserId()
    if (!uid)
      return

    try {
      isLoadingUntagged = true

      // ✅ 核心修正：
      // 直接调用我们已经验证过100%正确的函数 `get_notes_without_tags_count`
      // 并移除所有不必要的后备逻辑。
      const { data, error } = await supabase.rpc('get_notes_without_tags_count', { p_user_id: uid })

      if (error) {
      // 如果这里还出错，说明数据库里的函数有问题
        console.error('Failed to fetch untagged count from get_notes_without_tags_count:', error)
        untaggedCount.value = null
        return
      }

      // 这个函数直接返回一个数字，我们可以安全地使用它
      const n = typeof data === 'number' ? data : 0
      untaggedCount.value = Number.isFinite(n) ? n : null
    }
    catch (e) {
      console.error('Error inside refreshUntaggedCountFromServer:', e)
      untaggedCount.value = null
    }
    finally {
      isLoadingUntagged = false
    }
  }

  onMounted(async () => {
    ensureTagMenuInputFontFix()

    // 1. 总是先从本地加载非用户相关的缓存（图标和置顶的 key 是全局的）
    hydrateIconsFromLocal()
    hydrateTagOrder()
    try {
      const raw = localStorage.getItem(PINNED_TAGS_KEY)
      pinnedTags.value = raw ? JSON.parse(raw) : []
    }
    catch {
      pinnedTags.value = []
    }

    /**
     * 核心初始化函数：负责加载用户数据、同步云端配置、建立实时订阅
     * 封装此处以便在 "首次检查" 和 "登录状态变更" 时复用
     */
    const initSessionData = async (user: any) => {
      const uid = user.id
      if (!uid)
        return

      // 防止重复初始化 (当 onAuthStateChange 和 getSession 同时触发时)
      if (currentUserId.value === uid && tagCountsChannel)
        return

      currentUserId.value = uid
      localStorage.setItem(LAST_KNOWN_USER_ID_KEY, uid)
      hydrateExpanded(uid)

      hydrateTagOrder() // 先读本地
      const serverOrder = (user.user_metadata as any)?.tag_order
      if (Array.isArray(serverOrder)) {
        tagOrder.value = serverOrder
        localStorage.setItem(TAG_ORDER_KEY, JSON.stringify(tagOrder.value))
      }

      // --- 同步 Metadata (置顶 & 图标) ---
      const serverPinned = (user.user_metadata as any)?.pinned_tags
      if (Array.isArray(serverPinned)) {
        pinnedTags.value = serverPinned
        localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
      }

      const serverIcons = (user.user_metadata as any)?.tag_icons
      if (serverIcons && typeof serverIcons === 'object') {
        tagIconMap.value = { ...tagIconMap.value, ...serverIcons }
        localStorage.setItem(TAG_ICON_MAP_KEY, JSON.stringify(tagIconMap.value))
      }

      // --- 加载用户相关的标签列表缓存 ---
      hydrateCountsFromLocal(uid)

      // --- 尝试从服务器刷新 ---
      refreshTagCountsFromServer().catch(() => {})
      refreshUntaggedCountFromServer(true).catch(() => {})

      // --- 设置实时数据订阅 ---
      // 如果已存在旧订阅，先清理
      if (tagCountsChannel)
        await supabase.removeChannel(tagCountsChannel)

      tagCountsChannel = supabase
        .channel(`tag-counts-${uid}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const content = payload?.new?.content as string | undefined
          if (content === undefined || contentHasAnyTag(content))
            refreshTagCountsFromServer().catch(() => {})
          refreshUntaggedCountFromServer(true).catch(() => {})
          invalidateAllTagCaches()
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const oldContent = payload?.old?.content as string | undefined
          if (oldContent === undefined || contentHasAnyTag(oldContent))
            refreshTagCountsFromServer(true).catch(() => {})
          refreshTagCountsFromServer().catch(() => {})
          refreshUntaggedCountFromServer(true).catch(() => {})
          invalidateAllTagCaches()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const beforeContent = payload?.old?.content as string | undefined
          const afterContent = payload?.new?.content as string | undefined
          const unsure = beforeContent === undefined && afterContent === undefined
          if (unsure || contentHasAnyTag(beforeContent) || contentHasAnyTag(afterContent))
            refreshTagCountsFromServer().catch(() => {})
          refreshUntaggedCountFromServer(true).catch(() => {})
          invalidateAllTagCaches()
        })
        .subscribe()
    }

    // 2. 监听 Auth 状态变化 (解决首次登录跳转时数据不显示的问题)
    // 这里的 subscription 应该在 onBeforeUnmount 中 unsubscribe，
    // 但由于是在 onMounted 内部定义的，建议保持现状或在外部定义变量存储它。
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // 登录成功、Token刷新 或 初始化发现 Session
        await initSessionData(session.user)
      }
      else if (event === 'SIGNED_OUT') {
        // 登出清理
        currentUserId.value = null
        allTags.value = []
        tagCounts.value = {}
        if (tagCountsChannel) {
          supabase.removeChannel(tagCountsChannel)
          tagCountsChannel = null
        }
      }
    })

    // 3. 立即检查一次当前 Session (作为双重保险，处理页面刷新场景)
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData?.session?.user) {
      await initSessionData(sessionData.session.user)
    }
    else {
      // [离线回退] 若无 Session，加载最后已知的用户缓存
      // 只有在完全没有 Session 的情况下才走这里
      const lastUid = localStorage.getItem(LAST_KNOWN_USER_ID_KEY)
      if (lastUid) {
        currentUserId.value = lastUid
        hydrateExpanded(lastUid)
        // 在纯离线模式下，只加载用户相关的标签列表缓存，不做任何网络请求
        hydrateCountsFromLocal(lastUid)
      }
    }
  })

  onBeforeUnmount(() => {
    if (tagCountsChannel) {
      try { tagCountsChannel.unsubscribe() }
      catch {}
      tagCountsChannel = null
    }
  })

  async function savePinned() {
    localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
    await savePinnedToAuth(pinnedTags.value)
  }
  function isPinned(tag: string) { return pinnedTags.value.includes(tag) }
  async function togglePin(tag: string) {
    const i = pinnedTags.value.indexOf(tag)
    if (i >= 0)
      pinnedTags.value.splice(i, 1)
    else pinnedTags.value.push(tag)
    await savePinned()
  }

  function selectTag(tag: string) {
    selectedTag.value = tag
    try { onSelectTag?.(tag) }
    catch {}
    mainMenuVisible.value = false
  }

  const filteredTags = computed(() => {
    const q = tagSearch.value.trim().toLowerCase()
    if (!q)
      return allTags.value
    return allTags.value.filter(tt => tt.toLowerCase().includes(q))
  })

  const groupedTags = computed(() => {
    const groups: Record<string, string[]> = {}

    // 先对 allTags 整体做一次排序，保证放入分组时的顺序也是对的
    const sortedAll = [...filteredTags.value].sort((a, b) => compareTagsCustom(tagKeyName(a), tagKeyName(b)))

    for (const tt of sortedAll) {
      const name = tagKeyName(tt)
      const letter = /^[A-Za-z]/.test(name) ? name[0].toUpperCase() : '#'
      if (!groups[letter])
        groups[letter] = []
      groups[letter].push(tt)
    }

    // 组内再确保一次 (其实上面 sort 过了，这里可以省略，但保留保险)
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => compareTagsCustom(tagKeyName(a), tagKeyName(b)))
    })

    // 字母分组本身的排序 (也受自定义排序影响吗？通常分组还是按字母，但如果用户想让 'B' 组排在 'A' 组前，比较少见)
    // 这里我们保持字母分组按字母排，但内容按自定义排。
    // *如果你希望完全自定义排序而忽略字母分组，建议把 groupedTags 逻辑改为直接返回一个 "自定义" 组*
    // 这里保持原逻辑：
    const letters = Object.keys(groups).sort((a, b) => {
      if (a === '#')
        return 1
      if (b === '#')
        return -1
      return a.localeCompare(b)
    })
    return letters.map(letter => ({ letter, tags: groups[letter] }))
  })
  /** 基于 filteredTags 的分层结果；不包含置顶标签 */
  const hierarchicalTags = computed(() => {
    const list = filteredTags.value
    return buildTagTree(list)
  })

  // ==========================================================================
  // 🔥 新增：生成分组头部的辅助函数 (实现持久化折叠 + 样式统一)
  // ==========================================================================
  function makeGroupHeaderRow(
    key: string,
    titleLabel: string,
    hasSettingsBtn = false,
  ) {
    const expanded = isExpandedKey(key)

    // 箭头图标
    const arrowVNode = h(ChevronRight, {
      size: 16,
      strokeWidth: 2.5,
      color: '#999',
      style: `display:inline-block; transform: translateY(1px) rotate(${expanded ? 90 : 0}deg); transition: transform .15s ease;`,
    })

    return {
      key,
      type: 'render' as const,
      render: () => h('div', {
        class: 'group-header-row',
        style: [
          // 🔥 关键布局：两端对齐
          'display:flex; justify-content:space-between; align-items:center;',
          'padding: 8px 0; padding-left: 20px; padding-right: 12px;',
          'cursor: pointer; width: 100%; box-sizing: border-box;',
          'user-select: none;',
        ].join(''),
        onClick: (e: MouseEvent) => {
          e.stopPropagation()
          toggleExpandedKey(key)
        },
      }, [
        // 左侧容器：标题 + 设置按钮
        h('div', { style: 'display:flex; align-items:center; flex:1; gap: 8px; overflow: hidden;' }, [
          h('span', { style: 'font-weight: bold; color: #888; font-size: 12px; white-space: nowrap;' }, titleLabel),

          hasSettingsBtn
            ? h('button', {
              type: 'button',
              title: t('tags.manage_sort') || '管理排序',
              style: [
                'background: transparent; border: none; padding: 4px 14px; margin-right: -8px; height: 32px; margin: 0;',
                'cursor: pointer; display: flex; align-items: center; border-radius: 4px;',
                'opacity: 0.6; transition: opacity 0.2s; outline: none;',
                'pointer-events: auto !important; z-index: 10;',
              ].join(''),
              onMouseover: (e: any) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)' },
              onMouseout: (e: any) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.backgroundColor = 'transparent' },
              onClick: (e: MouseEvent) => {
                e.preventDefault(); e.stopPropagation()
                openTagSortManager()
              },
              onMousedown: (e: MouseEvent) => e.stopPropagation(),
              onDblclick: (e: MouseEvent) => e.stopPropagation(),
            }, [h(Settings2, { size: 15 })])
            : null,
        ]),

        // 右侧容器：箭头 (推到最右边)
        h('div', { style: 'opacity: 0.5; display: flex; align-items: center;' }, [arrowVNode]),
      ]),
    }
  }

  // 🔥 新增：标签排序管理器 (弹窗 + 拖拽)
  // ==========================================================================

  function openTagSortManager() {
    const editList = ref([...allTags.value].sort((a, b) => compareTagsCustom(tagKeyName(a), tagKeyName(b))))

    const SortableListComponent = defineComponent({
      setup() {
        return () => {
          const items = editList.value
          if (items.length === 0)
            return h('div', { style: 'padding:20px;text-align:center;color:#999' }, '暂无标签')

          return h(draggable, {
            'modelValue': editList.value,
            'onUpdate:modelValue': (val: any[]) => { editList.value = val },
            'itemKey': (item: string) => item,
            'animation': 200,
            'ghostClass': 'sortable-ghost',
            'delay': 150,
            'delayOnTouchOnly': true,
            'touchStartThreshold': 5,
            'style': 'flex: 1; overflow-y: auto; padding-right: 4px; min-height: 0;',
          }, {
            item: ({ element: tag }: { element: string }) => {
              const displayName = tagKeyName(tag)
              const icon = tagIconMap.value[tag] || '#'
              return h('div', {
                class: 'tag-sort-item',
                style: {
                  'display': 'flex',
                  'alignItems': 'center',
                  'padding': '5px 8px',
                  'marginBottom': '2px',
                  'background': '#fff',
                  'border': '1px solid #eee',
                  'borderRadius': '6px',
                  'cursor': 'grab',
                  'userSelect': 'none',
                  'WebkitUserSelect': 'none',
                  '-webkit-tap-highlight-color': 'transparent',
                },
              }, [
                h('div', { class: 'drag-handle-visual', style: 'padding: 2px 8px 2px 0; display: flex; align-items: center; opacity: 0.4;' }, [h(GripVertical, { size: 16, color: '#ccc' })]),
                h('span', { style: 'margin-right:8px;width:18px;text-align:center;flex-shrink:0; pointer-events: none; font-size: 14px;' }, icon),
                h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#333; pointer-events: none;' }, displayName),
              ])
            },
          })
        }
      },
    })

    dialogOpenCount.value += 1

    // 定义对话框实例变量，稍后赋值
    let d: any = null

    // 封装保存逻辑
    const handleSave = async () => {
      const newOrder = editList.value.map(t => tagKeyName(t))
      tagOrder.value = newOrder
      await saveTagOrder()
      await refreshTagCountsFromServer(true)
      message.success(t('tags.save_success') || '排序已保存')
      d?.destroy()
    }

    d = dialog.create({
      title: t('tags.manage_sort') || '标签排序',
      showIcon: false,
      style: 'width: 400px; max-width: 90vw;',
      onAfterLeave: () => { dialogOpenCount.value = Math.max(0, dialogOpenCount.value - 1) },

      // 1. 内容区域：包含提示语 + 列表
      content: () => h('div', { style: 'display: flex; flex-direction: column; height: 60vh; max-height: 500px;' }, [
        // 顶部提示语 (11px)
        h('div', { style: 'font-size: 11px; color: #999; margin-bottom: 8px; flex-shrink: 0;' }, t('tags.drag_to_sort_tip') || '长按拖拽可调整顺序'),
        // 列表
        h(SortableListComponent),
      ]),

      // 2. 自定义页脚 (Action)：实现“左侧恢复，右侧按钮组”
      action: () => h('div', { style: 'display: flex; justify-content: space-between; align-items: center; width: 100%;' }, [

        // 左侧：恢复默认按钮 (11px)
        h('button', {
          type: 'button',
          style: 'background: transparent; border: none; cursor: pointer; color: #888; display: flex; align-items: center; gap: 3px; font-size: 11px; padding: 4px 0; transition: color 0.2s; white-space: nowrap;',
          onMouseover: (e: any) => e.currentTarget.style.color = '#555',
          onMouseout: (e: any) => e.currentTarget.style.color = '#888',
          onClick: () => {
            editList.value.sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
            message.info(t('tags.order_reset_tip') || '已恢复字母排序，点击保存生效')
          },
        }, [h(RotateCcw, { size: 11 }), h('span', null, t('tags.reset_default') || '恢复默认')]),

        // 右侧：取消/保存按钮组
        h('div', { style: 'display: flex; gap: 12px;' }, [
          h(NButton, {
            size: 'small',
            onClick: () => d?.destroy(),
          }, { default: () => t('auth.cancel') || '取消' }),

          h(NButton, {
            type: 'primary',
            size: 'small',
            // 按钮颜色跟随主题色 (可选，如果不需要特定颜色可去掉 color 属性)
            color: '#6366f1',
            onClick: handleSave,
          }, { default: () => t('auth.save') || '保存' }),
        ]),
      ]),
    })
  }

  function invalidateOneTagCache(tag: string) {
    const k = getTagCacheKey(tag)
    localStorage.removeItem(k)
  }
  function invalidateAllTagCaches() {
    const prefix = CACHE_KEYS.TAG_PREFIX
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix))
        localStorage.removeItem(key)
    }
  }
  function invalidateAllSearchCaches() {
    const prefix = CACHE_KEYS.SEARCH_PREFIX
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix))
        localStorage.removeItem(key)
    }
  }

  // 📌 MODIFIED: 优化菜单打开时的加载逻辑
  async function onMainMenuOpen() {
    const uid = await getUserId()
    if (!uid)
      return
    hydrateCountsFromLocal(uid)
    refreshTagCountsFromServer().catch(() => {})
    refreshUntaggedCountFromServer(true).catch(() => {})
    // expandedGroups.value = {}
  }

  // 若主菜单被误关（处于行内更多/对话框交互时），自动重开；点击外部关闭除外
  watch(mainMenuVisible, (show) => {
    if (!show) {
      onMainMenuOpen()
      isRowMoreOpen.value = false
    }
    if (!show && (isRowMoreOpen.value || dialogOpenCount.value > 0) && !lastMoreClosedByOutside)
      nextTick(() => { mainMenuVisible.value = true })
  })

  // 用这个替换原来的 handleRowMenuSelect
  function handleRowMenuSelect(tag: string, action: 'pin' | 'rename' | 'remove' | 'change_icon') {
  // 这句可选：明确声明不是“外部点击”导致的关闭
    lastMoreClosedByOutside = false

    // 关键：无论执行哪种操作，都立刻安排把主菜单保持为打开
    // 用 nextTick 避免与 NDropdown 的收起事件“打架”
    const keepOpen = () => nextTick(() => { mainMenuVisible.value = true })

    if (action === 'pin') {
      togglePin(tag)
      keepOpen() // <— 保持汉堡菜单不关
      return
    }
    if (action === 'rename') {
      keepOpen() // 先保持打开，再弹重命名对话框
      renameTag(tag)
      return
    }
    if (action === 'remove') {
      keepOpen()
      removeTagCompletely(tag)
      return
    }
    if (action === 'change_icon') {
      keepOpen()
      changeTagIcon(tag)
    }
  }

  function getRowMenuOptions(tag: string, closeMenu: () => void) {
    const pinned = isPinned(tag)

    // ✅ 修改后的 makeRow：文字在左，图标在右，保留原色
    function makeRow(
      action: 'pin' | 'rename' | 'change_icon' | 'remove',
      text: string,
      IconComp: any,
      customColor?: string, // 👈 新增可选颜色参数
    ) {
      return {
        key: action,
        type: 'render' as const,
        render: () =>
          h(
            'div',
            {
              style: [
                'display:flex;',
                'align-items:center;',
                'justify-content:space-between;', // ✅ 核心修改：两端对齐
                'width: 100%;', // ✅ 核心修改：撑满容器宽度
                'padding:4px 10px;',
                'gap:8px;',
                'cursor:pointer;',
                // ✅ 如果传入了颜色（如删除的红色），则应用它，不传则继承默认
                customColor ? `color:${customColor};` : '',
              ].join(''),
              onClick: (e: MouseEvent) => {
                e.stopPropagation()
                handleRowMenuSelect(tag, action)
                closeMenu()
              },
            },
            [
              // 1. 文字放前面
              h(
                'span',
                {
                  style: 'font-size:13px;',
                },
                text,
              ),

              // 2. 图标放后面
              h(
                'span',
                {
                  style: 'display:inline-flex;width:20px;justify-content:center;',
                },
                [
                  h(IconComp, {
                    size: 16,
                    strokeWidth: 2,
                    // ✅ 这里不写 color，它会自动继承外层的 customColor 或默认色
                  }),
                ],
              ),
            ],
          ),
      }
    }

    const pinLabel = pinned
      ? (t('notes.unpin_favorites') || '取消置顶')
      : (t('notes.pin_favorites') || '设置常用')

    // ✅ 修改 2：在数组中插入分割线
    return [
      makeRow('pin', pinLabel, pinned ? StarOff : Star),
      { type: 'divider', key: 'd1' }, // 👈 分割线

      makeRow('rename', t('tags.rename_tag') || '重命名', Pencil),
      { type: 'divider', key: 'd2' }, // 👈 分割线

      makeRow('change_icon', t('tags.change_icon') || '更改图标', Sparkles),
      { type: 'divider', key: 'd3' }, // 👈 分割线

      // 给移除按钮加上红色警示风格 '#d03050'
      makeRow('remove', t('tags.remove_tag') || '移除', Trash2, '#d03050'),
    ]
  }

  function changeTagIcon(raw: string) {
    const tag = normalizeTag(raw)
    let dialogInst: any
    const pick = (emoji: string) => {
      tagIconMap.value = { ...tagIconMap.value, [tag]: emoji }
      saveIcons()
      dialogInst?.destroy?.()
    }
    const IconPickerComponent = defineComponent({
      setup() {
        const searchQuery = ref('')
        return () => {
          const query = searchQuery.value.trim().toLowerCase()
          const renderBody = () => {
            let iconList = ICON_CATEGORIES
            if (query) {
              const allIcons = ICON_CATEGORIES.flatMap(cat => cat.icons)
              const filteredIcons = allIcons.filter(item =>
                item.icon.includes(query) || item.keywords.some(kw => kw.includes(query)),
              )
              if (filteredIcons.length === 0)
                return h('div', { style: 'text-align:center; padding: 20px; color: #888;' }, t('tags.no_icons_found') || '未找到匹配的图标')
              iconList = [{ category: '搜索结果', icons: filteredIcons }]
            }
            return iconList.map(category =>
              h('div', { style: 'margin-bottom: 16px;' }, [
                h('h4', { style: 'font-size: 14px; font-weight: 600; color: #555; margin: 0 0 8px 4px;' }, category.category),
                h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill, minmax(40px, 1fr));gap:8px;box-sizing: border-box;' }, category.icons.map(item =>
                  h('button', {
                    style: 'height:42px; font-size: 24px; display: flex; align-items: center; justify-content: center; border:1px solid #eee;border-radius:8px;background:#fff;cursor:pointer;transition:background .2s;',
                    onClick: () => pick(item.icon),
                    onMouseover: (ev: any) => { ev.currentTarget.style.background = '#f5f5f5' },
                    onMouseout: (ev: any) => { ev.currentTarget.style.background = '#fff' },
                  }, item.icon),
                )),
              ]),
            )
          }
          return h('div', { class: 'icon-picker-root', style: 'width: 100%; box-sizing: border-box;' }, [
            h(NInput, {
              'value': searchQuery.value,
              'onUpdate:value': (v: string) => { searchQuery.value = v },
              'placeholder': t('tags.search_icon') || '搜索图标或关键词',
              'clearable': true,
              'autofocus': false,
              'size': 'small',
              'style': 'width: 100%; box-sizing: border-box;',
              'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
              'onVnodeMounted': (vnode) => {
                const inputEl = (vnode as any).el?.querySelector('input')
                if (!inputEl)
                  return
                inputEl.blur()
                const startTime = Date.now()
                const blurInterval = setInterval(() => {
                  if (Date.now() - startTime > 300) { clearInterval(blurInterval); return }
                  inputEl.blur()
                }, 16)
              },
            }),
            h('div', { style: 'margin-top:4px; margin-bottom: 12px;' }, [
              h('div', { style: 'font-size:12px;color:#888' }, t('tags.tip_icon_custom') || '也可以在上面输入框直接粘贴任意符号作为图标'),
            ]),
            h('div', { style: 'height:min(360px, 60vh);overflow-y:auto; padding: 2px 10px 2px 2px; margin-right: -10px' }, [renderBody()]),
            h('div', { style: 'display:flex;justify-content:flex-end;margin-top:12px' }, [
              h('button', { style: 'border:none;background:#e5e5e5;border-radius:8px;padding:6px 10px;cursor:pointer', onClick: () => dialogInst?.destroy?.() }, t('auth.cancel') || '取消'),
            ]),
          ])
        }
      },
    })
    dialogOpenCount.value += 1
    dialogInst = dialog.create({
      title: t('tags.change_icon') || '更改图标',
      type: 'info',
      closable: true,
      maskClosable: true,
      showIcon: false,
      content: () => h(IconPickerComponent),
      action: null,
      onAfterLeave: () => {
        dialogOpenCount.value = Math.max(0, dialogOpenCount.value - 1)
      },
    })
  }

  async function renameTag(oldRaw: string) {
    if (isBusy.value)
      return
    const oldTag = normalizeTag(oldRaw)
    const initial = tagKeyName(oldTag)
    const renameState = { next: initial }
    dialogOpenCount.value += 1
    dialog.create({
      type: 'info',
      title: t('tags.rename_tag') || '重命名标签',
      content: () =>
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, [
          h('span', null, '#'),
          h(NInput, {
            defaultValue: initial,
            autofocus: true,
            placeholder: t('tags.input_new_tag') || '输入新标签名',
            style: 'font-size:16px;',
            onVnodeMounted: (vnode: any) => {
              const el = vnode?.el?.querySelector('input') as HTMLInputElement | null
              if (el) { el.focus(); el.select() }
            },
            onUpdateValue: (v: string) => { renameState.next = (v || '').trim() },
          }),
        ]),
      positiveText: t('auth.confirm') || '确定',
      negativeText: t('auth.cancel') || '取消',
      maskClosable: false,
      onAfterLeave: () => { dialogOpenCount.value = Math.max(0, dialogOpenCount.value - 1) },
      onPositiveClick: async () => {
        const nextName = renameState.next || ''
        const newTag = normalizeTag(nextName)
        if (!newTag || newTag === oldTag)
          return
        isBusy.value = true
        try {
          const uid = await getUserId()
          if (!uid)
            throw new Error(t('auth.session_expired') || '登录已过期')
          const { data, error } = await supabase.rpc('rename_tag', { p_user_id: uid, p_old: oldTag, p_new: newTag })
          if (error)
            throw error
          const idx = allTags.value.indexOf(oldTag)
          if (idx >= 0)
            allTags.value.splice(idx, 1, newTag)
          else if (!allTags.value.includes(newTag))
            allTags.value.push(newTag)
          const pIdx = pinnedTags.value.indexOf(oldTag)
          if (pIdx >= 0) { pinnedTags.value.splice(pIdx, 1, newTag); await savePinned() }
          if (tagIconMap.value[oldTag]) {
            tagIconMap.value[newTag] = tagIconMap.value[oldTag]
            delete tagIconMap.value[oldTag]
            await saveIcons()
          }
          invalidateOneTagCache(oldTag)
          invalidateOneTagCache(newTag)
          invalidateAllSearchCaches()
          await refreshTagCountsFromServer(true)
          const count = typeof data === 'number' ? data : undefined
          if (typeof count === 'number')
            message.success(`${t('notes.update_success') || '重命名成功'}（${count}）`)
          else message.success(t('notes.update_success') || '重命名成功')
        }
        catch (e: any) {
          message.error(`${t('notes.operation_error') || '操作失败'}: ${e?.message || e}`)
        }
        finally {
          isBusy.value = false
        }
      },
    })
  }

  async function removeTagCompletely(raw: string) {
    if (isBusy.value)
      return
    const tag = normalizeTag(raw)
    dialogOpenCount.value += 1
    dialog.warning({
      title: t('tags.delete_tag_title') || '删除标签',
      content:
        t('tags.delete_tag_content', { tag })
        || `这将从你的所有笔记中删除标签 ${tag}（仅删除标签文本，不会删除任何笔记）。此操作不可撤销。`,
      positiveText: t('tags.delete_tag_confirm') || '删除标签',
      negativeText: t('notes.cancel') || '取消',
      maskClosable: false,
      onAfterLeave: () => { dialogOpenCount.value = Math.max(0, dialogOpenCount.value - 1) },
      onPositiveClick: async () => {
        isBusy.value = true
        try {
          const uid = await getUserId()
          if (!uid)
            throw new Error(t('auth.session_expired') || '登录已过期')
          const { data, error } = await supabase.rpc('remove_tag', { p_user_id: uid, p_tag: tag })
          if (error)
            throw error
          const i = allTags.value.indexOf(tag)
          if (i >= 0)
            allTags.value.splice(i, 1)
          const pIdx = pinnedTags.value.indexOf(tag)
          if (pIdx >= 0) { pinnedTags.value.splice(pIdx, 1); await savePinned() }
          if (tagIconMap.value[tag]) { delete tagIconMap.value[tag]; await saveIcons() }
          invalidateOneTagCache(tag)
          invalidateAllTagCaches()
          invalidateAllSearchCaches()
          await refreshTagCountsFromServer(true)
          const count = typeof data === 'number' ? data : undefined
          if (typeof count === 'number')
            message.success(`${t('tags.delete_tag_success') || '已删除标签'}（${count}）个`)
          else message.success(t('tags.delete_tag_success') || '已删除标签')
        }
        catch (e: any) {
          message.error(`${t('notes.operation_error') || '操作失败'}: ${e?.message || e}`)
        }
        finally {
          isBusy.value = false
        }
      },
    })
  }

  // ======= 允许“父/祖先”也出现在常用：修复三级标签都可置顶 =======
  function tagExistsOrIsAncestor(raw: string): boolean {
    const tag = normalizeTag(raw)
    const base = tagKeyName(tag)
    if (allTags.value.includes(tag))
      return true
    return allTags.value.some((t) => {
      const tk = tagKeyName(t)
      if (tk === base)
        return true
      return tk.startsWith(`${base}/`)
    })
  }

  const tagMenuChildren = computed(() => {
    const total = allTags.value.length
    if (total === 0)
      return [] as any[]

    // 2. 常用标签 (Pinned)
    const pinnedChildren = pinnedTags.value.filter((tag) => {
      if (!tag || !tagExistsOrIsAncestor(tag))
        return false
      const q = tagSearch.value.trim().toLowerCase()
      return !q || tagKeyName(tag).toLowerCase().includes(q)
    }).sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b))).map(tag => makeTagRow(tag))

    // 🔥 修改：使用 makeGroupHeaderRow 创建可持久化折叠的 Pinned 组
    const pinnedHeader = pinnedChildren.length > 0
      ? makeGroupHeaderRow(KEY_PINNED_GROUP, `⭐ ${t('notes.favorites') || '常用'}`)
      : null

    // 🔥 根据持久化状态决定是否显示子元素
    const pinnedBody = (pinnedHeader && isExpandedKey(KEY_PINNED_GROUP)) ? pinnedChildren : []

    // 3. 构建全部标签树
    const treeChildren = treeToDownwardGroups(hierarchicalTags.value, tagCounts.value, tagIconMap.value, makeTagRow, makeHeaderRow, isExpandedKey, toggleExpandedKey, compareTagsCustom)

    // 字母分组 (通常只在搜索或无层级时出现，这里暂时不加持久化，或者你可以按需加)
    const letterGroups = groupedTags.value.filter(({ tags }) => tags.length > 0).map(({ letter, tags }) => ({
      type: 'group' as const,
      key: `grp-${letter}`,
      label: () => h('div', { style: 'color: #888; font-weight: bold; font-size: 12px;' }, letter),
      children: tags.map(tag => makeTagRow(tag)),
    }))

    const body = treeChildren.length > 0 ? treeChildren : letterGroups

    // 🔥 修改：使用 makeGroupHeaderRow 创建可持久化折叠的 All Tags 组
    const showAllTagsHeader = pinnedChildren.length > 0 && body.length > 0
    let allTagsRows: any[] = body

    if (showAllTagsHeader) {
      const allHeader = makeGroupHeaderRow(KEY_ALL_TAGS_GROUP, t('notes.all_favorites') || '全部标签', true)
      const allBody = isExpandedKey(KEY_ALL_TAGS_GROUP) ? body : []
      allTagsRows = [allHeader, ...allBody]
    }

    // 4. 无标签
    const untaggedRow = makeUntaggedRow(0)
    const bottomSpacer = (body.length > 0) ? [{ key: 'sep-untagged', type: 'render' as const, render: () => h('div', { style: 'height:6px;' }) }] : []

    // 组合数组：扁平化结构 (Header 和 Body 是兄弟节点，不是父子，这样我们才能完全控制显示隐藏)
    const result = [] as any[]
    if (pinnedHeader)
      result.push(pinnedHeader, ...pinnedBody)
    result.push(...allTagsRows, ...bottomSpacer, untaggedRow)

    return result
  })

  function makeTagRow(tag: string, labelName?: string, indentPx = 0) {
    const count = tagCounts.value[tag] ?? 0
    const displayName = labelName ?? tagKeyName(tag)
    const icon = tagIconMap.value[tag] || '#'
    const textLabel = count > 0 ? `${displayName}（${count}）` : displayName
    const fullTitle = `${icon} ${textLabel}`

    const placementRef = ref<SmartPlacement>('top-start')
    const showRef = ref(false)
    let btnEl: HTMLElement | null = null

    const openMenu = () => {
      placementRef.value = computeSmartPlacementStrict(btnEl)
      showRef.value = true
      isRowMoreOpen.value = true
    }
    const closeMenu = () => {
      showRef.value = false
      isRowMoreOpen.value = false
    }

    const MORE_DOT_SIZE = 20

    // 🔥 修复缩进的核心：
    // Sidebar CSS 强制了 padding-left: 20px。
    // 我们必须用 !important 才能覆盖它，实现层级缩进。
    const BASE_PADDING = 20
    const finalPadding = BASE_PADDING + indentPx

    return {
      key: tag,
      // 使用 render 函数直接渲染内容，绕过部分组件库默认样式干扰
      label: () =>
        h('div', {
          class: 'tag-row-wrapper',
          style: [
            'width: 100%;',
            `padding-left: ${finalPadding}px !important;`, // ⚡️ 强制应用缩进
            'padding-right: 16px;',
            'box-sizing: border-box;',
            // 确保内部垂直居中
            'display: flex;',
            'align-items: center;',
          ].join(''),
        }, [
          h('div', {
            class: 'tag-row-table-layout',
            style: 'display: table; width: 100%; table-layout: fixed;',
            title: fullTitle,
          }, [
            // 1. 图标列
            h('div', { style: 'display: table-cell; width: 22px; vertical-align: middle; padding-right: 6px;' }, icon),

            // 2. 文本列 (自动截断)
            h('div', { style: 'display: table-cell; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }, textLabel),

            // 3. 操作按钮列 (居右)
            h('div', { style: 'display: table-cell; width: 42px; vertical-align: middle; text-align: right;' }, [
              h(NDropdown, {
                options: getRowMenuOptions(tag, closeMenu),
                trigger: 'manual',
                show: showRef.value,
                showArrow: false,
                size: 'small',
                placement: placementRef.value,
                to: 'body',
                onUpdateShow: (show: boolean) => {
                  showRef.value = show
                  isRowMoreOpen.value = show
                  if (show)
                    lastMoreClosedByOutside = false
                },
                onClickoutside: () => {
                  lastMoreClosedByOutside = true
                  closeMenu()
                  setTimeout(() => { lastMoreClosedByOutside = false }, 200)
                },
              }, {
                default: () => h('button', {
                  'aria-label': t('tags.more_actions') || '更多操作',
                  'title': t('tags.more_actions') || '更多操作',
                  'style': [
                    'background:none;border:none;cursor:pointer;',
                    'display:inline-flex;align-items:center;justify-content:center;',
                    'flex-shrink:0;',
                    `width:${MORE_DOT_SIZE + 16}px !important;`,
                    `height:${MORE_DOT_SIZE + 16}px !important;`,
                    `font-size:${MORE_DOT_SIZE}px !important;`,
                    `line-height:${MORE_DOT_SIZE + 16}px !important;`,
                    'font-weight:600;border-radius:10px;opacity:0.95;',
                  ].join(''),
                  'onMousedown': (e: MouseEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onPointerdown': (e: PointerEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onClick': (e: MouseEvent) => {
                    e.stopPropagation()
                    // 修复：如果刚刚因点击外部关闭，则不立即重开
                    if (lastMoreClosedByOutside)
                      return

                    btnEl = e.currentTarget as HTMLElement
                    if (showRef.value) {
                      closeMenu()
                    }
                    else {
                      placementRef.value = computeSmartPlacementStrict(btnEl)
                      nextTick(() => {
                        openMenu()
                        requestAnimationFrame(() => { (btnEl as HTMLElement | null)?.focus?.() })
                      })
                    }
                  },
                }, [h('span', { style: 'font-size:inherit !important; display:inline-block; transform: translateY(-1px);' }, '⋯')]),
              }),
            ]),
          ]),
        ]),
      props: { onClick: () => selectTag(tag) },
    }
  }

  function makeHeaderRow(
    node: TagTreeNode,
    tagFull: string,
    labelName: string,
    getExpanded: () => boolean,
    onToggle: () => void,
    indentPx = 0,
  ) {
    // 🔥 对齐修复 1：基准 Padding 统一为 20，与 makeTagRow 保持一致
    const BASE_PADDING = 20
    const finalPadding = BASE_PADDING + indentPx

    const total = getNodeCount(node, tagCounts.value)
    const icon = tagIconMap.value[tagFull] || '#'
    const textLabel = total > 0 ? `${labelName}（${total}）` : `${labelName}`
    const fullTitle = `${icon} ${textLabel}`

    const ICON_SIZE = 18
    const ICON_STROKE = 2.5
    const MORE_DOT_SIZE = 20
    const placementRef = ref<SmartPlacement>('top-start')
    const showRef = ref(false)
    let btnEl: HTMLElement | null = null

    const openMenu = () => {
      placementRef.value = computeSmartPlacementStrict(btnEl)
      showRef.value = true
      isRowMoreOpen.value = true
    }
    const closeMenu = () => {
      showRef.value = false
      isRowMoreOpen.value = false
    }

    return {
      key: `hdr-${tagFull}`,
      type: 'render' as const,
      render: () => {
        const expanded = getExpanded()
        const arrowVNode = h(ChevronRight, {
          'size': ICON_SIZE,
          'strokeWidth': ICON_STROKE,
          'color': '#999',
          'style': `display:inline-block; transform: translateY(1px) rotate(${expanded ? 90 : 0}deg); transition: transform .15s ease;`,
          'aria-hidden': 'true',
          'focusable': 'false',
        })

        return h('div', {
          class: 'tag-row-wrapper',
          style: [
            'width: 100%;',
            // 🔥 对齐修复 2：强制应用计算后的缩进，解决二级标签不缩进的问题
            `padding-left: ${finalPadding}px !important;`,
            'padding-right: 16px;',
            'box-sizing: border-box;',
            'display: flex;',
            'align-items: center;',
            'user-select: none;',
          ].join(''),
        }, [
          h('div', { style: 'display: table; width: 100%; table-layout: fixed;' }, [

            // 🔥 对齐修复 3：将图标拆分到独立的单元格 (Cell 1)，宽度固定 22px
            // 这样它就和 makeTagRow 的图标位置完全重叠了
            h('div', {
              style: 'display: table-cell; width: 22px; vertical-align: middle; padding-right: 6px;',
              onClick: () => { selectTag(tagFull) }, // 点击图标也能筛选
            }, icon),

            // Cell 2: 文字 (点击筛选)
            h('div', {
              style: 'display: table-cell; vertical-align: middle; overflow: hidden; white-space: nowrap; cursor: pointer;',
              title: fullTitle,
              onClick: () => { selectTag(tagFull) },
            }, textLabel),

            // Cell 3: 折叠箭头 (点击切换折叠) - 放在文字和更多按钮中间
            h('div', {
              'style': 'display: table-cell; width: 24px; vertical-align: middle; text-align: center; cursor: pointer;',
              'role': 'button',
              'aria-label': expanded ? (t('notes.collapse') || '收起') : (t('notes.expand') || '展开'),
              'aria-expanded': String(expanded),
              'onClick': (e: MouseEvent) => { e.stopPropagation(); onToggle() },
            }, [arrowVNode]),

            // Cell 4: 更多操作按钮
            h('div', { style: 'display: table-cell; width: 42px; vertical-align: middle; text-align: right;' }, [
              h(NDropdown, {
                options: getRowMenuOptions(tagFull, closeMenu),
                trigger: 'manual',
                show: showRef.value,
                showArrow: false,
                size: 'small',
                placement: placementRef.value,
                to: 'body',
                onUpdateShow: (show: boolean) => {
                  showRef.value = show
                  isRowMoreOpen.value = show
                  if (show)
                    lastMoreClosedByOutside = false
                },
                onClickoutside: () => {
                  lastMoreClosedByOutside = true
                  closeMenu()
                  setTimeout(() => { lastMoreClosedByOutside = false }, 200)
                },
              }, {
                default: () => h('button', {
                  'aria-label': t('tags.more_actions') || '更多操作',
                  'title': t('tags.more_actions') || '更多操作',
                  'style': [
                    'background:none;border:none;cursor:pointer;',
                    'display:inline-flex;align-items:center;justify-content:center;',
                    'flex-shrink:0;',
                    `width:${MORE_DOT_SIZE + 16}px !important;`,
                    `height:${MORE_DOT_SIZE + 16}px !important;`,
                    `font-size:${MORE_DOT_SIZE}px !important;`,
                    `line-height:${MORE_DOT_SIZE + 16}px !important;`,
                    'font-weight:600;border-radius:10px;opacity:0.95;',
                  ].join(''),
                  'onMousedown': (e: MouseEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onPointerdown': (e: PointerEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onClick': (e: MouseEvent) => {
                    e.stopPropagation()
                    if (lastMoreClosedByOutside)
                      return // 防止误触重开

                    btnEl = e.currentTarget as HTMLElement
                    if (showRef.value) {
                      closeMenu()
                    }
                    else {
                      placementRef.value = computeSmartPlacementStrict(btnEl)
                      nextTick(() => {
                        openMenu()
                        requestAnimationFrame(() => { (btnEl as HTMLElement | null)?.focus?.() })
                      })
                    }
                  },
                }, [h('span', { style: 'font-size:inherit !important; display:inline-block; transform: translateY(-1px);' }, '⋯')]),
              }),
            ]),
          ]),
        ])
      },
    }
  }

  function makeUntaggedRow(indentPx = 0) {
    const icon = '∅'
    const name = t('tags.untagged') || '无标签'
    const cnt = untaggedCount.value
    const display = Number.isFinite(cnt as number) ? `${icon} ${name}（${cnt}）` : `${icon} ${name}`
    const rowPadding = indentPx > 0 ? `padding-left:${indentPx}px;` : ''
    return {
      key: UNTAGGED_SENTINEL,
      label: () =>
        h('div', {
          class: 'tag-row',
          style: [
            'display:flex;align-items:center;',
            'justify-content:space-between;',
            `width: calc(100% + ${SHIFT_LEFT_PX}px);`,
            'gap:12px;',
            `margin-left: -${SHIFT_LEFT_PX}px;`,
            rowPadding,
            'user-select:none;',
          ].join(''),
        }, [
          h('span', {
            class: 'tag-text',
            style: 'flex:1 1 0%;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            title: display,
          }, display),
          h('span', { style: 'width: 28px; height: 1px;' }, ''),
        ]),
      props: { onClick: () => selectTag(UNTAGGED_SENTINEL) },
    }
  }

  // ========= 新增：查询辅助 =========

  /** 把当前 selectedTag 应用到 Supabase 链式过滤（用于你现有的列表查询处） */
  function buildSupabaseFilter<T extends ReturnType<typeof supabase.from>>(q: T) {
    if (!selectedTag.value)
      return q
    if (selectedTag.value === UNTAGGED_SENTINEL) {
      return (q as any)
        .or('content.is.null,not(content).is.null')
        .not('content', 'like', '%#%')
    }
    const key = tagKeyName(selectedTag.value)
    return (q as any).like('content', `%#${key}%`)
  }

  /**
   * 📌 MODIFIED: 拉取笔记列表时，实现“先读缓存，再请求”逻辑
   */
  async function fetchNotesBySelection(uid: string) {
    if (!uid || !selectedTag.value)
      return []

    const cacheKey = getTagCacheKey(selectedTag.value)
    const cachedRaw = localStorage.getItem(cacheKey)
    if (cachedRaw) {
      try {
        return JSON.parse(cachedRaw)
      }
      catch {
        // 缓存数据损坏，清除后继续执行请求
        localStorage.removeItem(cacheKey)
      }
    }

    // 封装原始的请求逻辑
    const fetchFromServer = async () => {
      if (selectedTag.value === UNTAGGED_SENTINEL) {
        // 优先尝试更精准的 RPC（如未创建则自动回退）
        try {
          const { data, error } = await supabase.rpc('get_untagged_notes', { p_user_id: uid })
          if (!error && Array.isArray(data))
            return data
        }
        catch {}
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', uid)
          .or('content.is.null,not(content).is.null')
          .not('content', 'like', '%#%')
          .order('created_at', { ascending: false })
        if (error)
          throw error
        return data || []
      }
      let q = supabase.from('notes').select('*').eq('user_id', uid).order('created_at', { ascending: false })
      q = buildSupabaseFilter(q)
      const { data, error } = await q
      if (error)
        throw error
      return data || []
    }

    const result = await fetchFromServer()

    // 将请求结果存入缓存
    localStorage.setItem(cacheKey, JSON.stringify(result))

    return result
  }

  return {
    mainMenuVisible,
    tagSearch,
    pinnedTags,
    selectedTag,
    isUntaggedSelected,
    isPinned,
    togglePin,
    selectTag,
    tagMenuChildren,
    hierarchicalTags,
    refreshTags: refreshTagCountsFromServer,
    buildSupabaseFilter,
    fetchNotesBySelection,
    UNTAGGED_SENTINEL,
    tagCounts,
  }
}
