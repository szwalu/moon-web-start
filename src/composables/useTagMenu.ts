// src/composables/useTagMenu.ts
/* eslint-disable style/max-statements-per-line */
import { type Ref, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NDropdown, NInput, useDialog, useMessage } from 'naive-ui'
import { ICON_CATEGORIES } from './icon-data'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getTagCacheKey } from '@/utils/cacheKeys'

/** 本地存储 Key */
const PINNED_TAGS_KEY = 'pinned_tags_v1'
const TAG_COUNT_CACHE_KEY_PREFIX = 'tag_counts_v1:'
const TAG_ICON_MAP_KEY = 'tag_icons_v1'

// === 新增：离线与缓存新鲜度 ===
const ALL_TAGS_CACHE_KEY_PREFIX = 'all_tags_v1:'
const LAST_UID_KEY = 'last_uid_v1'
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 天，可自行调整

function isOnline(): boolean {
  try { return typeof navigator !== 'undefined' ? navigator.onLine : true }
  catch { return true }
}
function isFresh(savedAt: number | null | undefined): boolean {
  if (!savedAt || !Number.isFinite(savedAt))
    return false
  return (Date.now() - Number(savedAt)) <= MAX_CACHE_AGE_MS
}

/** 无标签筛选的固定哨兵值 */
const UNTAGGED_SENTINEL = '__UNTAGGED__'

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
function ensureTagMenuInputFontFix() {
  if (typeof document === 'undefined')
    return
  const id = 'tag-menu-ios-input-16px-fix'
  if (document.getElementById(id))
    return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    /* 只影响本组件里的两个搜索框 */
    .n-dropdown-menu .tag-search-row .n-input__input-el { font-size: 16px !important; }
    .n-dialog .icon-picker-root .n-input__input-el     { font-size: 16px !important; }
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

/** 常用区的紧凑标签名：#一/二/三 -> "…/三"；单级仍显示本名 */
function compactLabelForPinned(tag: string): string {
  const parts = splitTagPath(tag) // ["一","二","三"]
  if (parts.length >= 2)
    return `…/${parts[parts.length - 1]}`
  return parts[0] || tagKeyName(tag)
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

/** 离线兜底：allTags 为空时，用计数里的 key + pinned 合成标签列表 */
function synthesizeAllTagsFromCountsAndPinned(): string[] {
  const keys = Object.keys(tagCounts.value || {}) // "#xxx"
  const fromPinned = (pinnedTags.value || []).map(normalizeTag)
  const set = new Set<string>([...keys, ...fromPinned])
  return Array.from(set).filter(Boolean).sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
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
): any[] {
  const rows: any[] = []
  const level1Names = Object.keys(root.children).sort((a, b) => a.localeCompare(b))

  for (const name1 of level1Names) {
    const node1 = root.children[name1]
    const path1 = name1
    const tag1 = node1.full ?? `#${path1}`
    const hasL2 = Object.keys(node1.children).length > 0

    if (!hasL2) {
      rows.push(makeRow(tag1, name1, 0))
      continue
    }

    rows.push(makeHeader(node1, tag1, name1, isExpanded(path1), () => toggle(path1), 0))

    if (!isExpanded(path1))
      continue

    const level2Names = Object.keys(node1.children).sort((a, b) => a.localeCompare(b))
    for (const name2 of level2Names) {
      const node2 = node1.children[name2]
      const path2 = `${path1}/${name2}`
      const tag2 = node2.full ?? `#${path2}`
      const hasL3 = Object.keys(node2.children).length > 0

      if (!hasL3) {
        rows.push(makeRow(tag2, name2, 16))
        continue
      }

      rows.push(makeHeader(node2, tag2, name2, isExpanded(path2), () => toggle(path2), 16))

      if (!isExpanded(path2))
        continue

      const level3Names = Object.keys(node2.children).sort((a, b) => a.localeCompare(b))
      for (const name3 of level3Names) {
        const node3 = node2.children[name3]
        const path3 = `${path2}/${name3}`
        const tag3 = node3.full ?? `#${path3}`
        rows.push(makeRow(tag3, name3, 32))
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

/** 离线优先获取 uid：先 session->user->本地兜底 */
async function getUserIdLocalFirst(): Promise<string | null> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const uid1 = sess?.session?.user?.id
    if (uid1)
      return uid1
  }
  catch {}
  try {
    const { data, error } = await supabase.auth.getUser()
    if (!error) {
      const uid2 = data?.user?.id ?? null
      if (uid2)
        return uid2
    }
  }
  catch {}
  try {
    const uid3 = localStorage.getItem(LAST_UID_KEY)
    return uid3 || null
  }
  catch { return null }
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
  const SHIFT_LEFT_GROUP_HEADER_PX = 24 - FINAL_LEFT_PADDING
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
  let tagCountsChannel: ReturnType<typeof supabase.channel> | null = null
  let lastFetchAt = 0

  // —— 保持主菜单常开的辅助状态 —— //
  const isRowMoreOpen = ref(false)
  let lastMoreClosedByOutside = false
  const dialogOpenCount = ref(0)
  const NOTES_CACHE_TTL = 300_000 // 300 秒，可按需调整
  const notesCache = new Map<string, { items: any[]; ts: number; sig: string | null }>()

  // —— 筛选状态（内建） —— //
  const selectedTag = ref<string | null>(null)
  const untaggedCount = ref<number | null>(null)
  let lastUntaggedFetchAt = 0
  let isLoadingUntagged = false
  const isUntaggedSelected = computed(() => selectedTag.value === UNTAGGED_SENTINEL)

  // —— 可折叠状态 —— //
  const expandedGroups = ref<Record<string, boolean>>({})

  function isExpandedKey(key: string) {
    return !!expandedGroups.value[key]
  }
  function toggleExpandedKey(key: string) {
    expandedGroups.value[key] = !expandedGroups.value[key]
  }

  function saveCountsCacheToLocal() {
    const uid = currentUserId.value
    if (!uid)
      return
    const items = Object.entries(tagCounts.value).map(([tag, cnt]) => ({ tag, cnt }))
    localStorage.setItem(
      `${TAG_COUNT_CACHE_KEY_PREFIX}${uid}`,
      JSON.stringify({ sig: tagCountsSig.value, items, savedAt: Date.now() }),
    )
  }

  // === 新增：allTags 本地缓存 ===
  function saveAllTagsToLocal(uid: string, tags: string[]) {
    try {
      localStorage.setItem(`${ALL_TAGS_CACHE_KEY_PREFIX}${uid}`, JSON.stringify({ items: tags, savedAt: Date.now() }))
    }
    catch {}
  }
  function hydrateAllTagsFromLocal(uid: string): number | null {
    try {
      const raw = localStorage.getItem(`${ALL_TAGS_CACHE_KEY_PREFIX}${uid}`)
      if (!raw)
        return null
      const obj = JSON.parse(raw) as { items: string[]; savedAt: number }
      if (!Array.isArray(obj.items) || obj.items.length === 0)
        return null
      if (!isFresh(obj.savedAt))
        return null
      allTags.value = obj.items.slice()
      return obj.savedAt ?? null
    }
    catch { return null }
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
    localStorage.setItem(`${TAG_ICON_MAP_KEY}:updated_at`, String(Date.now()))
  }

  function hydrateCountsFromLocal(uid: string): number | null {
    const cacheKey = TAG_COUNT_CACHE_KEY_PREFIX + uid
    const cachedRaw = localStorage.getItem(cacheKey)
    if (!cachedRaw)
      return null
    try {
      const cached = JSON.parse(cachedRaw) as {
        sig: string | null
        items: Array<{ tag: string; cnt: number }>
        savedAt: number
      }
      if (!isFresh(cached.savedAt))
        return null // ★新增：过期则不用
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
  /** 仅取服务器端签名（last_updated），用于“有变更才刷新” */
  async function fetchServerCountsSig(uid: string): Promise<string | null> {
    try {
    // 返回 text（上面 SQL 的返回类型），也可能是 { data: '...' }
      const { data, error } = await supabase.rpc('get_tag_counts_sig', { p_user_id: uid })
      if (error)
        return null
      // data 可能是 string 或 { last_updated: string }，你按自己 RPC 返回调整
      if (typeof data === 'string')
        return data
      if (data && typeof (data as any).last_updated === 'string')
        return (data as any).last_updated
      return null
    }
    catch { return null }
  }

  /** 条件刷新 tagCounts：只有签名不同才真正拉取 */
  async function ensureFreshTagCounts() {
    if (!isOnline())
      return
    const uid = currentUserId.value || await getUserId()
    if (!uid)
      return
    currentUserId.value = uid

    // 1) 先用本地缓存“回填 UI”（已存在 hydrateCountsFromLocal）
    hydrateCountsFromLocal(uid)

    // 2) 询问服务器签名；一样就跳过重拉
    const serverSig = await fetchServerCountsSig(uid)
    const localSig = tagCountsSig.value
    if (serverSig && localSig && serverSig === localSig) {
    // 没变更：仅更新时间戳（可选）
      return
    }
    // 3) 有变更或拿不到签名：再走旧的完整拉取
    await refreshTagCountsFromServer(true)
  }

  /** 条件刷新“无标签数”：复用同一 sig（notes 有任何更新就可能影响无标签数） */
  async function ensureFreshUntagged() {
    if (!isOnline())
      return
    const uid = currentUserId.value || await getUserId()
    if (!uid)
      return
    currentUserId.value = uid

    // 不必每次都请求，先看看 sig 是否变了：
    const serverSig = await fetchServerCountsSig(uid)
    const localSig = tagCountsSig.value
    if (serverSig && localSig && serverSig === localSig) {
    // 认为无变化，直接使用现有的 untaggedCount（若你想加 TTL，可在这里判断 savedAt）
      return
    }
    await refreshUntaggedCountFromServer(true)
  }

  async function refreshTagCountsFromServer(force = false) {
    const now = Date.now()
    if (!force && now - lastFetchAt < 700)
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
        const map: Record<string, number> = {}
        const items: Array<{ tag: string; cnt: number }> = []
        for (const row of data) {
          const tg = String(row.tag)
          const cnt = Number(row.cnt ?? 0)
          map[tg] = cnt
          items.push({ tag: tg, cnt })
        }
        tagCounts.value = map
        tagCountsSig.value = serverSig || null
        saveCountsCacheToLocal()
        localStorage.setItem(cacheKey, JSON.stringify({ sig: tagCountsSig.value, items, savedAt: Date.now() }))
      }
      else {
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
      const { data, error } = await supabase.rpc('get_untagged_count', { p_user_id: uid })
      if (!error) {
        const n = typeof data === 'number' ? data : Number((data as any)?.count ?? (data as any)?.cnt ?? 0)
        untaggedCount.value = Number.isFinite(n) ? n : null
        return
      }
    }
    catch {
      // fall through
    }
    finally {
      isLoadingUntagged = false
    }

    // fallback: 近似法
    try {
      isLoadingUntagged = true
      const base = supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', uid)
      const { count: total } = await base
      const { count: withSharp } = await supabase
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .like('content', '%#%')
      const n = (total ?? 0) - (withSharp ?? 0)
      untaggedCount.value = n >= 0 ? n : 0
    }
    catch {
      untaggedCount.value = null
    }
    finally {
      isLoadingUntagged = false
    }
  }

  onMounted(async () => {
    ensureTagMenuInputFontFix()

    // 1) 本地快速回填 pinned / icons
    try {
      const raw = localStorage.getItem(PINNED_TAGS_KEY)
      pinnedTags.value = raw ? JSON.parse(raw) : []
    }
    catch {
      pinnedTags.value = []
    }
    hydrateIconsFromLocal()

    // 2) 仅当远端更“新”时覆盖本地（避免每次都拉）
    try {
      const { data, error } = await supabase.auth.getUser()
      if (!error && data?.user) {
        const um = (data.user.user_metadata || {}) as any

        // —— pinned 条件同步 —— //
        const remotePinned = Array.isArray(um?.pinned_tags) ? (um.pinned_tags as string[]) : []
        const remotePinnedAt
        = typeof um?.pinned_tags_updated_at === 'string' ? Date.parse(um.pinned_tags_updated_at) : 0
        const localPinnedAt = Number(localStorage.getItem(`${PINNED_TAGS_KEY}:updated_at`) || 0)
        if (remotePinnedAt && remotePinnedAt > localPinnedAt) {
          pinnedTags.value = remotePinned
          localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(remotePinned))
          localStorage.setItem(`${PINNED_TAGS_KEY}:updated_at`, String(remotePinnedAt))
        }

        // —— icons 条件同步 —— //
        const remoteIcons
        = um?.tag_icons && typeof um.tag_icons === 'object' ? (um.tag_icons as Record<string, string>) : {}
        const remoteIconsAt
        = typeof um?.tag_icons_updated_at === 'string' ? Date.parse(um.tag_icons_updated_at) : 0
        const localIconsAt = Number(localStorage.getItem(`${TAG_ICON_MAP_KEY}:updated_at`) || 0)
        if (remoteIconsAt && remoteIconsAt > localIconsAt) {
          tagIconMap.value = { ...tagIconMap.value, ...remoteIcons }
          localStorage.setItem(TAG_ICON_MAP_KEY, JSON.stringify(tagIconMap.value))
          localStorage.setItem(`${TAG_ICON_MAP_KEY}:updated_at`, String(remoteIconsAt))
        }
      }
    }
    catch {
    /* 静默 */
    }

    // 3) 使用“本地优先”的方式获取 uid，并把 uid 记到本地（离线兜底）
    currentUserId.value = await getUserIdLocalFirst()
    if (currentUserId.value) {
      try { localStorage.setItem(LAST_UID_KEY, currentUserId.value) }
      catch {}
    }

    // 4) 首屏也先用本地 allTags 兜底（若还没有则不动）
    if (currentUserId.value && allTags.value.length === 0)
      hydrateAllTagsFromLocal(currentUserId.value)

    // 5) tag counts 与无标签数：有变更才拉（ensure* 内部已做离线短路）
    if (currentUserId.value) {
      await ensureFreshTagCounts().catch(() => {})
      await ensureFreshUntagged().catch(() => {})
    }

    // 6) 订阅 realtime（保持你原逻辑不变）
    const uid = currentUserId.value
    if (uid) {
    // 计数也先用本地缓存兜底一次（仅当缓存新鲜时才会成功回填）
      hydrateCountsFromLocal(uid)

      tagCountsChannel = supabase
        .channel(`tag-counts-${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const content = payload?.new?.content as string | undefined
            if (content === undefined || contentHasAnyTag(content))
              refreshTagCountsFromServer(true).catch(() => {})
            refreshUntaggedCountFromServer(true).catch(() => {})
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const oldContent = payload?.old?.content as string | undefined
            if (oldContent === undefined || contentHasAnyTag(oldContent))
              refreshTagCountsFromServer(true).catch(() => {})
            refreshUntaggedCountFromServer(true).catch(() => {})
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const beforeContent = payload?.old?.content as string | undefined
            const afterContent = payload?.new?.content as string | undefined
            const unsure = beforeContent === undefined && afterContent === undefined
            if (unsure || contentHasAnyTag(beforeContent) || contentHasAnyTag(afterContent))
              refreshTagCountsFromServer(true).catch(() => {})
            refreshUntaggedCountFromServer(true).catch(() => {})
          },
        )
        .subscribe()
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
    localStorage.setItem(`${PINNED_TAGS_KEY}:updated_at`, String(Date.now()))
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
    for (const tt of filteredTags.value) {
      if (isPinned(tt))
        continue
      const name = tagKeyName(tt)
      const letter = /^[A-Za-z]/.test(name) ? name[0].toUpperCase() : '#'
      if (!groups[letter])
        groups[letter] = []
      groups[letter].push(tt)
    }
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
    })
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
    const list = filteredTags.value.filter(tt => !isPinned(tt))
    return buildTagTree(list)
  })

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

  async function onMainMenuOpen() {
    const uid = await getUserIdLocalFirst()
    // 每次打开重置展开状态
    expandedGroups.value = {}

    if (uid) {
    // 先本地秒开计数（只有新鲜缓存才会回填成功）
      const countsTs = hydrateCountsFromLocal(uid)

      // allTags：优先本地缓存；若仍为空且计数是新鲜的，用计数+置顶合成
      if (allTags.value.length === 0) {
        hydrateAllTagsFromLocal(uid)
        if (allTags.value.length === 0 && isFresh(countsTs)) {
          const synthesized = synthesizeAllTagsFromCountsAndPinned()
          if (synthesized.length > 0)
            allTags.value = synthesized
        }
      }
    }

    // 在线再后台刷新（不 await，不阻塞 UI）；离线短路
    if (isOnline()) {
      ensureFreshTagCounts().catch(() => {})
      ensureFreshUntagged().catch(() => {})
    }
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

  watch(allTags, (v) => {
    const uid = currentUserId.value
    if (uid && Array.isArray(v) && v.length > 0)
      saveAllTagsToLocal(uid, v)
  }, { deep: false })

  watch(tagCountsSig, () => {
  // 计数签名变化说明后端数据有更新：让笔记结果缓存失效
    notesCache.clear()
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

  function getRowMenuOptions(tag: string) {
    const pinned = isPinned(tag)
    return [
      { label: pinned ? (t('notes.unpin_favorites') || '取消置顶') : (t('notes.pin_favorites') || '置顶'), key: 'pin' },
      { label: t('tags.rename_tag') || '重命名', key: 'rename' },
      { label: t('tags.change_icon') || '更改图标', key: 'change_icon' },
      { label: t('tags.remove_tag') || '移除', key: 'remove' },
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

    const placeholderText = t('tags.search_from_count', { count: total }) || `从 ${total} 条标签中搜索`
    const searchOption = {
      key: 'tag-search',
      type: 'render' as const,
      render: () =>
        h('div', { class: 'tag-search-row' }, [
          h(NInput, {
            'value': tagSearch.value,
            'onUpdate:value': (v: string) => { tagSearch.value = v },
            'placeholder': placeholderText,
            'clearable': true,
            'autofocus': true,
            'size': 'small',
            'style': '--n-input-font-size:16px;font-size:16px;width:calc(100% - 20px);margin:0 auto;display:block;',
            'inputProps': { style: 'font-size:16px' },
            'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
          }),
        ]),
    }

    const pinnedChildren = pinnedTags.value
      .filter((tag) => {
        if (!tag)
          return false
        if (!tagExistsOrIsAncestor(tag))
          return false
        const q = tagSearch.value.trim().toLowerCase()
        if (!q)
          return true
        return tagKeyName(tag).toLowerCase().includes(q)
      })
      .sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
      .map(tag => makeTagRow(tag, compactLabelForPinned(tag)))

    const pinnedGroup = pinnedChildren.length > 0
      ? [{
          type: 'group' as const,
          key: 'pinned-group',
          label: () => h('div', {
            style: `margin-left: -${SHIFT_LEFT_GROUP_HEADER_PX}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
          }, `⭐ ${t('notes.favorites') || '常用'}`),
          children: pinnedChildren,
        }]
      : []

    const treeChildren = treeToDownwardGroups(
      hierarchicalTags.value,
      tagCounts.value,
      tagIconMap.value,
      makeTagRow,
      makeHeaderRow,
      isExpandedKey,
      toggleExpandedKey,
    )

    const letterGroups = groupedTags.value
      .filter(({ tags }) => tags.length > 0)
      .map(({ letter, tags }) => ({
        type: 'group' as const,
        key: `grp-${letter}`,
        label: () => h('div', { style: `margin-left: -${SHIFT_LEFT_GROUP_HEADER_PX}px;` }, letter),
        children: tags.map(tag => makeTagRow(tag)),
      }))

    const body = treeChildren.length > 0 ? treeChildren : letterGroups

    const separatorOption = (pinnedGroup.length > 0 && body.length > 0)
      ? [{
          key: 'separator',
          type: 'render' as const,
          render: () => h('div', { style: `padding-left: ${FINAL_LEFT_PADDING}px; color: #ccc; font-weight: bold; padding-top: 4px; padding-bottom: 4px; user-select: none;` }, '#'),
        }]
      : []

    const mainBody = body

    // —— 底部追加 “∅ 无标签（N）” —— //
    const untaggedRow = makeUntaggedRow(0)
    const bottomSpacer = (mainBody.length > 0)
      ? [{
          key: 'sep-untagged',
          type: 'render' as const,
          render: () => h('div', { style: 'height:6px;' }),
        }]
      : []

    return [searchOption, ...pinnedGroup, ...separatorOption, ...mainBody, ...bottomSpacer, untaggedRow]
  })

  function makeTagRow(tag: string, labelName?: string, indentPx = 0) {
    const count = tagCounts.value[tag] ?? 0
    const displayName = labelName ?? tagKeyName(tag)
    const icon = tagIconMap.value[tag] || '#'
    const textLabel = count > 0 ? `${displayName}（${count}）` : displayName
    const fullTitle = `${icon} ${textLabel}`

    const placementRef = ref<SmartPlacement>('top-start')
    let btnEl: HTMLElement | null = null

    const rowPadding = indentPx > 0 ? `padding-left:${indentPx}px;` : ''

    return {
      key: tag,
      label: () =>
        h('div', {
          class: 'tag-row-wrapper',
          style: [
            `width: calc(100% + ${SHIFT_LEFT_PX}px);`,
            `margin-left: -${SHIFT_LEFT_PX}px;`,
            rowPadding,
            'box-sizing: border-box;',
          ].join(''),
        }, [
          h('div', {
            class: 'tag-row-table-layout',
            style: 'display: table; width: 100%; table-layout: fixed;',
            title: fullTitle,
          }, [
            // Cell 1: Icon
            h('div', { style: 'display: table-cell; width: 22px; vertical-align: middle; padding-right: 6px;' }, icon),
            // Cell 2: Text (will truncate)
            h('div', { style: 'display: table-cell; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }, textLabel),
            // Cell 3: "More" button
            h('div', { style: 'display: table-cell; width: 42px; vertical-align: middle; text-align: right;' }, [
              h(NDropdown, {
                options: getRowMenuOptions(tag),
                trigger: 'click',
                showArrow: false,
                size: 'small',
                placement: placementRef.value,
                to: 'body',
                onUpdateShow: (show: boolean) => {
                  // 仅做状态记录 在打开瞬间计算一次位置
                  isRowMoreOpen.value = show
                  if (show && btnEl)
                    placementRef.value = computeSmartPlacementStrict(btnEl)
                },
                onSelect: (key: any) => {
                  // 关键：不再在这里主动 close；让 NDropdown 自己关，保证 onSelect 在移动端能触发
                  lastMoreClosedByOutside = false
                  handleRowMenuSelect(tag, key)
                },
              }, {
                default: () => h('button', {
                  'aria-label': t('tags.more_actions') || '更多操作',
                  'title': t('tags.more_actions') || '更多操作',
                  'style': [
                    'background:none;border:none;cursor:pointer;',
                    'display:inline-flex;align-items:center;justify-content:center;',
                    'flex-shrink:0;',
                    'width:36px !important;',
                    'height:36px !important;',
                    'font-size:20px !important;',
                    'line-height:36px !important;',
                    'font-weight:600;border-radius:10px;opacity:0.95;',
                  ].join(''),
                  // 不再手动切 showRef，只记录 btnEl 并计算 placement
                  'onClick': (e: MouseEvent) => {
                    e.stopPropagation()
                    btnEl = e.currentTarget as HTMLElement
                    placementRef.value = computeSmartPlacementStrict(btnEl)
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
    expanded: boolean,
    onToggle: () => void,
    indentPx = 0,
  ) {
    const HORIZONTAL_PADDING = BASE_NAIVE_PADDING - SHIFT_LEFT_PX
    const total = getNodeCount(node, tagCounts.value)
    const icon = tagIconMap.value[tagFull] || '#'
    const textLabel = total > 0 ? `${labelName}（${total}）` : `${labelName}`
    const fullTitle = `${icon} ${textLabel}`
    const arrow = expanded ? '▼' : '▶'

    const placementRef = ref<SmartPlacement>('top-start')
    let btnEl: HTMLElement | null = null

    return {
      key: `hdr-${tagFull}`,
      type: 'render' as const,
      render: () =>
        h('div', {
          style: [
            `padding-left: ${HORIZONTAL_PADDING + indentPx}px;`,
            'padding-right: 4px;',
            'box-sizing: border-box;',
            'width: 100%;',
            'user-select: none;',
          ].join(''),
        }, [
          h('div', {
            style: 'display: table; width: 100%; table-layout: fixed;',
          }, [
            // Cell 1: Icon + Text (clickable, will truncate)
            h('div', {
              style: 'display: table-cell; vertical-align: middle; overflow: hidden; white-space: nowrap; cursor: pointer;',
              title: fullTitle,
              onClick: (e: MouseEvent) => { e.stopPropagation(); selectTag(tagFull) },
            }, [
              h('span', { style: 'text-overflow: ellipsis; overflow: hidden; display: inline-block; max-width: 100%;' }, [
                h('span', null, icon),
                h('span', { style: 'margin-left: 6px;' }, textLabel),
              ]),
            ]),
            // Cell 2: Arrow (clickable)
            h('div', {
              style: 'display: table-cell; width: 24px; vertical-align: middle; text-align: center; cursor: pointer;',
              onClick: (e: MouseEvent) => { e.stopPropagation(); onToggle() },
            }, arrow),
            // Cell 3: "More" button
            h('div', {
              style: 'display: table-cell; width: 42px; vertical-align: middle; text-align: right;',
            }, [
              h(NDropdown, {
                options: getRowMenuOptions(tagFull),
                trigger: 'click',
                showArrow: false,
                size: 'small',
                placement: placementRef.value,
                to: 'body',
                onUpdateShow: (show: boolean) => {
                  isRowMoreOpen.value = show
                  if (show && btnEl)
                    placementRef.value = computeSmartPlacementStrict(btnEl)
                },
                onSelect: (key: any) => {
                  lastMoreClosedByOutside = false
                  handleRowMenuSelect(tagFull, key)
                },
              }, {
                default: () => h('button', {
                  'aria-label': t('tags.more_actions') || '更多操作',
                  'title': t('tags.more_actions') || '更多操作',
                  'style': [
                    'background:none;border:none;cursor:pointer;',
                    'display:inline-flex;align-items:center;justify-content:center;',
                    'flex-shrink:0;',
                    'width:36px !important;',
                    'height:36px !important;',
                    'font-size:20px !important;',
                    'line-height:36px !important;',
                    'font-weight:600;border-radius:10px;opacity:0.95;',
                  ].join(''),
                  'onMousedown': (e: MouseEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onPointerdown': (e: PointerEvent) => { e.preventDefault(); e.stopPropagation() },
                  'onClick': (e: MouseEvent) => {
                    e.stopPropagation()
                    btnEl = e.currentTarget as HTMLElement
                    placementRef.value = computeSmartPlacementStrict(btnEl)
                  },
                }, [h('span', { style: 'font-size:inherit !important; display:inline-block; transform: translateY(-1px);' }, '⋯')]),
              }),
            ]),
          ]),
        ]),
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

  /** 直接拉取“当前选中标签（含无标签）”的笔记列表（带 300s 结果缓存） */
  async function fetchNotesBySelection(uid: string) {
    if (!uid)
      return []

    // —— 计算缓存 key & 命中逻辑 —— //
    const sel = selectedTag.value || '__ALL__'
    const cacheKey = `${uid}:${sel}`
    const sig = tagCountsSig.value
    const now = Date.now()
    const hit = notesCache.get(cacheKey)
    if (hit && hit.sig === sig && (now - hit.ts) <= NOTES_CACHE_TTL)
      return hit.items

    // —— 真实拉取 —— //
    if (selectedTag.value === UNTAGGED_SENTINEL) {
      try {
        const { data, error } = await supabase.rpc('get_untagged_notes', { p_user_id: uid })
        if (!error && Array.isArray(data)) {
          notesCache.set(cacheKey, { items: data, ts: Date.now(), sig })
          return data
        }
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
      const items = data || []
      notesCache.set(cacheKey, { items, ts: Date.now(), sig })
      return items
    }

    let q = supabase.from('notes').select('*').eq('user_id', uid).order('created_at', { ascending: false })
    q = buildSupabaseFilter(q)
    const { data, error } = await q
    if (error)
      throw error
    const items = data || []
    notesCache.set(cacheKey, { items, ts: Date.now(), sig })
    return items
  }

  return {
    // 状态
    mainMenuVisible,
    tagSearch,
    pinnedTags,
    selectedTag,
    isUntaggedSelected,
    // 方法
    isPinned,
    togglePin,
    selectTag,
    tagMenuChildren,
    hierarchicalTags,
    // 新增导出：查询辅助
    buildSupabaseFilter,
    fetchNotesBySelection,
    // 常量
    UNTAGGED_SENTINEL,
  }
}
