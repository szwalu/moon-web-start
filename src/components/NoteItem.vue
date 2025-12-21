<script setup lang="ts">
import { computed, h, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { NButton, NCard, NDropdown, NInput, NModal, useMessage } from 'naive-ui'
import ins from 'markdown-it-ins'
import { useDark } from '@vueuse/core'
import html2canvas from 'html2canvas'
import mark from 'markdown-it-mark'
import linkAttrs from 'markdown-it-link-attributes'
import { Calendar, Copy, Edit3, Heart, HeartOff, Pin, PinOff, Share, Trash2 } from 'lucide-vue-next'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting.ts'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  note: { type: Object, required: true },
  isExpanded: { type: Boolean, default: false },
  isSelectionModeActive: { type: Boolean, default: false },
  searchQuery: { type: String, default: '' },
  dropdownInPlace: { type: Boolean, default: false },
  showInternalCollapseButton: { type: Boolean, default: false },
})

// ✅ 1. 先定义 emit (通常放在 props 后面)
const emit = defineEmits([
  'edit',
  'toggleExpand',
  'copy',
  'pin',
  'delete',
  'set-date',
  'taskToggle',
  'dateUpdated',
  'favorite',
])

// ✅ 2. 紧接着定义 Hooks (t, messageHook 等)，必须在函数之前！
const { t } = useI18n()
const messageHook = useMessage()
const isDark = useDark()
const settingsStore = useSettingStore()

// 3. 定义状态
const showCommentModal = ref(false)
const commentText = ref('')
const isSubmittingComment = ref(false)

// 1. 定义字号映射对象 (与你 CSS 里的定义保持一致)
const fontSizeMap: Record<string, string> = {
  'small': '14px',
  'medium': '17px',
  'large': '20px',
  'extra-large': '22px',
}

// 2. 创建计算属性，获取当前应显示的字号
const commentInputStyle = computed(() => {
  const sizeKey = settingsStore.noteFontSize || 'medium'
  const px = fontSizeMap[sizeKey] || '17px'
  return {
    // 定义一个自定义变量，专门传给 CSS 用
    '--comment-fs': px,
  }
})

// 打开评论弹窗的辅助函数
function openCommentModal() {
  commentText.value = ''
  showCommentModal.value = true
}

// NoteItem.vue

async function handleAppendComment() {
  if (!commentText.value.trim())
    return

  // 1. 先把 ID 和旧内容存下来（防抖动/防丢失）
  const noteId = props.note.id
  const oldContent = props.note.content || ''

  if (!noteId) {
    messageHook.error(t('notes.operation_error') || '无法获取笔记ID')
    return
  }

  isSubmittingComment.value = true
  try {
    const now = new Date()
    const timeString = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

    const headerText = t('notes.comment.header')
    const commentBlock = `> 💬 ${headerText} ${timeString}\n> ${commentText.value.replace(/\n/g, '\n> ')}`
    const separator = '\n\n---\n\n'
    const newContent = oldContent + separator + commentBlock

    // 2. 数据库更新
    const { data, error } = await supabase
      .from('notes')
      .update({
        content: newContent,
        // 不更新 updated_at
      })
      .eq('id', noteId)
      .select()
      .single()

    if (error)
      throw error

    messageHook.success(t('notes.comment.success'))
    showCommentModal.value = false
    commentText.value = ''

    // ✅✅✅ 核心修复：构造必胜数据包 (Payload) ✅✅✅
    // 即使 data 为空 (Supabase 偶尔不返数据)，我们也手动拼装一个完整的对象
    // 关键：必须包含 id，否则父组件 updateNoteInList 会报错
    const payload = {
      ...props.note, // 继承原属性 (is_pinned, weather 等)
      ...(data || {}), // 如果 Supabase 返回了新数据，覆盖之
      id: noteId, // 🔥 强制写入 ID (父组件靠这个更新)
      content: newContent, // 🔥 强制写入新内容 (界面靠这个刷新)
    }

    // 3. 发射事件
    // 只要这里发出的 payload 有 id，父组件的 updateNoteInList 就绝对不会报错
    // 并且会顺带触发 notifyAnniversaryUpdate，实现那年今日的实时刷新
    emit('dateUpdated', payload)
  }
  catch (err: any) {
    console.error(err)
    const reason = err?.message || 'Unknown Error'
    messageHook.error(t('notes.comment.fail', { reason }))
  }
  finally {
    isSubmittingComment.value = false
  }
}
// 提取笔记内容中的第一张图片 URL
const firstImageUrl = computed(() => {
  const c = String(props.note?.content || '')
  // 只匹配 Markdown 图片
  const mdMatch = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/.exec(c)
  if (mdMatch && mdMatch[1])
    return mdMatch[1].trim()
  return null
})

const hasDraft = ref(false)

function checkDraftStatus() {
  if (!props.note?.id)
    return
  const key = `note_draft_${props.note.id}`
  const raw = localStorage.getItem(key)
  hasDraft.value = !!raw
}
function onDraftChanged(e: Event) {
  const customEvent = e as CustomEvent
  const targetId = customEvent.detail
  if (targetId === props.note.id || targetId === `note_draft_${props.note.id}`)
    checkDraftStatus()
}

const showDatePicker = ref(false)
const noteOverflowStatus = ref(false)
const contentRef = ref<Element | null>(null)
const fullContentRef = ref<Element | null>(null)

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})
  .use(taskLists, { enabled: true, label: true })
  .use(mark)
  .use(ins)
  .use(linkAttrs, {
    attrs: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  })

