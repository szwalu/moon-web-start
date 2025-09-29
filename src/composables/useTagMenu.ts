// src/composables/useTagMenu.ts

import { type Ref, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NDropdown, NInput, useDialog, useMessage } from 'naive-ui'
import { ICON_CATEGORIES } from './icon-data'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getTagCacheKey } from '@/utils/cacheKeys'

/** 本地存储 Key */
const PINNED_TAGS_KEY = 'pinned_tags_v1'
const TAG_COUNT_CACHE_KEY_PREFIX = 'tag_counts_v1:'
const TAG_ICON_MAP_KEY = 'tag_icons_v1'

type SmartPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'

/** 严格判断：只有能“完整容纳”菜单才选择该方向；否则翻到另一侧 */
function computeSmartPlacementStrict(anchorEl: HTMLElement | null): SmartPlacement {
  if (!anchorEl)
    return 'top-start'
  const rect = anchorEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 经验尺寸：你的菜单含搜索、分组，通常较高，这里采用“必须完整容纳”的严格阈值
  const MENU_W = 300
  const MENU_H = Math.min(400, Math.floor(vh * 0.7))
  const MARGIN = 8

  const spaceBelow = vh - rect.bottom - MARGIN
  const spaceAbove = rect.top - MARGIN
  const spaceRight = vw - rect.right - MARGIN
  const spaceLeft = rect.left - MARGIN

  // 垂直方向：优先能完整容纳的一侧；都不能完整容纳则选空间更大的一侧
  let vertical: 'top' | 'bottom'
  if (spaceBelow >= MENU_H && spaceAbove >= MENU_H) {
    // 两边都够时，默认优先下方
    vertical = 'bottom'
  }
  else if (spaceBelow >= MENU_H) {
    vertical = 'bottom'
  }
  else if (spaceAbove >= MENU_H) {
    vertical = 'top'
  }
  else {
    vertical = spaceBelow >= spaceAbove ? 'bottom' : 'top'
  }

  // 水平方向：同理，只有完整容纳才选该侧；都不够则选空间更大的一侧
  let horizontal: 'start' | 'end'
  if (spaceRight >= MENU_W && spaceLeft >= MENU_W) {
    // 两边都够，默认优先 end（右侧）
    horizontal = 'end'
  }
  else if (spaceRight >= MENU_W) {
    horizontal = 'end'
  }
  else if (spaceLeft >= MENU_W) {
    horizontal = 'start'
  }
  else {
    horizontal = spaceRight >= spaceLeft ? 'end' : 'start'
  }

  return `${vertical}-${horizontal}` as SmartPlacement
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

/** 从 Supabase Auth.user_metadata 读取 pinned_tags（失败则返回 null） */
async function loadPinnedFromAuth(): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error)
      return null
    const arr = (data?.user?.user_metadata as any)?.pinned_tags
    return Array.isArray(arr) ? arr : []
  }
  catch {
    return null
  }
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

