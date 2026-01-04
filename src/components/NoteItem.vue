<script setup lang="ts">
import { computed, h, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// 移除原有的 MarkdownIt 及插件 import
import { NButton, NCard, NDropdown, NInput, NModal, useMessage, useThemeVars } from 'naive-ui'
import { useDark } from '@vueuse/core'
import html2canvas from 'html2canvas'
import { Calendar, Copy, Edit3, Heart, HeartOff, Pin, PinOff, Share, Trash2 } from 'lucide-vue-next'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting.ts'

// 引入全局 Markdown 单例
import { md } from '@/utils/markdownRenderer'

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

// --- 基础状态 ---
const showCommentModal = ref(false)
const commentText = ref('')
const isSubmittingComment = ref(false)
const showDatePicker = ref(false)
const hasDraft = ref(false)

// =========================================================
// ⬇️⬇️⬇️ 完全回滚回旧版的分享逻辑 ⬇️⬇️⬇️
// =========================================================

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

// 1. 回滚：使用旧版逻辑，带时间戳 force-reload 和 no-cache
// ⬇️⬇️⬇️ 1. 图片转 Base64 (极速版) ⬇️⬇️⬇️
async function convertSupabaseImagesToDataURL(container: HTMLElement) {
  const imgs = Array.from(container.querySelectorAll('img'))

  // 使用 Promise.all 并行处理，极大提升速度
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src')
    // 跳过没有 src 或已经是 base64 的图片
    if (!src || src.startsWith('data:'))
      return

    try {
      // 🚀 核心速度优化：
      // 添加 `t=Date.now()` 强制浏览器发起新请求，避开本地缓存数据库的查找和锁等待
      // cache: 'no-cache' 告诉浏览器不要把结果写入缓存，减少磁盘 I/O 写入时间
      const res = await fetch(`${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, {
        mode: 'cors',
        cache: 'no-cache',
      })

      if (!res.ok)
        throw new Error('Network error')

      const blob = await res.blob()
      const base64 = await new Promise<string>((r, j) => {
        const reader = new FileReader()
        reader.onloadend = () => r(reader.result as string)
        reader.onerror = j
        reader.readAsDataURL(blob)
      })

      // 替换 DOM 中的图片源，断开跨域链接
      img.src = base64
      img.removeAttribute('crossorigin')
    }
    catch (e) {
      // 即使某张图失败，也不要阻塞整个分享流程，只打印警告
      console.warn('Img convert fail', src, e)
    }
  }))
}

// ⬇️⬇️⬇️ 2. 生成分享图片 (极速版) ⬇️⬇️⬇️
async function handleShare() {
  if (!props.note)
    return

  try {
    shareGenerating.value = true
    showShareCard.value = true

    // 1. 等待 Vue 更新 DOM
    await nextTick()

    // 🚀 核心速度优化：
    // 使用 requestAnimationFrame 确保浏览器完成了当前的“重绘”
    // 这比单纯的 setTimeout 更能确保 DOM 布局已稳定，减少 html2canvas 的计算量
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

    const el = shareCardRef.value
    if (!el)
      throw new Error('share card element not found')

    // 2. 转换图片 (上述极速函数)
    await convertSupabaseImagesToDataURL(el as HTMLElement)

    // 3. 给予微小的缓冲时间让 Base64 渲染上屏
    await new Promise(resolve => setTimeout(resolve, 100))

    // 🚀 核心速度优化：
    // 限制 scale 最大为 2。如果不限制，高分屏手机(3x/4x)生成的 Canvas 会非常巨大，
    // 导致生成时间指数级增加（卡顿 4-5 秒通常是因为这里生成了 4000px+ 的大图）。
    const scale = Math.min(window.devicePixelRatio || 1, 2)

    const canvas = await html2canvas(el, {
      backgroundColor: isDark.value ? '#020617' : '#f9fafb',
      scale, // 限制尺寸
      useCORS: true, // 允许跨域
      allowTaint: true, // 旧版保留配置，配合 Base64 使用无副作用
      logging: false, // 关闭日志提升微小性能
    })

    shareCanvasRef.value = canvas
    shareImageUrl.value = canvas.toDataURL('image/jpeg', 0.8)
    sharePreviewVisible.value = true
  }
  catch (err: any) {
    console.error(err)
    messageHook.error(t('notes.share_failed', '生成分享图片失败'))
  }
  finally {
    shareGenerating.value = false
    showShareCard.value = false
  }
}

// 3. 回滚：下载逻辑
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

// 4. 回滚：系统分享逻辑，恢复旧版判定条件
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

    // 旧版核心：这里的判断逻辑和对象结构保持原样
    const shareData: any = {
      title: t('notes.share_title', '分享笔记'),
      text: '', // 旧版保留了这个空字符串
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

// =========================================================
// ⬆️⬆️⬆️ 分享逻辑结束 ⬆️⬆️⬆️
// =========================================================

// --- 计算属性：字体与布局 (保留新版逻辑) ---
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
  const textHeight = lh * 3
  const imgSize = lh * 2.6
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

const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize || 'medium'}`)
// 1. 获取当前 Naive UI 的主题变量（会自动跟随深色模式和全局主题配置）
const themeVars = useThemeVars()

// 2. 修改 computed，让 CSS 变量直接读取 themeVars 里的主色
const dynamicThemeStyle = computed(() => {
  return {
    // themeVars.value.primaryColor 会拿到当前生效的颜色（例如 #18a058 或你自定义的颜色）
    '--theme-primary': themeVars.value.primaryColor,
  }
})
const firstImageUrl = computed(() => {
  const c = String(props.note?.content || '')
  const mdMatch = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/.exec(c)
  return (mdMatch && mdMatch[1]) ? mdMatch[1].trim() : null
})

const weatherDisplay = computed(() => {
  const w = String(props.note?.weather ?? '').trim()
  return w ? w.replace(/[;；][^\s]*/, '') : ''
})

// --- Markdown 渲染 (使用单例) ---
// 逻辑说明：原有的 new MarkdownIt() 和配置逻辑已全部移除，转而调用 utils/markdownRenderer

function renderMarkdown(content: string) {
  if (!content)
    return ''

  // 1. 调用单例渲染。
  // 重要：传入空对象 {} 作为 env，确保每次渲染的状态（如音频链接解析）是隔离的
  let html = md.render(content, {})

  // 2. 后处理：自定义 Tag 样式
  html = html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')

  // 3. 后处理：搜索高亮
  const query = props.searchQuery.trim()
  if (query) {
    try {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      html = html.replace(new RegExp(escapedQuery, 'gi'), match => `<mark class="search-highlight">${match}</mark>`)
    }
    catch (e) {
      console.warn('Search highlight regex error', e)
    }
  }
  return html
}

// --- 业务逻辑 ---
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

async function handleAppendComment() {
  if (!commentText.value.trim())
    return

  const noteId = props.note.id
  if (!noteId) {
    messageHook.error(t('notes.operation_error'))
    return
  }

  const now = new Date()
  const timeString = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const headerText = t('notes.comment.header')
  const commentBlock = `> ${headerText} ${timeString}\n> ${commentText.value.replace(/\n/g, '\n> ')}`
  const separator = '\n\n---\n\n'
  const newContent = (props.note.content || '') + separator + commentBlock

  if (newContent.length > 20000) {
    messageHook.error(t('notes.max_length_exceeded', { max: 20000 }))
    return
  }

  isSubmittingComment.value = true
  try {
    const { data, error } = await supabase.from('notes').update({ content: newContent }).eq('id', noteId).select().single()
    if (error)
      throw error

    messageHook.success(t('notes.comment.success'))
    showCommentModal.value = false
    commentText.value = ''
    emit('dateUpdated', { ...props.note, ...(data || {}), id: noteId, content: newContent })
  }
  catch (err: any) {
    messageHook.error(t('notes.comment.fail', { reason: err?.message }))
  }
  finally {
    isSubmittingComment.value = false
  }
}

// --- 格式化辅助 ---
function formatDateWithWeekday(dateStr: string) {
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `<span class="date-day">${d.getDate()}${t('notes.card.day_suffix') || ''}</span> ${t('notes.card.date_format_no_day', { weekday: t(`notes.card.weekday_${d.getDay()}`), hh, mm })}`
}

function getDayNumber(d: string) {
  return new Date(d).getDate()
}

function getWeekday(d: string) {
  return new Date(d).toLocaleString('zh-CN', { weekday: 'short' })
}

function formatTime(d: string) {
  const dt = new Date(d)
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// ✅ 1. 新增这个状态变量
const showDropdown = ref(false)

// --- 菜单与交互 ---
function makeDropdownItem(iconComp: any, text: string, iconStyle: Record<string, any> = {}) {
  return () => h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        flex: '1',
      },
    },
    [
      h('span', null, text),
      h(iconComp, { size: 18, style: iconStyle }),
    ],
  )
}

// 2. 顶部单个按钮渲染
// ✅ 修复：删除了所有 DOM Hack，只负责单纯的点击响应
function renderHeaderBtn(iconComp: any, text: string, onClick: () => void) {
  return h(
    'div',
    {
      style: {
        width: '50px', // 保持漂亮的间距
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    [
      h(
        'div',
        {
          class: 'header-btn-inner',
          style: {
            width: '100%',
            padding: '8px 0',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          },
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            // 这里只执行回调，关闭逻辑在 getDropdownOptions 里统一处理
            onClick()
          },
        },
        [
          h('div', { style: { height: '24px', display: 'flex', alignItems: 'center' } }, [
            h(iconComp, { size: 20, strokeWidth: 1.5 }),
          ]),
          h('span', { style: { fontSize: '11px', marginTop: '4px' } }, text),
        ],
      ),
    ],
  )
}

// 3. 宽分隔线 (保持漂亮的负边距)
function renderWideGap() {
  return h('div', {
    style: {
      height: '8px',
      backgroundColor: isDark.value ? '#1f2937' : '#f5f5f7',
      margin: '4px -12px', // 负边距抵消 padding
      borderTop: isDark.value ? '1px solid #374151' : '1px solid #ebedf0',
      borderBottom: isDark.value ? '1px solid #374151' : '1px solid #ebedf0',
    },
  })
}

// 4. 菜单配置主函数
function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0

  // ✅ 修复：强制显示年份 (year: 'numeric')
  const dateOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }

  // ✅ 辅助函数：执行动作并关闭菜单
  const doAction = (action: () => void) => {
    action()
    showDropdown.value = false // 手动关闭菜单
  }

  return [
    // --- 顶部 Grid 区域 ---
    {
      key: 'header-actions',
      type: 'render',
      class: 'custom-no-hover',
      render: () => h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-evenly',
            alignItems: 'center',
            margin: '-6px -12px', // 保持漂亮的负边距
            width: 'calc(100% + 24px)',
            padding: '6px 0',
            cursor: 'default',
          },
        },
        [
          // ✅ 修复：在这里包裹 doAction，确保点击后关闭菜单
          renderHeaderBtn(Share, t('notes.share', '分享'), () => doAction(handleShare)),
          renderHeaderBtn(Edit3, t('notes.edit'), () => doAction(() => emit('edit', props.note))),
          renderHeaderBtn(Copy, t('notes.copy'), () => doAction(() => emit('copy', props.note.content))),
        ],
      ),
    },

    { key: 'g1', type: 'render', render: renderWideGap, class: 'custom-no-hover' },

    // --- 中间列表区域 ---
    {
      key: 'pin',
      label: makeDropdownItem(
        note.is_pinned ? PinOff : Pin,
        note.is_pinned ? t('notes.unpin') : t('notes.pin'),
      ),
    },
    { type: 'divider', key: 'd1' },
    {
      key: 'favorite',
      label: makeDropdownItem(
        note.is_favorited ? HeartOff : Heart,
        note.is_favorited ? t('notes.unfavorite', '取消收藏') : t('notes.favorite', '收藏'),
        { color: note.is_favorited ? '#ef4444' : undefined },
      ),
    },
    { type: 'divider', key: 'd2' },
    {
      key: 'set_date',
      label: makeDropdownItem(Calendar, t('notes.card.set_date')),
    },
    { type: 'divider', key: 'd3' },
    {
      key: 'delete',
      label: makeDropdownItem(Trash2, t('notes.delete'), { color: '#d03050' }),
    },

    { key: 'g2', type: 'render', render: renderWideGap, class: 'custom-no-hover' },

    // --- 底部信息区域 ---
    {
      key: 'info',
      type: 'render',
      class: 'custom-no-hover',
      render: () => h('div', {
        class: 'dropdown-info-block',
        style: {
          padding: '8px 4px 12px 26px',
          fontSize: '11px',
          color: '#9ca3af',
          textAlign: 'left',
          lineHeight: '1.6',
        },
      }, [
        h('div', null, t('notes.word_count', { count: charCount })),
        // ✅ 新增：创建时间 (带年份)
        h('div', null, `${t('notes.created_at', { time: '' })} ${new Date(note.created_at).toLocaleString('zh-CN', dateOpts)}`),
        // ✅ 修复：更新时间 (带年份)
        h('div', null, `${t('notes.updated2_at', { time: '' })} ${new Date(note.updated_at).toLocaleString('zh-CN', dateOpts)}`),
      ]),
    },
  ]
}

