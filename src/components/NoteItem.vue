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
  isSameDay: { type: Boolean, default: false },
})

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

const { t } = useI18n()
const messageHook = useMessage()
const isDark = useDark()
const settingsStore = useSettingStore()

const showCommentModal = ref(false)
const commentText = ref('')
const isSubmittingComment = ref(false)

const fontSizeNumMap: Record<string, number> = {
  'small': 14,
  'medium': 17,
  'large': 20,
  'extra-large': 22,
}

const previewStyle = computed(() => {
  const sizeKey = settingsStore.noteFontSize || 'medium'
  const fs = fontSizeNumMap[sizeKey] || 17
  const lh = Math.round(fs * 1.5)

  // 1. 定义文字高度 (3行)
  const textHeight = lh * 3

  // 2. 定义图片高度 (2.6 倍行高)
  const imgSize = lh * 2.6

  // 3. 计算卡片总高度 (由较高的文字区域撑开 + 顶部栏 24px + 缓冲)
  const totalHeight = 24 + textHeight + 2

  return {
    '--pv-fs': `${fs}px`,
    '--pv-lh': `${lh}px`,
    '--pv-height': `${totalHeight}px`,
    '--pv-text-height': `${textHeight}px`,
    '--img-size': `${imgSize}px`,
  }
})

const commentInputStyle = computed(() => {
  const sizeKey = settingsStore.noteFontSize || 'medium'
  const px = fontSizeNumMap[sizeKey] ? `${fontSizeNumMap[sizeKey]}px` : '17px'
  return { '--comment-fs': px }
})

function openCommentModal() {
  commentText.value = ''
  showCommentModal.value = true
}

async function handleAppendComment() {
  if (!commentText.value.trim())
    return

  const noteId = props.note.id
  const oldContent = props.note.content || ''
  if (!noteId) {
    messageHook.error(t('notes.operation_error') || '无法获取笔记ID')
    return
  }
  const now = new Date()
  const timeString = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const headerText = t('notes.comment.header')
  const commentBlock = `> ${headerText} ${timeString}\n> ${commentText.value.replace(/\n/g, '\n> ')}`
  const separator = '\n\n---\n\n'
  const newContent = oldContent + separator + commentBlock
  const MAX_LENGTH = 20000
  if (newContent.length > MAX_LENGTH) {
    messageHook.error(t('notes.max_length_exceeded', { max: MAX_LENGTH }))
    return
  }
  isSubmittingComment.value = true
  try {
    const { data, error } = await supabase
      .from('notes')
      .update({ content: newContent })
      .eq('id', noteId)
      .select()
      .single()

    if (error)
      throw error

    messageHook.success(t('notes.comment.success'))
    showCommentModal.value = false
    commentText.value = ''
    emit('dateUpdated', { ...props.note, ...(data || {}), id: noteId, content: newContent })
  }
  catch (err: any) {
    console.error(err)
    messageHook.error(t('notes.comment.fail', { reason: err?.message || 'Unknown Error' }))
  }
  finally {
    isSubmittingComment.value = false
  }
}

const firstImageUrl = computed(() => {
  const c = String(props.note?.content || '')
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
  hasDraft.value = !!localStorage.getItem(key)
}
function onDraftChanged(e: Event) {
  const customEvent = e as CustomEvent
  const targetId = customEvent.detail
  if (targetId === props.note.id || targetId === `note_draft_${props.note.id}`)
    checkDraftStatus()
}

const showDatePicker = ref(false)
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
  .use(taskLists, { enabled: true, label: true })
  .use(mark)
  .use(ins)
  .use(linkAttrs, { attrs: { target: '_blank', rel: 'noopener noreferrer' } })

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
  if (prev === 'link_open' && next === 'link_close')
    return imgHtml

  return `<a href="${src}" download target="_blank" rel="noopener noreferrer" title="${alt}">${imgHtml}</a>`
}

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

