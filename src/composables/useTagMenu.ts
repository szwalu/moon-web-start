// src/composables/useTagMenu.ts
import { type Ref, computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NDropdown, NInput, useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getTagCacheKey } from '@/utils/cacheKeys'

/** 本地存储 Key */
const PINNED_TAGS_KEY = 'pinned_tags_v1'
const TAG_COUNT_CACHE_KEY_PREFIX = 'tag_counts_v1:' // 会拼接 userId
const TAG_ICON_MAP_KEY = 'tag_icons_v1' // 标签 → 图标（仅菜单显示）

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

/** 常用 emoji（可自行再扩充） */
const EMOJI_POOL = [
  // 物品/标记
  '⭐',
  '🔥',
  '✨',
  '📌',
  '📍',
  '🔖',
  '🏷️',
  '✅',
  '🟩',
  '🟥',
  '🟨',
  '🟦',
  '🟪',
  '⬜',
  '⬛',
  '📝',
  '📒',
  '📔',
  '📚',
  '✏️',
  '🖊️',
  '📎',
  '🔗',
  '🔍',
  '⏱️',
  '⏰',
  '📅',
  '📆',
  // 人/服饰
  '😊',
  '😉',
  '🤔',
  '🥳',
  '😴',
  '🤒',
  '🧘',
  '🏃',
  '💼',
  '👟',
  '👔',
  '👗',
  '🧢',
  '🎓',
  // 自然/动物
  '🌞',
  '🌙',
  '⭐',
  '☁️',
  '🌧️',
  '🌈',
  '🌊',
  '🌱',
  '🌲',
  '🍀',
  '🐱',
  '🐶',
  '🐼',
  '🐻',
  // 食物
  '🍎',
  '🍊',
  '🍋',
  '🍇',
  '🍓',
  '🍉',
  '🍞',
  '🍔',
  '🍟',
  '🍜',
  '🍕',
  '☕',
  '🍵',
  // 旅行/地点
  '🏠',
  '🏫',
  '🏢',
  '🏥',
  '🏞️',
  '🚗',
  '🚲',
  '✈️',
  '🚄',
  '🗺️',
  // 运动/娱乐
  '⚽',
  '🏀',
  '🏓',
  '🎵',
  '🎧',
  '🎬',
  '🎮',
]

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

  // —— 标签计数（内存）与本地缓存 —— //
  const tagCounts = ref<Record<string, number>>({})
  const tagCountsSig = ref<string | null>(null) // 仅用于持久化记录
  const isLoadingCounts = ref(false)
  const currentUserId = ref<string | null>(null)

  // —— 标签图标映射（仅菜单显示） —— //
  const tagIconMap = ref<Record<string, string>>({})

  // Realtime（可用则加速，但不依赖）
  let tagCountsChannel: ReturnType<typeof supabase.channel> | null = null
  let lastFetchAt = 0 // 防抖（毫秒时间戳）

  /** 写入本地缓存 */
  function saveCountsCacheToLocal() {
    const uid = currentUserId.value
    if (!uid)
      return
    const items = Object.entries(tagCounts.value).map(([tag, cnt]) => ({ tag, cnt }))
    localStorage.setItem(
      TAG_COUNT_CACHE_KEY_PREFIX + uid,
      JSON.stringify({
        sig: tagCountsSig.value,
        items,
        savedAt: Date.now(),
      }),
    )
  }

  /** 读取 tagIconMap 的本地缓存 */
  function hydrateIconsFromLocal() {
    try {
      const raw = localStorage.getItem(TAG_ICON_MAP_KEY)
      tagIconMap.value = raw ? (JSON.parse(raw) || {}) : {}
    }
    catch {
      tagIconMap.value = {}
    }
  }

  /** 保存 tagIconMap 到本地与云端 */
  async function saveIcons() {
    localStorage.setItem(TAG_ICON_MAP_KEY, JSON.stringify(tagIconMap.value))
    // 尝试同步云端（失败不提示）
    await saveTagIconsToAuth(tagIconMap.value)
  }

  /** 读取本地缓存（若有）并填充内存；返回 savedAt */
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

  /** 覆盖式拉取：从服务端取最新统计，更新内存与本地缓存（防抖 700ms；始终直连服务器） */
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
        localStorage.setItem(cacheKey, JSON.stringify({
          sig: tagCountsSig.value,
          items,
          savedAt: Date.now(),
        }))
      }
      else {
        tagCounts.value = {}
        tagCountsSig.value = null
        localStorage.removeItem(cacheKey)
      }
    }
    catch {
      // 静默失败：保留旧值
    }
    finally {
      isLoadingCounts.value = false
    }
  }

  onMounted(async () => {
    // ① 先用本地缓存立即填充（保证首屏有数据）
    try {
      const raw = localStorage.getItem(PINNED_TAGS_KEY)
      pinnedTags.value = raw ? JSON.parse(raw) : []
    }
    catch {
      pinnedTags.value = []
    }
    hydrateIconsFromLocal()

    // ② 再从服务器覆盖（以服务器为准），并同步一份回本地
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
      // 先用缓存即时填充
      hydrateCountsFromLocal(uid)

      // Realtime（仅作加速；拿不到 content 时也保守刷新）
      tagCountsChannel = supabase
        .channel(`tag-counts-${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const content = payload?.new?.content as string | undefined
            if (content === undefined || contentHasAnyTag(content))
              refreshTagCountsFromServer(true).catch(() => {})
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const oldContent = payload?.old?.content as string | undefined
            if (oldContent === undefined || contentHasAnyTag(oldContent))
              refreshTagCountsFromServer(true).catch(() => {})
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
          },
        )
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
    // 先写本地，保证即时反馈
    localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
    // 再尝试写服务器；失败则静默，保留本地缓存
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

  /** —— 缓存失效工具（标签/搜索） —— */
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

  /** —— 打开菜单：先用缓存、再强制直连服务器刷新一次 —— */
  async function onMainMenuOpen() {
    const uid = await getUserId()
    if (!uid)
      return
    hydrateCountsFromLocal(uid) // 先即时呈现
    refreshTagCountsFromServer(true).catch(() => {}) // 再拉权威数据覆盖
  }

  watch(mainMenuVisible, (show) => {
    if (show)
      onMainMenuOpen().catch(() => {})
  })

  /** —— 行内操作：置顶/重命名/移除/更改图标 —— */
  function handleRowMenuSelect(tag: string, action: 'pin' | 'rename' | 'remove' | 'change_icon' | 'clear_icon') {
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
    if (action === 'change_icon') {
      changeTagIcon(tag)
      return
    }
    if (action === 'clear_icon') {
      delete tagIconMap.value[tag]
      saveIcons()
    }
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
        label: t('tags.clear_icon') || '清除图标',
        key: 'clear_icon',
      },
      {
        label: t('tags.remove_tag') || '移除',
        key: 'remove',
      },
    ]
  }

  /** —— 选择图标（弹出一个简单的 emoji 选择器） —— */
  function changeTagIcon(raw: string) {
    const tag = normalizeTag(raw)
    const state = { q: '' }
    let inst: any

    const pick = (emoji: string) => {
      tagIconMap.value = { ...tagIconMap.value, [tag]: emoji }
      saveIcons()
      inst?.destroy?.()
    }

    inst = dialog.create({
      title: t('tags.change_icon') || '更改图标',
      type: 'info',
      closable: true,
      maskClosable: true,
      showIcon: false,
      content: () => {
        const grid = () => {
          const list = state.q.trim()
            ? EMOJI_POOL.filter(e => e.includes(state.q.trim()))
            : EMOJI_POOL
          return h(
            'div',
            {
              style:
                'display:grid;grid-template-columns:repeat(8,1fr);gap:8px;max-height:360px;overflow:auto;padding-top:8px;',
            },
            list.map(e =>
              h(
                'button',
                {
                  style:
                    'height:40px;font-size:22px;line-height:40px;text-align:center;border:1px solid #eee;border-radius:8px;background:#fff;cursor:pointer',
                  onClick: () => pick(e),
                },
                e,
              ),
            ),
          )
        }

        return h('div', { style: 'width:420px;max-width:90vw' }, [
          h(NInput, {
            'value': state.q,
            'onUpdate:value': (v: string) => (state.q = v),
            'placeholder': t('tags.search_icon') || '搜索或直接输入表情',
            'clearable': true,
            'size': 'small',
            'style': 'font-size:16px;',
            'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
          }),
          h('div', { style: 'margin-top:8px' }, [
            // 允许用户直接粘贴任意字符作为图标
            h(
              'div',
              { style: 'font-size:12px;color:#888' },
              t('tags.tip_icon_custom') || '也可以在上面输入框直接粘贴任意 emoji/符号作为图标',
            ),
          ]),
          grid(),
          h('div', { style: 'display:flex;justify-content:space-between;margin-top:12px' }, [
            h(
              'button',
              {
                style: 'border:none;background:#f5f5f5;border-radius:8px;padding:6px 10px;cursor:pointer',
                onClick: () => {
                  delete tagIconMap.value[tag]
                  saveIcons()
                  inst?.destroy?.()
                },
              },
              t('tags.clear_icon') || '清除图标',
            ),
            h(
              'button',
              {
                style: 'border:none;background:#e5e5e5;border-radius:8px;padding:6px 10px;cursor:pointer',
                onClick: () => inst?.destroy?.(),
              },
              t('auth.cancel') || '取消',
            ),
          ]),
        ])
      },
      action: null,
    })
  }

  /** —— RPC 版：重命名/移除 —— */
  async function renameTag(oldRaw: string) {
    if (isBusy.value)
      return
    const oldTag = normalizeTag(oldRaw)
    const initial = tagKeyName(oldTag)

    // 弹窗输入新名字
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
            style: 'font-size:16px;', // iOS 防放大
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

          // 本地 allTags 更新
          const idx = allTags.value.indexOf(oldTag)
          if (idx >= 0)
            allTags.value.splice(idx, 1, newTag)
          else if (!allTags.value.includes(newTag))
            allTags.value.push(newTag)

          // 迁移置顶状态
          const pIdx = pinnedTags.value.indexOf(oldTag)
          if (pIdx >= 0) {
            pinnedTags.value.splice(pIdx, 1, newTag)
            await savePinned()
          }

          // 迁移图标
          if (tagIconMap.value[oldTag]) {
            tagIconMap.value[newTag] = tagIconMap.value[oldTag]
            delete tagIconMap.value[oldTag]
            await saveIcons()
          }

          // 失效：标签缓存、搜索缓存
          invalidateOneTagCache(oldTag)
          invalidateOneTagCache(newTag)
          invalidateAllSearchCaches()

          // 强制刷新一次计数（重命名会影响计数分布）——直连服务器
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

          // 本地状态与缓存清理
          const i = allTags.value.indexOf(tag)
          if (i >= 0)
            allTags.value.splice(i, 1)

          const pIdx = pinnedTags.value.indexOf(tag)
          if (pIdx >= 0) {
            pinnedTags.value.splice(pIdx, 1)
            await savePinned()
          }

          // 同步清理图标
          if (tagIconMap.value[tag]) {
            delete tagIconMap.value[tag]
            await saveIcons()
          }

          invalidateOneTagCache(tag)
          invalidateAllTagCaches()
          invalidateAllSearchCaches()

          // 强制刷新一次计数——直连服务器
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

  /** —— 菜单渲染（显示计数 + 「⋯」行内菜单） —— */
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
            'onUpdate:value': (v: string) => {
              tagSearch.value = v
            },
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

    const pinnedGroup
      = pinnedChildren.length > 0
        ? [{
            type: 'group' as const,
            key: 'pinned-group',
            label: `⭐ ${t('notes.favorites') || '常用'}`,
            children: pinnedChildren,
          }]
        : []

    const letterGroups = groupedTags.value
      .filter(({ tags }) => tags.length > 0)
      .map(({ letter, tags }) => ({
        type: 'group' as const,
        key: `grp-${letter}`,
        label: letter,
        children: tags.map(tag => makeTagRow(tag)),
      }))

    return [searchOption, ...pinnedGroup, ...letterGroups]
  })

  function makeTagRow(tag: string) {
    const count = tagCounts.value[tag] ?? 0
    const displayName = tagKeyName(tag)
    const icon = tagIconMap.value[tag] || '#'
    const left = `${icon} ${displayName}`
    const display = count > 0 ? `${left}（${count}）` : left

    return {
      key: tag,
      label: () =>
        h('div', {
          class: 'tag-row',
          style: 'display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;',
        }, [
          // 左侧文本（图标 + 名称 + 计数）
          h('span', {
            class: 'tag-text',
            style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            title: display,
          }, display),

          // 右侧「三个小黑点」下拉菜单
          h(NDropdown, {
            options: getRowMenuOptions(tag),
            trigger: 'click',
            showArrow: false,
            size: 'small',
            placement: 'bottom-end',
            onSelect: (key: 'pin' | 'rename' | 'remove' | 'change_icon' | 'clear_icon') => {
              handleRowMenuSelect(tag, key)
            },
            onClickoutside: () => {
              // 不打断父级下拉的显示
            },
          }, {
            default: () =>
              h('button', {
                'class': 'more-btn',
                'aria-label': t('tags.more_actions') || '更多操作',
                'style': 'background:none;border:none;cursor:pointer;padding:2px 6px;font-size:18px;opacity:0.9;',
                'onClick': (e: MouseEvent) => {
                  e.stopPropagation()
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