function handleDropdownSelect(key: string) {
  const actions: Record<string, Function> = {
    edit: () => emit('edit', props.note),
    share: handleShare,
    copy: () => emit('copy', props.note.content),
    pin: () => emit('pin', props.note),
    favorite: () => emit('favorite', props.note),
    set_date: () => (showDatePicker.value = true),
    delete: () => emit('delete', props.note.id),
  }
  if (actions[key])
    actions[key]()
}

function handleNoteContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement

  // 1. 查找被点击的链接
  const link = target.closest('a')

  if (link) {
    // ---------------------------------------------------------
    // 🛡️ 1. 图片防护：如果是图片，绝对禁止打开
    // ---------------------------------------------------------
    if (link.querySelector('img') || target.tagName === 'IMG') {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const href = link.getAttribute('href')
    if (!href)
      return

    // ---------------------------------------------------------
    // 🛡️ 2. PWA 越狱逻辑 (终极方案：模拟点击)
    // ---------------------------------------------------------
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

    // 如果是 PWA 且是 http/https 链接
    if (isStandalone && /^https?:\/\//.test(href)) {
      // 解析域名，判断是否是“外链”
      try {
        const currentHost = window.location.host
        const linkUrl = new URL(href)

        // 只要域名不一致，就强制跳出
        if (linkUrl.host !== currentHost) {
          event.preventDefault()
          event.stopPropagation()

          // 🚀 核心技巧：创建一个临时的 DOM 元素来模拟点击
          // 这比 window.open 在 iOS 上成功率更高
          const tempLink = document.createElement('a')
          tempLink.href = href
          // 关键：iOS PWA 看到 _blank 且跨域，通常会弹出一个 Safari 视图层
          tempLink.target = '_blank'
          tempLink.rel = 'noopener noreferrer'

          // 模拟点击
          tempLink.click()

          // 销毁
          tempLink.remove()
          return
        }
      }
      catch (e) {
        console.warn('URL parse failed', e)
      }
    }

    // ---------------------------------------------------------
    // 🛡️ 3. 普通模式兜底
    // ---------------------------------------------------------
    localStorage.setItem('pwa_return_note_id', props.note.id)
    if (link.getAttribute('target') !== '_blank')
      link.setAttribute('target', '_blank')

    // 让浏览器执行默认行为
    return
  }

  // 2. 处理任务列表 (保持不变)
  const listItem = target.closest('li.task-list-item')
  if (!listItem)
    return

  if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
    event.stopPropagation()
    const noteCard = event.currentTarget as HTMLElement
    const index = Array.from(noteCard.querySelectorAll('li.task-list-item')).indexOf(listItem)
    if (index !== -1)
      emit('taskToggle', { noteId: props.note.id, itemIndex: index })
  }
  else {
    event.preventDefault()
  }
}