const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize || 'medium'}`)

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
  return t('notes.share_date_full', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    dayLabel: `${d.getDate()}${t('notes.card.day_suffix') || ''}`,
    weekday: t(`notes.card.weekday_${d.getDay()}`),
  })
}
function formatDateWithWeekday(dateStr: string) {
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `<span class="date-day">${d.getDate()}${t('notes.card.day_suffix') || ''}</span> ${t('notes.card.date_format_no_day', { weekday: t(`notes.card.weekday_${d.getDay()}`), hh, mm })}`
}
const weatherDisplay = computed(() => {
  const w = String(props.note?.weather ?? '').trim()
  return w ? w.replace(/[;；][^\s]*/, '') : ''
})
function renderMarkdown(content: string) {
  if (!content)
    return ''

  let html = md.render(content)
  html = html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
  const query = props.searchQuery.trim()
  if (query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    html = html.replace(new RegExp(escapedQuery, 'gi'), match => `<mark class="search-highlight">${match}</mark>`)
  }
  return html
}

onMounted(() => {
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
  window.removeEventListener('note-draft-changed', onDraftChanged)
})

function makeDropdownItem(iconComp: any, text: string, iconStyle: Record<string, any> = {}) {
  return () => h('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      flex: '1',
      height: '34px',
    },
  }, [
    h('span', null, text),
    h(iconComp, { size: 18, style: { ...iconStyle } }),
  ])
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
    { key: 'edit', label: makeDropdownItem(Edit3, t('notes.edit')) },
    { type: 'divider', key: 'd1' },
    { key: 'share', label: makeDropdownItem(Share, t('notes.share', '分享')) },
    { type: 'divider', key: 'd2' },
    { key: 'copy', label: makeDropdownItem(Copy, t('notes.copy')) },
    { type: 'divider', key: 'd3' },
    { key: 'pin', label: makeDropdownItem(note.is_pinned ? PinOff : Pin, note.is_pinned ? t('notes.unpin') : t('notes.pin')) },
    { type: 'divider', key: 'd4' },
    { key: 'favorite', label: makeDropdownItem(note.is_favorited ? HeartOff : Heart, note.is_favorited ? t('notes.unfavorite', '取消收藏') : t('notes.favorite', '收藏'), { color: note.is_favorited ? '#ef4444' : undefined }) },
    { type: 'divider', key: 'd5' },
    { key: 'set_date', label: makeDropdownItem(Calendar, t('notes.card.set_date')) },
    { type: 'divider', key: 'd6' },
    { key: 'delete', label: makeDropdownItem(Trash2, t('notes.delete'), { color: '#d03050' }) },
    { key: 'divider-info', type: 'divider' },
    {
      key: 'info-block',
      type: 'render',
      render: () => {
        const textColor = isDark.value ? '#aaa' : '#666'
        const pStyle = { margin: '0', padding: '0', lineHeight: '1.8', whiteSpace: 'nowrap', fontSize: '13px', color: textColor } as const
        return h('div', { style: { padding: '6px 12px', cursor: 'default' } }, [
          h('p', { style: pStyle }, t('notes.word_count', { count: charCount })),
          h('p', { style: pStyle }, t('notes.created_at', { time: creationTime })),
          h('p', { style: pStyle }, t('notes.updated2_at', { time: updatedTime })),
        ])
      },
    },
  ]
}

function handleDropdownSelect(key: string) {
  const map: any = {
    edit: () => emit('edit', props.note),
    share: handleShare,
    copy: () => emit('copy', props.note.content),
    pin: () => emit('pin', props.note),
    favorite: () => emit('favorite', props.note),
    set_date: () => (showDatePicker.value = true),
    delete: () => emit('delete', props.note.id),
  }
  if (map[key])
    map[key]()
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
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:'))
      return

    try {
      const res = await fetch(`${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, { mode: 'cors', cache: 'no-cache' })
      if (!res.ok)
        throw new Error('Network error')

      const blob = await res.blob()
      const base64 = await new Promise<string>((r, j) => {
        const reader = new FileReader()
        reader.onloadend = () => r(reader.result as string)
        reader.onerror = j
        reader.readAsDataURL(blob)
      })
      img.src = base64
      img.removeAttribute('crossorigin')
    }
    catch (e) {
      console.warn('Img convert fail', src, e)
    }
  }))
}

