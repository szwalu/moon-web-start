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
  const mainMenuVisible = ref(false)
  const tagSearch = ref('')
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
    else
      pinnedTags.value.push(tag)
    savePinned()
  }

  function selectTag(tag: string) {
    onSelectTag(tag)
    mainMenuVisible.value = false
  }

  function tagKeyName(tag: string) {
    return tag.startsWith('#') ? tag.slice(1) : tag
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

  const tagMenuChildren = computed(() => {
    const total = allTags.value.length
    if (total === 0)
      return [] as any[]

    const placeholderText = `从 ${total} 条标签中搜索`
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
            // 改为接近一级菜单宽度，略窄，居中
            'style': 'font-size:16px;width:calc(100% - 20px);margin:0 auto;display:block;',
            'onKeydown': (e: KeyboardEvent) => e.stopPropagation(),
          }),
        ]),
    }

    const pinnedChildren = pinnedTags.value
      .filter(tag => filteredTags.value.includes(tag))
      .sort((a, b) => tagKeyName(a).localeCompare(tagKeyName(b)))
      .map(tag => ({
        key: tag,
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
        props: { onClick: () => selectTag(tag) },
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

    const letterGroups = groupedTags.value
      .filter(({ tags }) => tags.length > 0)
      .map(({ letter, tags }) => ({
        type: 'group' as const,
        key: `grp-${letter}`,
        label: letter,
        children: tags.map(tag => ({
          key: tag,
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
          props: { onClick: () => selectTag(tag) },
        })),
      }))

    return [searchOption, ...pinnedGroup, ...letterGroups]
  })

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