function openCommentModal() {
  commentText.value = ''
  showCommentModal.value = true
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
          <NDropdown
            v-model:show="showDropdown"
            trigger="click"
            placement="bottom-end"
            :options="getDropdownOptions(note)"
            :style="{ minWidth: '220px' }"
            @select="handleDropdownSelect"
          >
            <div class="kebab-menu">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" /></svg>
            </div>
          </NDropdown>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <div v-if="isExpanded">
          <div
            class="note-content prose dark:prose-invert max-w-none px-10"
            :class="fontSizeClass"
            v-html="renderMarkdown(note.content)"
          />
          <div class="comment-trigger-bar" @click.stop="openCommentModal">
            <div class="comment-trigger-input">{{ $t('notes.comment.trigger') }}</div>
          </div>
          <div v-if="showInternalCollapseButton" class="toggle-button-row" @click.stop="emit('toggleExpand', note.id)">
            <button class="toggle-button">{{ $t('notes.collapse', '收起') }}</button>
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
                  <NDropdown
                    v-model:show="showDropdown"
                    trigger="click"
                    placement="bottom-end"
                    :options="getDropdownOptions(note)"
                    :style="{ minWidth: '220px' }"
                    @select="handleDropdownSelect"
                  >
                    <div class="kebab-menu">
                      <svg width="17" height="17" viewBox="0 0 24 24"><path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" /></svg>
                    </div>
                  </NDropdown>
                </div>
              </div>
              <div class="note-preview-body-row">
                <div class="prose dark:prose-invert note-content compact-mode" v-html="renderMarkdown(note.content)" />
                <div v-if="firstImageUrl" class="note-preview-image-box">
                  <img :src="firstImageUrl" class="thumb-img" loading="lazy" alt="preview">
                </div>
              </div>
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
      <div class="share-card" :style="dynamicThemeStyle">
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
      <DateTimePickerModal v-if="showDatePicker" :show="showDatePicker" :initial-date="new Date(note.created_at)" :style="{ zIndex: 6005 }" @close="showDatePicker = false" @confirm="handleDateUpdate" />
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
                :style="dynamicThemeStyle"
                @click="downloadShareImage"
              >
                {{ $t('notes.share_save_only', '保存') }}
              </button>
              <button
                type="button"
                class="share-btn"
                :style="dynamicThemeStyle"
                @click="systemShareImage"
              >
                {{ $t('notes.share_button', '分享') }}
              </button>
              <button type="button" class="share-btn share-btn-secondary" @click="sharePreviewVisible = false">
                {{ $t('common.close', '关闭') }}
              </button>
            </template>

            <template v-else>
              <button
                type="button"
                class="share-btn"
                :style="dynamicThemeStyle"
                @click="systemShareImage"
              >
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
      <NCard
        :title="$t('notes.comment.title')"
        size="small"
        :style="{
          width: '90%',
          maxWidth: '600px',
          marginBottom: isIOS ? '46vh' : '0',
        }"
      >
        <NInput v-model:value="commentText" type="textarea" autofocus :style="commentInputStyle" />
        <template #footer>
          <NButton size="small" @click="showCommentModal = false">{{ $t('notes.comment.cancel') }}</NButton>
          <NButton type="primary" size="small" :loading="isSubmittingComment" @click="handleAppendComment">{{ $t('notes.comment.submit') }}</NButton>
        </template>
      </NCard>
    </NModal>
    <Teleport to="body">
      <div v-if="shareGenerating" class="full-screen-loading">
        <div class="loading-content">
          <div class="spinner" />
          <p class="loading-text">{{ $t('notes.share_generating', '正在生成精美卡片...') }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ========================================= */
/* 1. 主卡片基础样式 */
/* ========================================= */
.note-card {
  position: relative;
  border-radius: 0.5rem;
  background-color: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}
.dark .note-card {
  background-color: var(--main-bg-c);
  border: 1px solid #3f3f46;
}
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
.dark .note-date { color: #f0f0f0; }
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
.kebab-menu:hover { background-color: rgba(0, 0, 0, 0.1); }
.draft-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #f97316;
  opacity: 0.9;
}

/* ========================================= */
/* 2. 预览模式 (Day One 风格) */
/* ========================================= */
.note-preview-card {
  display: flex;
  gap: 6px;
  height: var(--pv-height);
  align-items: stretch;
  cursor: pointer;
  overflow: hidden;
}
.note-preview-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 30px;
  flex-shrink: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
  height: 100%;
  padding-right: 4px;
  margin-right: -2px;
}
.dark .note-preview-date { border-right-color: rgba(255, 255, 255, 0.1); }
.dimmed-date .date-day { color: #d1d5db; font-weight: 600; }
.dimmed-date .date-weekday { color: #e5e7eb; }
.dark .dimmed-date .date-day { color: #4b5563; }
.dark .dimmed-date .date-weekday { color: #374151; }
.date-day {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
  color: #333;
}
.dark .date-day { color: #e5e7eb; }
.date-weekday {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}
.note-preview-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.note-preview-inner-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  flex-shrink: 0;
  width: 100%;
}
.note-preview-body-row {
  display: flex;
  flex: 1;
  gap: 10px;
  min-height: 0;
  align-items: center;
}
.preview-meta-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #999;
  cursor: default;
}
.preview-meta-menu {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}
.time-text { font-weight: 500; }
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
  color: #333;
}
.dark .kebab-menu-small { color: #e5e7eb; }
.draft-icon-wrapper-small {
  color: #f97316;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.note-preview-image-box {
  flex-shrink: 0;
  width: var(--img-size);
  height: var(--img-size);
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

/* ========================================= */
/* 3. 紧凑模式排版 (强制覆盖 Prose 样式) */
/* ========================================= */
.compact-mode {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--pv-fs) !important;
  line-height: var(--pv-lh) !important;
  height: var(--pv-text-height);
  flex: 1;
  margin: 0 !important;
  padding: 0 !important;
  color: #374151;
  pointer-events: none !important; /* 禁止内部交互 */
}
.dark .compact-mode { color: #d1d5db; }

/* 强制重置所有子元素为行内样式 */
.compact-mode :deep(p), .compact-mode :deep(span), .compact-mode :deep(strong),
.compact-mode :deep(em), .compact-mode :deep(u), .compact-mode :deep(s),
.compact-mode :deep(ul), .compact-mode :deep(ol), .compact-mode :deep(li),
.compact-mode :deep(blockquote), .compact-mode :deep(code), .compact-mode :deep(a) {
  display: inline;
  font-size: var(--pv-fs) !important;
  line-height: var(--pv-lh) !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: none !important;
  color: inherit !important;
  font-family: inherit !important;
  font-weight: normal !important;
}

/* ✅ 修复：让加粗字体 (strong/b) 在预览模式下恢复粗体 */
.compact-mode :deep(strong),
.compact-mode :deep(b) {
  font-weight: bold !important;
  /* 可选：如果你希望加粗字体的颜色更深一点，可以加上下面这行 */
  /* color: #000 !important; */
}

/* ✅ 修复：深色模式下的加粗 */
.dark .compact-mode :deep(strong),
.dark .compact-mode :deep(b) {
  font-weight: bold !important;
  /* color: #fff !important; */
}

/* 标签特殊处理 */
.note-content :deep(.custom-tag) {
  background-color: #eef2ff !important; /* 浅蓝背景 */
  color: #4338ca !important;           /* 深蓝文字 */
  padding: 0 6px !important;           /* 内边距 */
  border-radius: 4px !important;       /* 圆角 (稍微改小一点点，看你喜好，999px是胶囊形，4px是方圆角) */
  /* 如果喜欢完全圆润的胶囊，保持 999px 即可 */
  border-radius: 999px !important;

  display: inline-block !important;
  font-size: 0.9em !important;
  margin: 0 2px !important;
  line-height: 1.4 !important;
  font-weight: 500 !important;         /* 加一点字重更清晰 */
}

.dark .note-content :deep(.custom-tag) {
  background-color: #312e81 !important; /* 深色模式背景 */
  color: #c7d2fe !important;           /* 深色模式文字 */
}

/* 隐藏不需要的元素 */
.compact-mode :deep(img), .compact-mode :deep(hr) { display: none !important; }
/* ========================================= */
/* 修复：强制将标题 H1-H6 变成“行内普通文字” */
/* ========================================= */
.compact-mode :deep(h1),
.compact-mode :deep(h2),
.compact-mode :deep(h3),
.compact-mode :deep(h4),
.compact-mode :deep(h5),
.compact-mode :deep(h6) {
  display: inline !important;        /* 关键：强制不换行，跟后面的字连在一起 */
  font-size: 1em !important;         /* 关键：强制字号跟正文一样大 */
  font-weight: bold !important;      /* 保留加粗，以便区分 */
  margin: 0 !important;              /* 关键：去除所有外边距，防止撑开高度 */
  padding: 0 !important;             /* 去除内边距 */
  line-height: inherit !important;   /* 跟随正文行高 */
  color: inherit !important;         /* 跟随正文颜色 */
  border: none !important;           /* 去除可能存在的下划线 */
}

/* 优化：给标题后面强制加一个空格，防止标题和正文粘在一起 */
.compact-mode :deep(h1)::after,
.compact-mode :deep(h2)::after,
.compact-mode :deep(h3)::after,
.compact-mode :deep(h4)::after,
.compact-mode :deep(h5)::after,
.compact-mode :deep(h6)::after {
  content: " ";
  white-space: pre;
}

/* 高亮隐身 */
.compact-mode :deep(mark) {
  background-color: transparent !important;
  color: inherit !important;
  padding: 0 !important;
  margin: 0 !important;
}
/* 间距处理 */
.compact-mode :deep(p)::after, .compact-mode :deep(li)::after, .compact-mode :deep(blockquote)::after {
  content: "\A";
  white-space: pre;
}

/* ========================================= */
/* ⬇️⬇️⬇️ 4. 旧版分享卡片样式 (完全替换) ⬇️⬇️⬇️ */
/* ========================================= */
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

  /* 3. 加深阴影 */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.03);

  font-family: system-ui, -apple-system, BlinkMacSystemFont,
                   'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;

  /* ✅ 只保留这一行动态边框，删除下面所有写死的 border */
  border: 2px solid var(--theme-primary);

  backdrop-filter: blur(4px);
}
.dark .share-card {
  background: linear-gradient(135deg, #020617, #020b3a);
  color: #e5e7eb;
  border: 2px solid var(--theme-primary);
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
  background: var(--theme-primary);
}

.dark .share-card::before {
  background: var(--theme-primary);
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

/* ========================================= */
/* ⬇️⬇️⬇️ 5. 旧版分享预览弹窗样式 (完全替换) ⬇️⬇️⬇️ */
/* ========================================= */
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
  background: var(--theme-primary);
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

/* ========================================= */
/* 6. 通用内容排版 */
/* ========================================= */
.toggle-button-row { padding: 4px 0; }
.toggle-button {
  background: none;
  border: none;
  color: #007bff;
  font-size: 14px;
}
.comment-trigger-bar { margin-top: 8px; }
.comment-trigger-input {
  background: #f3f4f6;
  color: #9ca3af;
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 13px;
}
.dark .comment-trigger-input { background: #374151; }

:deep(.prose.font-size-small) { font-size: 14px !important; }
:deep(.prose.font-size-medium) { font-size: 17px !important; }
:deep(.prose.font-size-large) { font-size: 20px !important; }
:deep(.prose.font-size-extra-large) { font-size: 22px !important; }
:deep(.prose) {
  font-size: 17px !important;
  line-height: 2.2;
  overflow-wrap: break-word;
}
@media (max-width: 768px) {
  :deep(.prose) { line-height: 1.8; }
}
.note-content :deep(a) { color: #2563eb !important; text-decoration: underline !important; }
.note-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  margin: 6px 0;
  cursor: default !important;
  -webkit-touch-callout: default !important; /* iOS 强制允许弹出长按菜单 */
  pointer-events: auto !important;           /* 确保图片能响应手指触摸 */
  user-select: none;                         /* 禁止选中图片变蓝，但允许长按 */
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

/* ... 上面是原有的 CSS ... */

/* ========================================= */
/* ✅ 新增：全屏加载遮罩层样式 */
/* ========================================= */
.full-screen-loading {
  position: fixed;
  inset: 0; /* 占满全屏 */
  background-color: rgba(0, 0, 0, 0.6); /* 深色半透明背景 */
  backdrop-filter: blur(4px); /* 背景模糊，增加高级感 */
  z-index: 9999; /* 确保在最顶层 */
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: white;
}

.loading-text {
  margin-top: 16px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 1px;
}

/* 纯 CSS 旋转圆圈动画 */
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff; /* 顶部白色，旋转产生动画 */
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.header-btn-inner {
  transition: background-color 0.2s;
  color: #555;
}

.dark .header-btn-inner {
  color: #e5e7eb; /* 🌙 暗色模式下的文字和图标颜色 (亮灰白) */
}

.header-btn-inner:hover {
  background-color: rgba(0, 0, 0, 0.05); /* 浅灰背景只出现在按钮范围内 */
}

.dark .header-btn-inner:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
</style>

<style>
/* 1. 基础设置 */
.n-dropdown-menu .n-dropdown-option-body {
  min-height: 40px;
  padding: 0 12px !important; /* 保持默认 Padding，让 JS 的负边距去抵消它 */
  display: flex !important;
  align-items: center !important;
}

/* 2. 去掉悬停背景色 */
.n-dropdown-option:has(.custom-no-hover) .n-dropdown-option-body:hover,
.n-dropdown-option:has(.custom-no-hover) .n-dropdown-option-body.n-dropdown-option-body--pending {
  background-color: transparent !important;
}

/* 3. 顶部和分隔线：取消高度限制 */
.n-dropdown-option:has(.custom-no-hover) .n-dropdown-option-body {
  display: block !important;
  height: auto !important;
  min-height: auto !important;
  /* 关键：允许内容溢出，这样负边距才不会被切掉 */
  overflow: visible !important;
  /* 这里我们保留 padding，让 JS 的 -12px margin 去自动吸附边缘 */
}

/* 4. 底部信息块 */
.n-dropdown-option:has(.dropdown-info-block) .n-dropdown-option-body {
   padding-bottom: 0 !important;
   margin-bottom: 4px;
}

/* 5. 分隔线颜色 */
.n-dropdown-menu .n-dropdown-divider {
  margin: 0 !important;
  background-color: rgba(0, 0, 0, 0.06) !important;
}
.dark .n-dropdown-menu .n-dropdown-divider {
  background-color: rgba(255, 255, 255, 0.1) !important;
}
</style>