/** 从 Auth.user_metadata 读取 tag_icons（失败返回 null） */
async function loadTagIconsFromAuth(): Promise<Record<string, string> | null> {
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error)
      return null
    const map = (data?.user?.user_metadata as any)?.tag_icons
    return map && typeof map === 'object' ? map as Record<string, string> : {}
  }
  catch {
    return null
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

  function saveCountsCacheToLocal() {
    const uid = currentUserId.value
    if (!uid)
      return
    const items = Object.entries(tagCounts.value).map(([tag, cnt]) => ({ tag, cnt }))
    localStorage.setItem(
      `${TAG_COUNT_CACHE_KEY_PREFIX}${uid}`,
      JSON.stringify({
        sig: tagCountsSig.value,
        items,
        savedAt: Date.now(),
      }),
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
      tagCountsSig.value = cached.sig
      const map: Record<string, number> = {}
      for (const it of cached.items)
        map[it.tag] = it.cnt
      tagCounts.value = map
      return cached.savedAt ?? null
    }
    catch {
      return null
    }
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
    catch {
    }
    finally {
      isLoadingCounts.value = false
    }
  }

  onMounted(async () => {
    try {
      const raw = localStorage.getItem(PINNED_TAGS_KEY)
      pinnedTags.value = raw ? JSON.parse(raw) : []
    }
    catch {
      pinnedTags.value = []
    }
    hydrateIconsFromLocal()
    const serverPinned = await loadPinnedFromAuth()
    if (serverPinned) {
      pinnedTags.value = serverPinned
      localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
    }
    const serverIcons = await loadTagIconsFromAuth()
    if (serverIcons) {
      tagIconMap.value = { ...tagIconMap.value, ...serverIcons }
      localStorage.setItem(TAG_ICON_MAP_KEY, JSON.stringify(tagIconMap.value))
    }
    currentUserId.value = await getUserId()
    const uid = currentUserId.value
    if (uid) {
      hydrateCountsFromLocal(uid)
      tagCountsChannel = supabase
        .channel(`tag-counts-${uid}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const content = payload?.new?.content as string | undefined
          if (content === undefined || contentHasAnyTag(content))
            refreshTagCountsFromServer(true).catch(() => {})
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const oldContent = payload?.old?.content as string | undefined
          if (oldContent === undefined || contentHasAnyTag(oldContent))
            refreshTagCountsFromServer(true).catch(() => {})
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload: any) => {
          const beforeContent = payload?.old?.content as string | undefined
          const afterContent = payload?.new?.content as string | undefined
          const unsure = beforeContent === undefined && afterContent === undefined
          if (unsure || contentHasAnyTag(beforeContent) || contentHasAnyTag(afterContent))
            refreshTagCountsFromServer(true).catch(() => {})
        })
        .subscribe()
    }
  })

  onBeforeUnmount(() => {
    if (tagCountsChannel) {
      try {
        tagCountsChannel.unsubscribe()
      }
      catch {}
      tagCountsChannel = null
    }
  })

  async function savePinned() {
    localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
    await savePinnedToAuth(pinnedTags.value)
  }

  function isPinned(tag: string) {
    return pinnedTags.value.includes(tag)
  }

  async function togglePin(tag: string) {
    const i = pinnedTags.value.indexOf(tag)
    if (i >= 0)
      pinnedTags.value.splice(i, 1)
    else
      pinnedTags.value.push(tag)
    await savePinned()
  }

  function selectTag(tag: string) {
    onSelectTag(tag)
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
    const uid = await getUserId()
    if (!uid)
      return
    hydrateCountsFromLocal(uid)
    refreshTagCountsFromServer(true).catch(() => {})
  }

  watch(mainMenuVisible, (show) => {
    if (show)
      onMainMenuOpen().catch(() => {})
  })

  function handleRowMenuSelect(tag: string, action: 'pin' | 'rename' | 'remove' | 'change_icon') {
    if (action === 'pin') {
      togglePin(tag)
      return
    }
    if (action === 'rename') {
      renameTag(tag)
      return
    }
    if (action === 'remove') {
      removeTagCompletely(tag)
      return
    }
    if (action === 'change_icon')
      changeTagIcon(tag)
  }

  function getRowMenuOptions(tag: string) {
    const pinned = isPinned(tag)
    return [
      {
        label: pinned ? (t('notes.unpin_favorites') || '取消置顶') : (t('notes.pin_favorites') || '置顶'),
        key: 'pin',
      },
      {
        label: t('tags.rename_tag') || '重命名',
        key: 'rename',
      },
      {
        label: t('tags.change_icon') || '更改图标',
        key: 'change_icon',
      },
      {
        label: t('tags.remove_tag') || '移除',
        key: 'remove',
      },
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
                  h(
                    'button',
                    {
                      style: 'height:42px; font-size: 24px; display: flex; align-items: center; justify-content: center; border:1px solid #eee;border-radius:8px;background:#fff;cursor:pointer;transition:background .2s;',
                      onClick: () => pick(item.icon),
                      onMouseover: (ev: any) => ev.currentTarget.style.background = '#f5f5f5',
                      onMouseout: (ev: any) => ev.currentTarget.style.background = '#fff',
                    },
                    item.icon,
                  ),
                )),
              ]),
            )
          }
          return h('div', { style: 'width: 100%; box-sizing: border-box;' }, [
            h(NInput, {
              'value': searchQuery.value,
              'onUpdate:value': (v: string) => { searchQuery.value = v },
              'placeholder': t('tags.search_icon') || '搜索图标或关键词',
              'clearable': true,
              'size': 'small',
              'style': 'font-size:16px; width: 100%; box-sizing: border-box;',
              'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
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

    dialogInst = dialog.create({
      title: t('tags.change_icon') || '更改图标',
      type: 'info',
      closable: true,
      maskClosable: true,
      showIcon: false,
      content: () => h(IconPickerComponent),
      action: null,
    })
  }

  async function renameTag(oldRaw: string) {
    if (isBusy.value)
      return
    const oldTag = normalizeTag(oldRaw)
    const initial = tagKeyName(oldTag)
    const renameState = { next: initial }
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
              if (el) {
                el.focus()
                el.select()
              }
            },
            onUpdateValue: (v: string) => {
              renameState.next = (v || '').trim()
            },
          }),
        ]),
      positiveText: t('auth.confirm') || '确定',
      negativeText: t('auth.cancel') || '取消',
      maskClosable: false,
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
          const { data, error } = await supabase.rpc('rename_tag', {
            p_user_id: uid,
            p_old: oldTag,
            p_new: newTag,
          })
          if (error)
            throw error
          const idx = allTags.value.indexOf(oldTag)
          if (idx >= 0)
            allTags.value.splice(idx, 1, newTag)
          else if (!allTags.value.includes(newTag))
            allTags.value.push(newTag)
          const pIdx = pinnedTags.value.indexOf(oldTag)
          if (pIdx >= 0) {
            pinnedTags.value.splice(pIdx, 1, newTag)
            await savePinned()
          }
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
          else
            message.success(t('notes.update_success') || '重命名成功')
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
    dialog.warning({
      title: t('tags.delete_tag_title') || '删除标签',
      content:
        t('tags.delete_tag_content', { tag })
        || `这将从你的所有笔记中删除标签 ${tag}（仅删除标签文本，不会删除任何笔记）。此操作不可撤销。`,
      positiveText: t('tags.delete_tag_confirm') || '删除标签',
      negativeText: t('notes.cancel') || '取消',
      maskClosable: false,
      onPositiveClick: async () => {
        isBusy.value = true
        try {
          const uid = await getUserId()
          if (!uid)
            throw new Error(t('auth.session_expired') || '登录已过期')
          const { data, error } = await supabase.rpc('remove_tag', {
            p_user_id: uid,
            p_tag: tag,
          })
          if (error)
            throw error
          const i = allTags.value.indexOf(tag)
          if (i >= 0)
            allTags.value.splice(i, 1)
          const pIdx = pinnedTags.value.indexOf(tag)
          if (pIdx >= 0) {
            pinnedTags.value.splice(pIdx, 1)
            await savePinned()
          }
          if (tagIconMap.value[tag]) {
            delete tagIconMap.value[tag]
            await saveIcons()
          }
          invalidateOneTagCache(tag)
          invalidateAllTagCaches()
          invalidateAllSearchCaches()
          await refreshTagCountsFromServer(true)
          const count = typeof data === 'number' ? data : undefined
          if (typeof count === 'number')
            message.success(`${t('tags.delete_tag_success') || '已删除标签'}（${count}）个`)
          else
            message.success(t('tags.delete_tag_success') || '已删除标签')
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
            'style': 'font-size:16px;width:calc(100% - 20px);margin:0 auto;display:block;',
            'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
          }),
        ]),
    }
    const pinnedChildren = pinnedTags.value
      .filter(tag => filteredTags.value.includes(tag))
      .sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
      .map(tag => makeTagRow(tag))
    const pinnedGroup = pinnedChildren.length > 0 ? [{ type: 'group' as const, key: 'pinned-group', label: `⭐ ${t('notes.favorites') || '常用'}`, children: pinnedChildren }] : []
    const letterGroups = groupedTags.value
      .filter(({ tags }) => tags.length > 0)
      .map(({ letter, tags }) => ({ type: 'group' as const, key: `grp-${letter}`, label: letter, children: tags.map(tag => makeTagRow(tag)) }))
    return [searchOption, ...pinnedGroup, ...letterGroups]
  })

  function makeTagRow(tag: string) {
    const count = tagCounts.value[tag] ?? 0
    const displayName = tagKeyName(tag)
    const icon = tagIconMap.value[tag] || '#'
    const left = `${icon} ${displayName}`
    const display = count > 0 ? `${left}（${count}）` : left

    // —— 每行“更多”菜单的严格方向与手动触发 —— //
    const placementRef = ref<SmartPlacement>('top-start')
    const showRef = ref(false)
    let btnEl: HTMLElement | null = null

    const openMenu = () => {
      placementRef.value = computeSmartPlacementStrict(btnEl)
      showRef.value = true
    }
    const closeMenu = () => {
      showRef.value = false
    }

    return {
      key: tag,
      label: () =>
        h('div', { class: 'tag-row', style: 'display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;' }, [
          h('span', { class: 'tag-text', style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', title: display }, display),
          h(NDropdown, {
            options: getRowMenuOptions(tag),
            // ✅ 改为手动触发，先算方向再展示，避免“先下后翻”
            trigger: 'manual',
            show: showRef.value,
            showArrow: false,
            size: 'small',
            placement: placementRef.value,
            to: 'body',
            onUpdateShow: (show: boolean) => {
              // 仅允许通过我们控制；外部变化（如点击外部）也可关闭
              if (!show)
                showRef.value = false
            },
            onSelect: (key: 'pin' | 'rename' | 'remove' | 'change_icon') => {
              handleRowMenuSelect(tag, key)
              closeMenu()
            },
            onClickoutside: () => closeMenu(),
          }, {
            default: () =>
              h('button', {
                'class': 'more-btn',
                'aria-label': t('tags.more_actions') || '更多操作',
                'style': 'background:none;border:none;cursor:pointer;padding:2px 6px;font-size:18px;opacity:0.9;',
                'onClick': (e: MouseEvent) => {
                  e.stopPropagation()
                  btnEl = e.currentTarget as HTMLElement
                  if (showRef.value) {
                    closeMenu()
                  }
                  else {
                    // 先计算，只有能完整显示在下方才会放下方，否则翻到上方
                    placementRef.value = computeSmartPlacementStrict(btnEl)
                    nextTick(openMenu)
                  }
                },
              }, '⋯'),
          }),
        ]),
      props: { onClick: () => selectTag(tag) },
    }
  }

  return {
    mainMenuVisible,
    tagSearch,
    pinnedTags,
    isPinned,
    togglePin,
    selectTag,
    tagMenuChildren,
  }
}