// 图片渲染规则
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy')
  tokens[idx].attrSet('decoding', 'async')
  const style = tokens[idx].attrGet('style')
  tokens[idx].attrSet('style', `${style ? `${style}; ` : ''}max-width:100%;height:auto;`)

  const imgHtml = self.renderToken(tokens, idx, options)
  const src = tokens[idx].attrGet('src') || ''
  const alt = tokens[idx].content || ''

  const prev = tokens[idx - 1]?.type
  const next = tokens[idx + 1]?.type
  const alreadyLinked = prev === 'link_open' && next === 'link_close'
  if (alreadyLinked)
    return imgHtml

  return `<a href="${src}" download target="_blank" rel="noopener noreferrer" title="${alt}">${imgHtml}</a>`
}

// 音频渲染规则
const isAudio = (url: string) => /\.(mp3|wav|m4a|ogg|aac|flac|webm)(\?|$)/i.test(url)

const defaultLinkOpen = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
const defaultLinkClose = md.renderer.rules.link_close || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (isAudio(href)) {
    env.inAudioLink = true
    return `<audio controls src="${href}" preload="metadata" onclick="event.stopPropagation()" style="display: block; width: 100%; max-width: 240px; height: 32px; margin: 6px auto; border-radius: 9999px; outline: none;"></audio><span style="display:none">`
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
  if (env.inAudioLink) {
    env.inAudioLink = false
    return '</span>'
  }
  return defaultLinkClose(tokens, idx, options, env, self)
}

const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

const isIOS = typeof navigator !== 'undefined'
  && typeof window !== 'undefined'
  && (
    /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  )

const showSeparateSaveShareButtons = !isIOS

const showShareCard = ref(false)
const shareImageUrl = ref<string | null>(null)
const sharePreviewVisible = ref(false)
const shareGenerating = ref(false)
const shareCardRef = ref<HTMLElement | null>(null)
const shareCanvasRef = ref<HTMLCanvasElement | null>(null)

function formatShareDate(dateStr: string) {
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekday = t(`notes.card.weekday_${d.getDay()}`)
  const daySuffix = t('notes.card.day_suffix')
  const dayLabel = `${day}${daySuffix || ''}`
  return t('notes.share_date_full', {
    year,
    month,
    day,
    dayLabel,
    weekday,
  })
}

function attachImgLoadListener(root: Element | null) {
  if (!root)
    return
  const imgs = Array.from(root.querySelectorAll('img'))
  if (!imgs.length)
    return
  imgs.forEach((img) => {
    const htmlImg = img as HTMLImageElement
    if (htmlImg.complete) {
      checkIfNoteOverflows()
    }
    else {
      htmlImg.addEventListener('load', checkIfNoteOverflows, { once: true })
      htmlImg.addEventListener('error', checkIfNoteOverflows, { once: true })
    }
  })
}

function formatDateWithWeekday(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const weekday = t(`notes.card.weekday_${d.getDay()}`)
  const daySuffix = t('notes.card.day_suffix')
  const dayLabel = `${day}${daySuffix || ''}`
  const tail = t('notes.card.date_format_no_day', { weekday, hh, mm })
  return `<span class="date-day">${dayLabel}</span> ${tail}`
}

const weatherDisplay = computed(() => {
  const w = String(props.note?.weather ?? '').trim()
  if (!w)
    return ''
  return w.replace(/[;；][^\s]*/, '')
})

function renderMarkdown(content: string) {
  if (!content)
    return ''
  let html = md.render(content)
  html = html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
  const query = props.searchQuery.trim()
  if (query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedQuery, 'gi')
    html = html.replace(regex, match => `<mark class="search-highlight">${match}</mark>`)
  }
  return html
}

function checkIfNoteOverflows() {
  const preview = contentRef.value as HTMLElement | null
  const full = fullContentRef.value as HTMLElement | null
  if (!preview || !preview.offsetParent)
    return

  if (!preview || !full) {
    noteOverflowStatus.value = false
    return
  }
  const clampHeight = preview.clientHeight
  const fullHeight = full.scrollHeight
  const diff = fullHeight - clampHeight
  noteOverflowStatus.value = diff > 1
}

function scheduleOverflowCheck() {
  nextTick(() => {
    requestAnimationFrame(() => {
      checkIfNoteOverflows()
      attachImgLoadListener(contentRef.value)
      attachImgLoadListener(fullContentRef.value)
    })
  })
}

let observer: ResizeObserver | null = null

onMounted(() => {
  observer = new ResizeObserver(() => {
    checkIfNoteOverflows()
  })
  if (contentRef.value) {
    observer.observe(contentRef.value)
    scheduleOverflowCheck()
  }
  if (fullContentRef.value)
    observer.observe(fullContentRef.value)
  checkDraftStatus()
  window.addEventListener('note-draft-changed', onDraftChanged)
})

onActivated(() => {
  checkDraftStatus()
})

watch(() => props.note, () => {
  checkDraftStatus()
}, { deep: true })

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  window.removeEventListener('note-draft-changed', onDraftChanged)
})

watch(contentRef, (el) => {
  if (el && observer) {
    observer.observe(el)
    scheduleOverflowCheck()
  }
})

watch(fullContentRef, (el) => {
  if (el && observer)
    observer.observe(el)
})

watch(() => props.note.content, () => {
  scheduleOverflowCheck()
})

watch(() => props.isExpanded, (val) => {
  if (!val)
    scheduleOverflowCheck()
})