async function handleDateUpdate(newDate: Date) {
  showDatePicker.value = false
  if (!props.note?.id)
    return

  try {
    const { data, error } = await supabase.from('notes').update({ created_at: newDate.toISOString() }).eq('id', props.note.id).select().single()
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
    await new Promise(r => requestAnimationFrame(r))
    const el = shareCardRef.value
    if (!el)
      throw new Error('no el')

    await convertSupabaseImagesToDataURL(el)
    await new Promise(r => setTimeout(r, 100))
    const cvs = await html2canvas(el, {
      backgroundColor: isDark.value ? '#020617' : '#f9fafb',
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      allowTaint: true,
      logging: false,
    })
    shareCanvasRef.value = cvs
    shareImageUrl.value = cvs.toDataURL('image/jpeg', 0.8)
    sharePreviewVisible.value = true
  }
  catch (e: any) {
    messageHook.error(t('notes.share_failed'))
  }
  finally {
    shareGenerating.value = false
    showShareCard.value = false
  }
}

async function downloadShareImage() {
  if (!shareImageUrl.value)
    return

  const a = document.createElement('a')
  a.href = shareImageUrl.value
  a.download = `Note_${Date.now()}.jpg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function systemShareImage() {
  if (!shareImageUrl.value)
    return

  const nav = navigator as any
  if (!nav.share) {
    messageHook.warning(t('notes.share_not_supported'))
    return
  }
  try {
    const d = new Date(props.note.created_at)
    const fname = `Note_${d.getTime()}.jpg`
    let blob: Blob
    if (shareCanvasRef.value)
      blob = await new Promise((r, j) => shareCanvasRef.value!.toBlob(b => b ? r(b) : j(new Error('blob fail')), 'image/jpeg', 0.8))

    else
      blob = await (await fetch(shareImageUrl.value)).blob()

    const file = new File([blob], fname, { type: 'image/jpeg' })
    const data = { title: t('notes.share_title'), files: [file] }
    if (nav.canShare && nav.canShare(data))
      await nav.share(data)
  }
  catch (e) {
    console.warn('share fail', e)
  }
}

function getDayNumber(dateStr: string) {
  return new Date(dateStr).getDate()
}
function getWeekday(dateStr: string) {
  return new Date(dateStr).toLocaleString('zh-CN', { weekday: 'short' })
}
function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
</script>

<template>
  <div class="note-item" @dblclick="emit('edit', note)" v-on="$attrs">
    <div :data-note-id="note.id" class="note-card" :class="{ 'is-expanded': isExpanded }" @click="handleNoteContentClick">
      <div v-if="isExpanded" class="note-card-top-bar">
        <div class="note-meta-left">
          <span v-if="note.is_pinned" class="pinned-indicator">{{ t('notes.pin') }}</span>
          <p class="note-date" v-html="formatDateWithWeekday(note.created_at)" />
          <span v-if="weatherDisplay" class="weather-inline">· {{ weatherDisplay }}</span>
        </div>
        <div class="note-meta-right">
          <div v-if="hasDraft" class="draft-icon-wrapper" @click.stop="emit('edit', note)">
            <Edit3 :size="14" />
          </div>
          <NDropdown trigger="click" placement="bottom-end" :options="getDropdownOptions(note)" :style="{ minWidth: '220px' }" @select="handleDropdownSelect">
            <div class="kebab-menu">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" />
              </svg>
            </div>
          </NDropdown>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <div v-if="isExpanded">
          <div class="note-content prose dark:prose-invert max-w-none" :class="fontSizeClass" v-html="renderMarkdown(note.content)" />
          <div class="comment-trigger-bar" @click.stop="openCommentModal">
            <div class="comment-trigger-input">
              {{ $t('notes.comment.trigger') }}
            </div>
          </div>
          <div v-if="showInternalCollapseButton" class="toggle-button-row" @click.stop="emit('toggleExpand', note.id)">
            <button class="toggle-button">
              {{ $t('notes.collapse', '收起') }}
            </button>
          </div>
        </div>

        <div v-else>
          <div class="note-preview-card" :style="previewStyle" @click.stop="emit('toggleExpand', note.id)">
            <div class="note-preview-date" :class="{ 'dimmed-date': isSameDay }">
              <span class="date-day">{{ getDayNumber(note.created_at) }}</span>
              <span class="date-weekday">{{ getWeekday(note.created_at) }}</span>
            </div>

            <div class="note-preview-left">
              <div class="note-preview-inner-header" @click.stop>
                <div class="preview-meta-info">
                  <span v-if="note.is_pinned" class="pinned-indicator-preview">{{ t('notes.pin') }}</span>
                  <span class="time-text">{{ formatTime(note.created_at) }}</span>
                  <span v-if="weatherDisplay" class="weather-text">· {{ weatherDisplay }}</span>
                </div>

                <div class="preview-meta-menu">
                  <div v-if="hasDraft" class="draft-icon-wrapper-small" @click.stop="emit('edit', note)">
                    <Edit3 :size="12" />
                  </div>
                  <NDropdown trigger="click" placement="bottom-end" :options="getDropdownOptions(note)" :style="{ minWidth: '220px' }" @select="handleDropdownSelect">
                    <div class="kebab-menu-small">
                      <svg width="20" height="20" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" />
                      </svg>
                    </div>
                  </NDropdown>
                </div>
              </div>

              <div class="note-preview-body-row">
                <div class="prose dark:prose-invert note-content compact-mode" v-html="renderMarkdown(note.content)" />

                <div v-if="firstImageUrl" class="note-preview-image-box" @click.stop>
                  <img :src="firstImageUrl" class="thumb-img" loading="lazy" alt="preview">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showShareCard" ref="shareCardRef" class="share-card-root">
      <div class="share-card">
        <div class="share-card-header">
          <p class="share-card-date">
            {{ formatShareDate(note.created_at) }}
          </p>
        </div>
        <div class="prose dark:prose-invert share-card-content max-w-none" :class="fontSizeClass" v-html="renderMarkdown(note.content)" />
        <div class="share-card-footer">
          <span class="share-app-name">Notes</span>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <DateTimePickerModal v-if="showDatePicker" :show="showDatePicker" :initial-date="new Date(note.created_at)" :style="{ zIndex: 6005 }" @close="showDatePicker = false" @confirm="handleDateUpdate" />
    </Teleport>
    <Teleport to="body">
      <div v-if="sharePreviewVisible" class="share-modal-backdrop" @click.self="sharePreviewVisible = false">
        <div class="share-modal">
          <img v-if="shareImageUrl" :src="shareImageUrl" class="share-modal-image">
          <div class="share-modal-actions">
            <template v-if="showSeparateSaveShareButtons">
              <button type="button" class="share-btn" @click="downloadShareImage">
                {{ $t('notes.share_save_only', '保存') }}
              </button>
              <button type="button" class="share-btn" @click="systemShareImage">
                {{ $t('notes.share_button', '分享') }}
              </button>
              <button type="button" class="share-btn share-btn-secondary" @click="sharePreviewVisible = false">
                {{ $t('common.close', '关闭') }}
              </button>
            </template>
            <template v-else>
              <button type="button" class="share-btn" @click="systemShareImage">
                {{ $t('notes.share_save', '保存/分享') }}
              </button>
              <button type="button" class="share-btn share-btn-secondary" @click="sharePreviewVisible = false">
                {{ $t('common.close', '关闭') }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
    <NModal v-model:show="showCommentModal">
      <NCard :title="$t('notes.comment.title')" size="small">
        <NInput v-model:value="commentText" type="textarea" autofocus :style="commentInputStyle" />
        <template #footer>
          <NButton size="small" @click="showCommentModal = false">
            {{ $t('notes.comment.cancel') }}
          </NButton>
          <NButton type="primary" size="small" :loading="isSubmittingComment" @click="handleAppendComment">
            {{ $t('notes.comment.submit') }}
          </NButton>
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
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.dark .note-card {
  background-color: #374151;
}

/* 展开状态的顶部栏 */
.note-card-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  height: 24px;
}

.note-meta-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}

.note-meta-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.note-date {
  font-size: 14px;
  color: #333;
  margin: 0;
  white-space: nowrap;
}

.dark .note-date {
  color: #f0f0f0;
}

.weather-inline {
  margin-left: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}

.pinned-indicator {
  font-size: 13px;
  font-weight: 600;
  color: #888;
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
}

.kebab-menu:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

/* Day One 预览模式布局 (V2: 图片下沉版) */
.note-preview-card {
  display: flex;
  gap: 10px;
  /* 总高度固定 */
  height: var(--pv-height);
  align-items: stretch;
  cursor: pointer;
  overflow: hidden;
}

/* 左侧日期 */
.note-preview-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
  height: 100%;
  padding-right: 6px;
  margin-right: -2px;
}

.dark .note-preview-date {
  border-right-color: rgba(255, 255, 255, 0.1);
}

/* ✅ 新增：弱化后的日期样式 */
.dimmed-date .date-day {
  color: #d1d5db; /* 浅灰色 (Tailwind gray-300) */
  font-weight: 600; /*稍微降低字重，可选*/
}

.dimmed-date .date-weekday {
  color: #e5e7eb; /* 更浅的灰色 (Tailwind gray-200) */
}

/* 深色模式适配 */
.dark .dimmed-date .date-day {
  color: #4b5563; /* 深色模式下的暗灰 */
}
.dark .dimmed-date .date-weekday {
  color: #374151;
}

.date-day {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
  color: #333;
}

.dark .date-day {
  color: #e5e7eb;
}

.date-weekday {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}

/* 右侧主容器：垂直排列 */
.note-preview-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

/* 顶部行：元数据 + 菜单 */
.note-preview-inner-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  /* 固定头部高度 */
  flex-shrink: 0;
  width: 100%;
  flex-wrap: nowrap;
}

/* 底部行：正文 + 图片 */
.note-preview-body-row {
  display: flex;
  flex: 1;
  /* 占满剩余高度 */
  gap: 10px;
  min-height: 0;
  /* 关键：防止溢出 */
  align-items: center;
}

/* 元数据样式 */
.preview-meta-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #999;
  /* 鼠标手势，暗示可交互但不展开 */
  cursor: default;
}

.preview-meta-menu {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  /* ✅ 核心：强制推到最右侧 */
  margin-left: auto;
}

.time-text {
  font-weight: 500;
}

.pinned-indicator-preview {
  color: #888;
  font-weight: 600;
  font-size: 12px;
}

.kebab-menu-small {
  cursor: pointer;
  padding: 2px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  /* ✅ 恢复深色 */
  color: #333;
}

.dark .kebab-menu-small {
  color: #e5e7eb;
}

.draft-icon-wrapper-small {
  color: #f97316;
  display: flex;
  align-items: center;
  cursor: pointer;
}

/* 正文紧凑模式 */
.compact-mode {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;

  font-size: var(--pv-fs) !important;
  line-height: var(--pv-lh) !important;

  /* 高度严格受控 */
  height: var(--pv-text-height);

  flex: 1;
  /* 占满左边空间 */
  margin: 0 !important;
  padding: 0 !important;
  color: #374151;
}

.dark .compact-mode {
  color: #d1d5db;
}
/* ========================================= */
/* ✅ 终极修复：预览模式强制统一字号和排版 */
/* ========================================= */

/* 1. 选中所有可能的文本标签，强制应用计算字号 */
.compact-mode :deep(p),
.compact-mode :deep(span),
.compact-mode :deep(strong),
.compact-mode :deep(em),
.compact-mode :deep(u),
.compact-mode :deep(s),
.compact-mode :deep(ul),
.compact-mode :deep(ol),
.compact-mode :deep(li),
.compact-mode :deep(blockquote),
.compact-mode :deep(code),
.compact-mode :deep(a),
.compact-mode :deep(h1),
.compact-mode :deep(h2),
.compact-mode :deep(h3),
.compact-mode :deep(h4),
.compact-mode :deep(h5),
.compact-mode :deep(h6) {
  /* 强制变成行内元素，连成一片 */
  display: inline;

  /* 🔥 核心：无视 prose 默认字号，强制使用我们计算的变量 */
  font-size: var(--pv-fs) !important;
  line-height: var(--pv-lh) !important;

  /* 清除默认间距和样式 */
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: none !important;
  color: inherit !important;
  font-family: inherit !important;
  font-weight: normal !important; /* 默认不加粗，标题除外 */
}

/* 2. 标题特殊处理：保留一点点加粗 (可选) */
.compact-mode :deep(h1),
.compact-mode :deep(h2),
.compact-mode :deep(h3) {
  font-weight: 600 !important;
}

/* 3. 标签(Tag)特殊处理：恢复颜色和胶囊背景 (你之前的要求) */
.compact-mode :deep(.custom-tag) {
  background-color: #eef2ff !important;
  color: #4338ca !important;
  padding: 0 6px !important;
  border-radius: 999px !important;
  display: inline-block !important; /* 标签还是保持块状一点好看 */
  font-size: 0.9em !important; /* 标签稍微小一点点 */
  margin: 0 2px !important;
}
.dark .compact-mode :deep(.custom-tag) {
  background-color: #312e81 !important;
  color: #c7d2fe !important;
}

/* 4. 间距处理：防止元素粘连 */
.compact-mode :deep(h1)::after, .compact-mode :deep(h2)::after,
.compact-mode :deep(h3)::after, .compact-mode :deep(h4)::after,
.compact-mode :deep(p)::after, .compact-mode :deep(li)::after,
.compact-mode :deep(blockquote)::after {
  content: " ";
}

/* 5. 隐藏不需要的元素 */
.compact-mode :deep(img),
.compact-mode :deep(hr),
.compact-mode :deep(br) { /* br标签也隐藏，防止意外换行 */
  display: none !important;
}

/* 6. 高亮隐身 */
.compact-mode :deep(mark) {
  background-color: transparent !important;
  color: inherit !important;
  padding: 0 !important;
}

/* 图片容器：使用新变量 */
.note-preview-image-box {
  flex-shrink: 0;
  width: var(--img-size);
  /* 3行文字的高度 */
  height: var(--img-size);
  /* 正方形 */
  border-radius: 6px;
  overflow: hidden;
  margin-top: 1px;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background-color: #f3f4f6;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.dark .thumb-img {
  background-color: #1f2937;
  border-color: rgba(255, 255, 255, 0.1);
}

/* 其他通用样式保持简化 */
.toggle-button-row {
  padding: 4px 0;
}

.toggle-button {
  background: none;
  border: none;
  color: #007bff;
  font-size: 14px;
}

.comment-trigger-bar {
  margin-top: 8px;
}

.comment-trigger-input {
  background: #f3f4f6;
  color: #9ca3af;
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 13px;
}

.dark .comment-trigger-input {
  background: #374151;
}

/* 分享卡片隐藏 */
.share-card-root {
  position: fixed;
  top: -9999px;
  left: -9999px;
}

/* 展开模式下的字号恢复 */
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

/* 内容排版 */
:deep(.prose) {
  font-size: 17px !important;
  line-height: 2.2;
  overflow-wrap: break-word;
}

@media (max-width: 768px) {
  :deep(.prose) {
    line-height: 1.8;
  }
}

.note-content :deep(a) {
  color: #2563eb !important;
  text-decoration: underline !important;
}

.note-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  margin: 6px 0;
}

.note-content :deep(blockquote) {
  font-size: 0.85em;
  color: #666;
  background-color: #f9fafb;
  border-left: 3px solid #e5e7eb;
  margin: 0.5em 0;
  padding: 0.5em 1em;
}

.dark .note-content :deep(blockquote) {
  color: #9ca3af;
  background-color: rgba(255, 255, 255, 0.03);
  border-left-color: #4b5563;
}

.draft-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #f97316;
  opacity: 0.9;
}

/* 分享相关 */
.share-card {
  position: relative;
  border-radius: 16px;
  background: linear-gradient(135deg, #f9fafb, #e5edff);
  padding: 12px 14px 10px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  border: 2px solid #6366f1;
}

.dark .share-card {
  background: linear-gradient(135deg, #020617, #020b3a);
  border: 2px solid #818cf8;
}

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

.share-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 7000;
}

.share-modal {
  background: white;
  border-radius: 16px;
  padding: 16px;
  max-width: 420px;
  width: 90vw;
}

.dark .share-modal {
  background: #111827;
}

.share-btn {
  flex: 1;
  border: none;
  border-radius: 9999px;
  padding: 8px 10px;
  background: #6366f1;
  color: white;
  cursor: pointer;
}

.share-btn-secondary {
  background: #e5e7eb;
  color: #111827;
}
/* ========================================= */
/* ✅ 修复：在预览模式下强制保留标签颜色 */
/* ========================================= */
.compact-mode :deep(.custom-tag) {
  /* 强制恢复标签的蓝紫色背景和文字颜色 */
  background-color: #eef2ff !important;
  color: #4338ca !important;

  /* 恢复标签的小圆角和内边距，让它看起来像个胶囊 */
  padding: 0 6px !important;
  border-radius: 999px !important;
  margin: 0 2px !important;

  /* 确保它在一行内显示 */
  display: inline-block !important;
  font-size: 0.9em !important;
  line-height: 1.4 !important;
}

/* 深色模式下的标签适配 */
.dark .compact-mode :deep(.custom-tag) {
  background-color: #312e81 !important;
  color: #c7d2fe !important;
}

/* ========================================= */
/* ✅ 修复：预览模式下“隐身”高亮效果 */
/* ========================================= */
.compact-mode :deep(mark) {
  /* 去掉背景色，变回透明 */
  background-color: transparent !important;

  /* 去掉文字颜色强制，跟随正文颜色 */
  color: inherit !important;

  /* 关键：去掉内边距，防止撑高卡片 */
  padding: 0 !important;
  margin: 0 !important;

  /* 去掉任何可能的边框或阴影 */
  box-shadow: none !important;
  border: none !important;

  /* ========================================= */
/* ✅ 修复：预览模式下隐藏所有标题 (H1-H6) */
/* ========================================= */
.compact-mode :deep(h1),
.compact-mode :deep(h2),
.compact-mode :deep(h3),
.compact-mode :deep(h4),
.compact-mode :deep(h5),
.compact-mode :deep(h6) {
  display: none !important;
}
}
</style>

<style>
/* 下拉菜单样式 */
.n-dropdown-menu .n-dropdown-option-body {
  padding: 0 10px !important;
  font-size: 14px !important;
}

.n-dropdown-menu .n-dropdown-divider {
  margin: 0 !important;
  padding: 0 !important;
  height: 1px !important;
  background-color: rgba(0, 0, 0, 0.08) !important;
}

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
