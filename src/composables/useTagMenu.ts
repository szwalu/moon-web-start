// src/composables/useTagMenu.ts
import { type Ref, computed, h, onMounted, ref } from 'vue'
import { NInput } from 'naive-ui'

/** 本地存储 Key，避免和你已有缓存冲突 */
const PINNED_TAGS_KEY = 'pinned_tags_v1'

/**
 * allTags: 传入你的所有标签（如 #work、#生活）
 * onSelectTag: 选中标签时回调（比如调用 fetchNotesByTag(tag)）
 * t: 传入 i18n 的 t 函数（仅用于占位文案）
 */
export function useTagMenu(
  allTags: Ref<string[]>,
  onSelectTag: (tag: string) => void,
  t: (key: string, arg?: any) => string,
) {
  // 一级菜单显示控制（用于选完标签后自动收起一级菜单）
  const mainMenuVisible = ref(false)

  // 搜索关键字（仅作用于标签子菜单）
  const tagSearch = ref('')

  // 星标（常用）标签
  const pinnedTags = ref<string[]>([])

  onMounted(() => {
    try {
      const raw = localStorage.getItem(PINNED_TAGS_KEY)
      pinnedTags.value = raw ? JSON.parse(raw) : []
    }
    catch {
      pinnedTags.value = []
    }
  })

  function savePinned() {
    localStorage.setItem(PINNED_TAGS_KEY, JSON.stringify(pinnedTags.value))
  }

  function isPinned(tag: string) {
    return pinnedTags.value.includes(tag)
  }

  function togglePin(tag: string) {
    const i = pinnedTags.value.indexOf(tag)
    if (i >= 0)
      pinnedTags.value.splice(i, 1)
    else pinnedTags.value.push(tag)
    savePinned()
  }

  function selectTag(tag: string) {
    onSelectTag(tag)
    // 选完标签后，自动收起一级菜单
    mainMenuVisible.value = false
  }

  function tagKeyName(tag: string) {
    return tag.startsWith('#') ? tag.slice(1) : tag
  }

  /** 过滤：按关键字过滤（忽略大小写） */
  const filteredTags = computed(() => {
    const q = tagSearch.value.trim().toLowerCase()
    if (!q)
      return allTags.value
    return allTags.value.filter(t => t.toLowerCase().includes(q))
  })

  /** 按首字母分组（A-Z / #） */
  const groupedTags = computed(() => {
    const groups: Record<string, string[]> = {}
    for (const t of filteredTags.value) {
      if (isPinned(t))
        continue // 星标单独分组
      const name = tagKeyName(t)
      const letter = /^[A-Za-z]/.test(name) ? name[0].toUpperCase() : '#'
      if (!groups[letter])
        groups[letter] = []
      groups[letter].push(t)
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

  /** 生成“子菜单 children”（给 NDropdown 的 `options[标签].children` 用） */
  const tagMenuChildren = computed(() => {
    // 顶部搜索框（render option，不可选）
    const searchOption = {
      key: 'tag-search',
      type: 'render' as const,
      render: () =>
        h('div', { class: 'tag-search-row' }, [
          h(NInput, {
            'value': tagSearch.value,
            'onUpdate:value': (v: string) => { tagSearch.value = v },
            'placeholder': t('notes.search_tags') || '搜索标签…',
            'clearable': true,
            'autofocus': true,
            'size': 'small',
            'onKeydown': (e: KeyboardEvent) => e.stopPropagation(), // 防止方向键影响菜单聚焦
          }),
        ]),
    }

    // 常用（星标）分组
    const pinnedChildren = pinnedTags.value
      .filter(tag => filteredTags.value.includes(tag))
      .sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
      .map(tag => ({
        key: tag,
        // 用 label 函数渲染整行（包含星标）
        label: () =>
          h('div', { class: 'tag-row' }, [
            h('span', { class: 'tag-text' }, tag),
            h(
              'button',
              {
                class: 'pin-btn pinned',
                onClick: (e: MouseEvent) => {
                  e.stopPropagation()
                  togglePin(tag)
                },
                title: t('notes.unpin_favorites') || '取消常用',
              },
              '★',
            ),
          ]),
      }))

    const pinnedGroup
      = pinnedChildren.length > 0
        ? [{
            type: 'group' as const,
            key: 'pinned-group',
            label: `⭐ ${t('notes.favorites') || '常用'}`,
            children: pinnedChildren,
          }]
        : []

    // 字母分组（跳过空分组）
    const letterGroups = groupedTags.value
      .filter(({ tags }) => tags.length > 0)
      .map(({ letter, tags }) => ({
        type: 'group' as const,
        key: `grp-${letter}`,
        label: letter,
        children: tags.map(tag => ({
          key: tag,
          // 用 label 函数渲染整行（包含星标）
          label: () =>
            h('div', { class: 'tag-row' }, [
              h('span', { class: 'tag-text' }, tag),
              h(
                'button',
                {
                  class: 'pin-btn',
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation()
                    togglePin(tag)
                  },
                  title: t('notes.pin_favorites') || '设为常用',
                },
                isPinned(tag) ? '★' : '☆',
              ),
            ]),
        })),
      }))

    return [searchOption, ...pinnedGroup, ...letterGroups]
  })

  return {
    // 状态
    mainMenuVisible,
    tagSearch,
    pinnedTags,

    // 读写
    isPinned,
    togglePin,
    selectTag,

    // 给 NDropdown 用的 children
    tagMenuChildren,
  }
}