function makeDropdownItem(iconComp: any, text: string, iconStyle: Record<string, any> = {}) {
  return () =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        },
      },
      [
        h(iconComp, { size: 16, style: iconStyle }),
        h('span', null, text),
      ],
    )
}

function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0
  const creationTime = new Date(note.created_at).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const updatedTime = new Date(note.updated_at).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return [
    {
      key: 'edit',
      label: makeDropdownItem(Edit3, t('notes.edit')),
    },
    { type: 'divider', key: 'd1' },
    {
      key: 'share',
      label: makeDropdownItem(Share, t('notes.share', '分享')),
    },
    { type: 'divider', key: 'd2' },
    {
      key: 'copy',
      label: makeDropdownItem(Copy, t('notes.copy')),
    },
    { type: 'divider', key: 'd3' },
    {
      key: 'pin',
      label: makeDropdownItem(
        note.is_pinned ? PinOff : Pin,
        note.is_pinned ? t('notes.unpin') : t('notes.pin'),
      ),
    },
    { type: 'divider', key: 'd4' },
    {
      key: 'favorite',
      label: makeDropdownItem(
        note.is_favorited ? HeartOff : Heart,
        note.is_favorited
          ? t('notes.unfavorite', '取消收藏')
          : t('notes.favorite', '收藏'),
        {
          color: note.is_favorited ? '#ef4444' : undefined,
        },
      ),
    },
    { type: 'divider', key: 'd5' },
    {
      key: 'set_date',
      label: makeDropdownItem(Calendar, t('notes.card.set_date')),
    },
    { type: 'divider', key: 'd6' },
    {
      key: 'delete',
      label: makeDropdownItem(Trash2, t('notes.delete'), { color: '#d03050' }),
    },
    { key: 'divider-info', type: 'divider' },
    {
      key: 'info-block',
      type: 'render',
      render: () => {
        const textColor = isDark.value ? '#aaa' : '#666'
        const pStyle = {
          margin: '0',
          padding: '0',
          lineHeight: '1.8',
          whiteSpace: 'nowrap',
          fontSize: '13px',
          color: textColor,
        } as const

        return h('div', { style: { padding: '4px 12px', cursor: 'default' } }, [
          h('p', { style: pStyle }, t('notes.word_count', { count: charCount })),
          h('p', { style: pStyle }, t('notes.created_at', { time: creationTime })),
          h('p', { style: pStyle }, t('notes.updated2_at', { time: updatedTime })),
        ])
      },
    },
  ]
}

function handleDropdownSelect(key: string) {
  switch (key) {
    case 'edit': {
      emit('edit', props.note)
      break
    }
    case 'share': {
      handleShare()
      break
    }
    case 'copy': {
      emit('copy', props.note.content)
      break
    }
    case 'pin': {
      emit('pin', props.note)
      break
    }
    case 'favorite': {
      emit('favorite', props.note)
      break
    }
    case 'set_date': {
      showDatePicker.value = true
      break
    }
    case 'delete': {
      emit('delete', props.note.id)
      break
    }
    default: {
      break
    }
  }
}

function handleNoteContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const link = target.closest('a')
  if (link) {
    localStorage.setItem('pwa_return_note_id', props.note.id)
    if (link.getAttribute('target') !== '_blank')
      link.setAttribute('target', '_blank')
    return
  }

  const listItem = target.closest('li.task-list-item')
  if (!listItem)
    return

  const isCheckboxClick = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox'
  if (isCheckboxClick) {
    event.stopPropagation()
    const noteCard = event.currentTarget as HTMLElement
    const allListItems = Array.from(noteCard.querySelectorAll('li.task-list-item'))
    const itemIndex = allListItems.indexOf(listItem)
    if (itemIndex !== -1)
      emit('taskToggle', { noteId: props.note.id, itemIndex })
  }
  else {
    event.preventDefault()
  }
}

async function convertSupabaseImagesToDataURL(container: HTMLElement) {
  const imgs = Array.from(container.querySelectorAll('img'))
  const promises = imgs.map(async (img) => {
    const src = img.getAttribute('src')
    if (!src)
      return
    if (src.startsWith('data:'))
      return

    try {
      const suffix = src.includes('?') ? '&' : '?'
      const fetchUrl = `${src}${suffix}t=${new Date().getTime()}`
      const response = await fetch(fetchUrl, {
        mode: 'cors',
        cache: 'no-cache',
      })
      if (!response.ok)
        throw new Error('Network response was not ok')
      const blob = await response.blob()
      const base64Url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      img.src = base64Url
      img.removeAttribute('crossorigin')
    }
    catch (err) {
      console.warn('图片转 Base64 失败，可能是跨域限制或链接失效:', src, err)
    }
  })
  await Promise.all(promises)
}

async function handleDateUpdate(newDate: Date) {
  showDatePicker.value = false
  if (!props.note || !props.note.id)
    return
  try {
    const newTimestamp = newDate.toISOString()
    const { data, error } = await supabase
      .from('notes')
      .update({ created_at: newTimestamp })
      .eq('id', props.note.id)
      .select()
      .single()

    if (error)
      throw error
    messageHook.success(t('notes.card.date_update_success'))
    emit('dateUpdated', data)
  }
  catch (err: any) {
    messageHook.error(t('notes.card.date_update_failed', { reason: err.message }))
  }
}

async function handleShare() {
  if (!props.note)
    return
  try {
    shareGenerating.value = true
    showShareCard.value = true
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const el = shareCardRef.value
    if (!el)
      throw new Error('share card element not found')
    await convertSupabaseImagesToDataURL(el as HTMLElement)
    await new Promise(resolve => setTimeout(resolve, 100))
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = await html2canvas(el, {
      backgroundColor: isDark.value ? '#020617' : '#f9fafb',
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
    })
    shareCanvasRef.value = canvas
    shareImageUrl.value = canvas.toDataURL('image/jpeg', 0.8)
    sharePreviewVisible.value = true
  }
  catch (err: any) {
    console.error(err)
    messageHook.error(t('notes.share_failed', '生成分享图片失败，请稍后重试'))
  }
  finally {
    shareGenerating.value = false
    showShareCard.value = false
  }
}

async function downloadShareImage() {
  if (!shareImageUrl.value)
    return
  const appName = t('notes.notes', '云笔记')
  const d = new Date(props.note.created_at)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  const fileName = `${appName}_${year}-${month}-${day}_${hour}${minute}.jpg`
  const link = document.createElement('a')
  link.href = shareImageUrl.value
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function systemShareImage() {
  if (!shareImageUrl.value)
    return
  const navAny = navigator as any
  if (!navAny.share) {
    messageHook.warning(t('notes.share_not_supported', '当前浏览器不支持系统分享，请先保存图片再手动分享'))
    return
  }
  try {
    const appName = t('notes.notes', '云笔记')
    const d = new Date(props.note.created_at)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')
    const fileName = `${appName}_${year}-${month}-${day}_${hour}${minute}.jpg`
    let blob: Blob
    if (shareCanvasRef.value) {
      blob = await new Promise<Blob>((resolve, reject) => {
        shareCanvasRef.value!.toBlob(
          (b) => {
            if (b)
              resolve(b)
            else reject(new Error('canvas toBlob failed'))
          },
          'image/jpeg',
          0.8,
        )
      })
    }
    else {
      const response = await fetch(shareImageUrl.value)
      blob = await response.blob()
    }
    const file = new File([blob], fileName, { type: 'image/jpeg' })
    const files = [file]
    const shareData: any = {
      title: t('notes.share_title', '分享笔记'),
      text: '',
    }
    if (!navAny.canShare || navAny.canShare({ files }))
      shareData.files = files
    else
      shareData.text = props.note?.content?.slice(0, 100) || ''
    await navAny.share(shareData)
  }
  catch (err) {
    console.warn('share cancelled or failed', err)
  }
}

function handleImageLoad() {
  checkIfNoteOverflows()
}
</script>

<template>
  <div class="note-item" @dblclick="emit('edit', note)" v-on="$attrs">
    <div
      :data-note-id="note.id"
      class="note-card"
      :class="{ 'is-expanded': isExpanded }"
      @click="handleNoteContentClick"
    >
      <div class="note-card-top-bar">
        <div class="note-meta-left">
          <span v-if="note.is_pinned" class="pinned-indicator">
            {{ t('notes.pin') }}
          </span>
          <p class="note-date" v-html="formatDateWithWeekday(note.created_at)" />
          <span v-if="weatherDisplay" class="weather-inline">
            · {{ weatherDisplay }}
          </span>
        </div>

        <div class="note-meta-right">
          <div
            v-if="hasDraft"
            class="draft-icon-wrapper"
            :title="t('notes.draft.resume_tooltip')"
            @click.stop="emit('edit', note)"
          >
            <Edit3 :size="14" stroke-width="2.5" />
          </div>

          <NDropdown
            trigger="click"
            placement="bottom-end"
            :options="getDropdownOptions(note)"
            :style="{ minWidth: '220px' }"
            :to="props.dropdownInPlace ? false : undefined"
            :z-index="props.dropdownInPlace ? 6001 : undefined"
            @select="handleDropdownSelect"
          >
            <div class="kebab-menu">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                <path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" />
              </svg>
            </div>
          </NDropdown>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <div v-if="isExpanded">
          <div
            class="note-content prose dark:prose-invert max-w-none"
            :class="fontSizeClass"
            v-html="renderMarkdown(note.content)"
          />

          <div class="comment-trigger-bar" @click.stop="openCommentModal">
            <div class="comment-trigger-input">
              {{ $t('notes.comment.trigger') }}
            </div>
          </div>

          <div
            v-if="showInternalCollapseButton"
            class="toggle-button-row"
            @click.stop="emit('toggleExpand', note.id)"
          >
            <button class="toggle-button">
              {{ $t('notes.collapse', '收起') }}
            </button>
          </div>
        </div>

        <div v-else>
          <div class="note-preview-wrapper">
            <div
              ref="contentRef"
              class="prose dark:prose-invert note-content note-preview-text line-clamp-3 max-w-none"
              :class="fontSizeClass"
              v-html="renderMarkdown(note.content)"
            />

            <div
              ref="fullContentRef"
              class="prose dark:prose-invert note-content note-content-measure max-w-none"
              :class="fontSizeClass"
              aria-hidden="true"
              v-html="renderMarkdown(note.content)"
            />

            <div v-if="firstImageUrl" class="preview-image-container">
              <img
                :src="firstImageUrl"
                class="preview-extracted-img"
                loading="lazy"
                alt="preview"
                @load="handleImageLoad"
                @click.stop="emit('toggleExpand', note.id)"
              >
            </div>
          </div>

          <div
            v-if="noteOverflowStatus || firstImageUrl"
            class="toggle-button-row"
            @click.stop="emit('toggleExpand', note.id)"
          >
            <button class="toggle-button">
              {{ $t('notes.expand') }}
            </button>
          </div>

          <div
            v-else
            class="comment-trigger-bar"
            @click.stop="openCommentModal"
          >
            <div class="comment-trigger-input">
              {{ $t('notes.comment.trigger') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showShareCard"
      ref="shareCardRef"
      class="share-card-root"
    >
      <div class="share-card">
        <div class="share-card-header">
          <p class="share-card-date">
            {{ formatShareDate(note.created_at) }}
          </p>
          <span v-if="weatherDisplay" class="share-card-weather">
            · {{ weatherDisplay }}
          </span>
        </div>

        <div
          class="prose dark:prose-invert share-card-content max-w-none"
          :class="fontSizeClass"
          v-html="renderMarkdown(note.content)"
        />

        <div class="share-card-footer">
          <div class="share-footer-left">
            <img src="/icons/pwa-192.png" class="share-footer-logo" alt="">
            <span class="share-app-name">
              {{ $t('notes.notes', '云笔记') }}
            </span>
          </div>

          <span class="share-meta">
            {{ t('notes.word_count', { count: note.content ? note.content.length : 0 }) }}
          </span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <DateTimePickerModal
        v-if="showDatePicker"
        :show="showDatePicker"
        :initial-date="new Date(note.created_at)"
        :style="{ zIndex: 6005 }"
        @close="showDatePicker = false"
        @confirm="handleDateUpdate"
      />
    </Teleport>

    <Teleport to="body">
      <div
        v-if="sharePreviewVisible"
        class="share-modal-backdrop"
        @click.self="sharePreviewVisible = false"
      >
        <div class="share-modal">
          <p class="share-modal-title">
            {{ $t('notes.share_title', '分享笔记') }}
          </p>

          <div class="share-modal-body">
            <img
              v-if="shareImageUrl"
              :src="shareImageUrl"
              alt="share preview"
              class="share-modal-image"
            >
            <div v-else class="share-modal-placeholder">
              {{ $t('notes.share_generating', '正在生成图片…') }}
            </div>
          </div>

          <div class="share-modal-actions">
            <template v-if="showSeparateSaveShareButtons">
              <button
                type="button"
                class="share-btn"
                @click="downloadShareImage"
              >
                {{ $t('notes.share_save_only', '保存') }}
              </button>
              <button
                type="button"
                class="share-btn"
                @click="systemShareImage"
              >
                {{ $t('notes.share_button', '分享') }}
              </button>
              <button
                type="button"
                class="share-btn share-btn-secondary"
                @click="sharePreviewVisible = false"
              >
                {{ $t('common.close', '关闭') }}
              </button>
            </template>

            <template v-else>
              <button
                type="button"
                class="share-btn"
                @click="systemShareImage"
              >
                {{ $t('notes.share_save', '保存/分享') }}
              </button>
              <button
                type="button"
                class="share-btn share-btn-secondary"
                @click="sharePreviewVisible = false"
              >
                {{ $t('common.close', '关闭') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <NModal v-model:show="showCommentModal">
      <NCard
        style="width: 90vw; max-width: 500px; transform: translateY(-15vh);"
        :title="$t('notes.comment.title')"
        :bordered="false"
        size="small"
        role="dialog"
        aria-modal="true"
      >
        <NInput
          v-model:value="commentText" class="comment-textarea"
          type="textarea"
          :placeholder="$t('notes.comment.placeholder')"
          :autosize="{ minRows: 3, maxRows: 6 }"
          autofocus
          :style="commentInputStyle"
        />
        <template #footer>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <NButton size="small" @click="showCommentModal = false">{{ $t('notes.comment.cancel') }}</NButton>
            <NButton
              type="primary"
              size="small"
              :loading="isSubmittingComment"
              :disabled="!commentText.trim()"
              @click="handleAppendComment"
            >
              {{ $t('notes.comment.submit') }}
            </NButton>
          </div>
        </template>
      </NCard>
    </NModal>
  </div>
</template>

<style scoped>
.note-card {
  position: relative;
  border-radius: 0.5rem;
  background-color: #ffffff;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  padding: 4rem;
  margin-bottom: 0.75rem;
}
.dark .note-card {
  background-color: #374151;
}

.note-card-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  height: 24px;
  /* ✅ 修改：禁止顶栏换行，确保左右结构稳固 */
  flex-wrap: nowrap;
}

.note-date {
  font-size: 14px;
  font-weight: 400; /* 整体常规字重 */
  color: #333;
  margin: 0;
  padding: 0;
  text-align: left;
  /* ✅ 修改：日期禁止换行，且禁止被压缩 */
  white-space: nowrap;
  flex-shrink: 0;
}
.dark .note-date {
  color: #f0f0f0;
}

/* v-html 注入的元素不带作用域，必须用 :deep 才能命中 */
:deep(.date-day) {
  font-weight: 700 !important; /* 仅“几日”加粗 */
  font-size: 16px !important;  /* ← 加这一行即可，原来是跟随 14px，现在稍大 */
}

.note-meta-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* ✅ 修改：允许左侧区域占据剩余空间并收缩，防止挤压右侧 */
  flex: 1;
  min-width: 0;
  margin-right: 8px; /* 给右边留点安全距离 */
}

.weather-inline {
  margin-left: 2px;
  /* ✅ 修改：天气部分超出显示省略号，且优先被压缩 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.pinned-indicator {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  background-color: transparent;
  padding: 2px 6px;
  line-height: 1;
}
.dark .pinned-indicator {
  color: #aaa;
  background-color: transparent;
}

.kebab-menu {
  cursor: pointer;
  padding: 2px;
  border-radius: 50%;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}
.kebab-menu:hover {
  background-color: rgba(0,0,0,0.1);
}
.dark .kebab-menu:hover {
  background-color: rgba(255,255,255,0.1);
}

.toggle-button-row {
  width: 100%;
  cursor: pointer;
  padding: 4px 0;
  margin-top: 4px;
}

.toggle-button {
  pointer-events: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  width: auto;
  display: block;
  text-align: left;
  color: #007bff !important;
  font-size: 14px;
  font-weight: normal;
  font-family: 'KaiTi','BiauKai','楷体','Apple LiSung',serif,sans-serif;
}
.dark .toggle-button {
  color: #38bdf8 !important;
}
.toggle-button:hover {
  text-decoration: underline;
}

/* 内容排版 */
/* 默认：桌面端 */
:deep(.prose) {
  font-size: 17px !important;
  line-height: 2.2; /* 桌面端更宽松 */
  overflow-wrap: break-word;
}

/* 移动端（屏幕宽度 <= 768px 时） */
@media (max-width: 768px) {
  :deep(.prose) {
    line-height: 1.8; /* 移动端稍紧凑 */
    overflow-wrap: break-word;
  }
}
.line-clamp-3 {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

/* 自定义 tag */
:deep(.custom-tag) {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.875em;
  font-weight: 500;
  margin: 0 2px;
}
.dark :deep(.custom-tag) {
  background-color: #312e81;
  color: #c7d2fe;
}

:deep(.prose > :first-child) {
  margin-top: 0 !important;
}
:deep(.prose > :last-child) {
  margin-bottom: 0 !important;
}

:deep(.prose.font-size-small) {
  font-size: 14px !important;
}
:deep(.prose.font-size-medium) {
  font-size: 17px !important;
}
:deep(.prose.font-size-large) {
  font-size: 20px !important;
}
:deep(.prose.font-size-extra-large) {
  font-size: 22px !important;
}

:deep(table) {
  width: auto;
  border-collapse: collapse;
  margin-top: 1em;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  display: table !important;
}
.dark :deep(table) {
  border-color: #4b5563;
}
:deep(th), :deep(td) {
  padding: 8px 15px;
  border: 1px solid #dfe2e5;
}
.dark :deep(th), .dark :deep(td) {
  border-color: #4b5563;
}
:deep(th) {
  font-weight: 600;
  background-color: #f6f8fa;
}
.dark :deep(th) {
  background-color: #374151;
}

.collapse-button {
  background-color: white;
  padding: 4px 12px;
  border-radius: 9999px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}
.dark .collapse-button {
  background-color: #374151;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}

:deep(.n-dropdown-divider) {
  margin: 2px 0 !important;
}

:deep(.search-highlight) {
  background-color: #ffdd77;
  color: #333;
  padding: 0 2px;
  border-radius: 3px;
}
.dark :deep(.search-highlight) {
  background-color: #8f7400;
  color: #f0e6c5;
}

:deep(ins) {
  text-decoration: underline;
  text-underline-offset: 2px; /* 可选：下划线与文字距离 */
}
/* 让 Tailwind Typography 的链接色变量变成你要的蓝色 */
.note-content {
  /* 亮色模式链接色 */
  --tw-prose-links: #2563eb;
}
.dark .note-content {
  /* 暗色模式链接色（Typography 的反相变量） */
  --tw-prose-invert-links: #60a5fa;
}

/* 直接命中渲染出来的 <a>（v-html 的内容需用 :deep 才能选中） */
.note-content :deep(a),
.note-content :deep(a:visited) {
  color: #2563eb !important;
  text-decoration: underline !important;
}
.note-content :deep(a:hover) {
  color: #1d4ed8 !important;
}
/* 暗色模式下更亮一些 */
.dark .note-content :deep(a),
.dark .note-content :deep(a:visited) {
  color: #60a5fa !important;
}

/* 1) 统一把列表上下的外边距收紧（不影响段落自身行高） */
.note-content :deep(ul),
.note-content :deep(ol) {
  margin-top: 0.35em;
  margin-bottom: 0.35em;
  padding-left: 1.2em;
}

/* 2) 普通段落的上下外边距略收紧（避免整体过稀） */
.note-content :deep(p) {
  margin-top: 0.85em;
  margin-bottom: 0.85em;
}

.note-content :deep(p + p) { margin-top: 1.1em; }

/* 3) 关键：当“段落后面紧跟列表”时，把两者之间的间距进一步压小
   - 现代浏览器（含新 iOS Safari）支持 :has，精准只影响相邻场景 */
@supports(selector(:has(+ *))) {
  .note-content :deep(p:has(+ ul)),
  .note-content :deep(p:has(+ ol)),
  .note-content :deep(p:has(+ ul.task-list)) {
    margin-bottom: 0.15em; /* ← 决定红框这块的高度 */
  }
}

/* 4) 任务列表的复选框细节（防止复选框把行拉高） */
.note-content :deep(li.task-list-item) {
  line-height: inherit;
  margin: 0;
  padding: 0;
}
.note-content :deep(li.task-list-item > label) {
  display: inline;
  margin: 0;
  line-height: inherit;
}
.note-content :deep(li.task-list-item input[type="checkbox"]) {
  vertical-align: middle;
  margin: 0 0.45em 0 0;
  line-height: 1;
  transform: translateY(-0.5px);
}

/* 5) 有些渲染器会在 li 里包 <p>，把它变成内联，避免额外间距 */
.note-content :deep(li > p) {
  display: inline;
  margin: 0;
  line-height: inherit;
}

/* 自适应：图片不再按原始像素撑出容器，等比缩放到 100% 宽 */
.note-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;    /* 防止拉伸 */
  border-radius: 6px;     /* 可选：圆角 */
  margin: 6px 0;          /* 可选：上下留白 */
}

/* （可选）在收起预览时限制一下超高图片的高度，避免占满卡片 */
.line-clamp-3.note-content :deep(img) {
  max-height: 40vh;
}

.img-flag {
  margin-left: 0.3rem;
  opacity: 0.7;
  font-size: 0.9em;
  vertical-align: text-bottom;
}
.dark .img-flag {
  opacity: 0.8;
}

/* ===== 分享卡片（离屏渲染用） ===== */
.share-card-root {
  position: fixed;
  top: -9999px;
  left: -9999px;
  /* 1. 修改宽度：稍微加大一点，容纳内边距 */
  width: 380px;
  /* 2. 新增内边距：这样生成的图片周围会有一圈背景，让卡片的边框和阴影完全显示出来，不会贴边 */
  padding: 20px;
  box-sizing: border-box;
  pointer-events: none;
  z-index: -1;
}

.share-card {
  position: relative;
  border-radius: 16px;

  /* 卡片背景 */
  background: linear-gradient(135deg, #f9fafb, #e5edff);
  padding: 12px 14px 10px;

  /* 3. 加深阴影：让卡片更有立体感，与背景区分开 */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.03);

  font-family: system-ui, -apple-system, BlinkMacSystemFont,
                 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;

  /* ================================ */
  /* 🌟 修改这里：加粗边框并提高不透明度 */
  /* ================================ */
  /* 原来是 1px solid rgba(99, 102, 241, 0.18) 太淡了 */
  border: 2px solid #6366f1; /* 使用明显的品牌色（靛蓝），且是实线 */

  /* 如果想要“深色硬边框”风格，可以用下面这句代替上面那句： */
  /* border: 2px solid #333; */

  backdrop-filter: blur(4px);
}

.dark .share-card {
  background: linear-gradient(135deg, #020617, #020b3a);
  color: #e5e7eb;

  /* 深色模式下也加粗 */
  border: 2px solid #818cf8;
  /* 深色模式下的阴影 */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

/* 顶部品牌渐变色条（你之前指定的品牌特征） */
.share-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;

  background: linear-gradient(90deg, #6366f1, #a78bfa);
}

.dark .share-card::before {
  background: linear-gradient(90deg, #818cf8, #c4b5fd);
}

.share-card-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}

.share-card-year {
  margin-right: 4px;
}

.share-card-date {
  margin: 0;
  font-size: 14px;
}

.share-card-weather {
  font-size: 13px;
  opacity: 0.8;
}

.share-card-content {
  max-height: none;
  overflow: visible;
  margin-bottom: 12px;
}

.share-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #6b7280;
}

.dark .share-card-footer {
  color: #9ca3af;
}

/* 左侧：Logo + 名称 */
.share-footer-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.share-footer-logo {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  transform: translateY(7px); /* ← 新增，下移对齐 */
}

.share-app-name {
  font-weight: 600;
}

.share-meta {
  white-space: nowrap;
}

/* ===== 分享预览弹层 ===== */
.share-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 7000;
}

.share-modal {
  background: #ffffff;
  border-radius: 16px;
  padding: 16px 16px 12px;
  max-width: 420px;
  width: 90vw;
  box-shadow: 0 10px 40px rgba(0,0,0,0.35);
}

.dark .share-modal {
  background: #111827;
  color: #e5e7eb;
}

.share-modal-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.share-modal-body {
  max-height: 60vh;
  overflow: auto;
  border-radius: 12px;
  background: #f3f4f6;
  padding: 6px;
  margin-bottom: 10px;
}

.dark .share-modal-body {
  background: #020617;
}

.share-modal-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
}

.share-modal-placeholder {
  width: 100%;
  text-align: center;
  padding: 40px 0;
  font-size: 14px;
  color: #6b7280;
}

.dark .share-modal-placeholder {
  color: #9ca3af;
}

.share-modal-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.share-btn {
  flex: 1;
  border: none;
  border-radius: 9999px;
  padding: 8px 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: #6366f1;
  color: #ffffff;
}

.share-btn:hover {
  filter: brightness(1.05);
}

.share-btn-secondary {
  background: #e5e7eb;
  color: #111827;
}

.dark .share-btn-secondary {
  background: #374151;
  color: #e5e7eb;
}

.share-hint {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}

.dark .share-hint {
  color: #9ca3af;
}

.share-card-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  margin: 6px 0;
}

.note-preview-wrapper {
  position: relative;
}

/* 隐藏的完整内容，只用于测量高度，不参与布局 */
.note-content-measure {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  visibility: hidden;
  pointer-events: none;
  max-height: none;
  overflow: visible;

  /* 确保不受 line-clamp 影响 */
  display: block;
  -webkit-line-clamp: initial;
  -webkit-box-orient: initial;
}

/* ... 之前的 CSS ... */

/* ✅ 隐藏预览文字流里原本的图片 */
.note-preview-text :deep(img) {
  display: none !important;
}

/* ✅ 图片容器 */
.preview-image-container {
  margin-top: 12px;
  width: 100%;
}

/* ✅ 修改这里：图片样式 */
.preview-extracted-img {
  display: block;

  /* 🌟 核心修改：宽度设为 50%，实现缩小效果 */
  width: 50%;

  /* 🌟 核心修改：高度自动，确保图片按原比例显示，不裁剪 */
  height: auto;

  border-radius: 6px;
  border: 1px solid rgba(0,0,0,0.05);

  /* 鼠标放上去显示手型，提示可点击 */
  cursor: pointer;

  /* 可选：如果你希望图片居中显示，解开下面这行；如果不解开则默认靠左 */
  /* margin: 0 auto; */
}

.dark .preview-extracted-img {
  border-color: rgba(255,255,255,0.1);
}

/* NoteItem.vue 的 <style scoped> 中 */

.note-meta-right {
  display: flex;
  align-items: center;
  gap: 6px; /* 图标和菜单之间的间距，稍微收紧一点 */
  /* ✅ 修改：禁止右侧图标区收缩，必须完整显示 */
  flex-shrink: 0;
}

/* ✅ 新增：草稿铅笔图标样式 */

/* ✅ 新增：包裹层样式 */
.draft-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;

  /* 定义一个稍大的点击区域，比如 24x24，虽然图标只有15，但这样更容易点中 */
  width: 24px;
  height: 24px;

  color: #f97316; /* 橘色 */
  cursor: pointer; /* 手型鼠标 */
  border-radius: 4px; /* 鼠标按下时有点背景反馈的话，圆角好看 */

  /* 初始状态 */
  opacity: 0.9;
  transition: all 0.2s ease;
}

/* 鼠标悬停在包裹层上时 */
.draft-icon-wrapper:hover {
  transform: scale(1.15); /* 微微放大 */
  opacity: 1;
  background-color: rgba(249, 115, 22, 0.1); /* 可选：加一点非常淡的橘色背景，强调“可点击” */
}

/* 深色模式适配 */
.dark .draft-icon-wrapper {
  color: #fb923c;
}
.dark .draft-icon-wrapper:hover {
  background-color: rgba(251, 146, 60, 0.15);
}

/* ✅ 新增：分割线样式 */
.note-content :deep(hr) {
  margin: 0.5em 0;
  border: none;
  border-top: 1px dashed #d1d5db; /* 虚线分割，比实线更柔和 */
}
.dark .note-content :deep(hr) {
  border-top-color: #4b5563;
}

/* ✅ 新增：引用块样式（用于评论） */
/* Markdown 的 > 内容会被渲染为 blockquote */
.note-content :deep(blockquote) {
  font-size: 0.85em;      /* 字体缩小 */
  color: #666;            /* 颜色变淡 */
  background-color: #f9fafb; /*以此区分正文，可选 */
  border-left: 3px solid #e5e7eb; /* 左侧竖线 */
  margin: 0.5em 0;
  padding: 0.5em 1em;
  border-radius: 0 4px 4px 0;
}

.dark .note-content :deep(blockquote) {
  color: #9ca3af;
  background-color: rgba(255,255,255,0.03);
  border-left-color: #4b5563;
}

/* 确保引用里的段落没有过大的间距 */
.note-content :deep(blockquote p) {
  margin-top: 0.1em !important;
  margin-bottom: 0.1em !important;
  line-height: 1.5; /* 行高也可以稍微改小一点 */
}

/* ✅ 底部评论触发按钮样式 */
.comment-trigger-bar {
  /* ✅ 修改：减少 margin-top */
  margin-top: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.comment-trigger-input {
  background-color: #f3f4f6; /* 浅灰背景 */
  color: #9ca3af; /* 占位符文字颜色 */
  /* ✅ 修改：减少 padding 高度 */
  padding: 4px 12px;
  border-radius: 9999px; /* 全圆角 */
  font-size: 13px;
  transition: background-color 0.2s;
}

.comment-trigger-bar:hover .comment-trigger-input {
  background-color: #e5e7eb; /* 悬停稍微变深 */
}

.dark .comment-trigger-input {
  background-color: #374151; /* 深色模式背景 */
  color: #9ca3af;
}

.dark .comment-trigger-bar:hover .comment-trigger-input {
  background-color: #4b5563;
}

/* 🟢 新增：强力覆盖评论框字号 */
:deep(.comment-textarea .n-input__textarea-el) {
  /* 使用我们刚才定义的 CSS 变量，并加 !important 覆盖全局 UI 设置 */
  font-size: var(--comment-fs) !important;
  /* 可选：行高也配合调整一下，读起来更舒服 */
  line-height: 1.6 !important;
}

/* 可选：如果你希望占位符文字也跟着变大，加这一段 */
:deep(.comment-textarea .n-input__textarea-el::placeholder) {
   font-size: var(--comment-fs) !important;
}
</style>

<style>
/* 1. 强制压缩每一行的高度 */
.n-dropdown-menu .n-dropdown-option-body {
  height: 35px !important;       /* 强制每行高度为 28px */
  min-height: 35px !important;   /* 覆盖默认的最小高度 */
  padding: 0 10px !important;    /* 左右内边距 */
  display: flex !important;
  align-items: center !important;
  font-size: 14px !important;    /*稍微改小一点字体让它看起来精致 */
}

/* 2. 修正图标和文字的垂直对齐 */
.n-dropdown-menu .n-dropdown-option-body > div {
  display: flex;
  align-items: center;
  height: 100%; /* 占满高度 */
}

/* 3. 极简分割线 */
.n-dropdown-menu .n-dropdown-divider {
  margin: 0 !important;
  padding: 0 !important;
  height: 1px !important;
  background-color: rgba(0, 0, 0, 0.08) !important;
}

/* 4. 收紧整个菜单容器的上下留白 */
.n-dropdown-menu {
  padding: 4px 0 !important;
}

.vc-title,
.vc-title-wrapper,
.vc-arrow {
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
</style>
