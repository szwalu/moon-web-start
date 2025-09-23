<script setup lang="ts">
import { computed, defineExpose, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'
import { NInput, useDialog } from 'naive-ui'
import { useSettingStore } from '@/stores/setting'
import { cityMap, weatherMap } from '@/utils/weatherMap'

// ============== Props & Emits ==============
const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 20000 },
  placeholder: { type: String, default: '写点什么...' },
  allTags: { type: Array as () => string[], default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'focus', 'blur'])

// —— 常用标签记忆（与 useTagMenu 保持同一存储键）——
const PINNED_TAGS_KEY = 'pinned_tags_v1'
const pinnedTags = ref<string[]>([])
function isPinned(tag: string) {
  return pinnedTags.value.includes(tag)
}
onMounted(() => {
  try {
    const raw = localStorage.getItem(PINNED_TAGS_KEY)
    pinnedTags.value = raw ? JSON.parse(raw) : []
  }
  catch {
    pinnedTags.value = []
  }
})

// ============== Store ==============
const settingsStore = useSettingStore()

// ============== v-model ==============
const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

// ============== Autosize ==============
const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })
const charCount = computed(() => contentModel.value.length)

// ===== 超长提示：超过 maxNoteLength 弹出一次警告 =====
const dialog = useDialog()
const overLimitWarned = ref(false)
watch([charCount, () => props.maxNoteLength], ([len, max]) => {
  if (len > max && !overLimitWarned.value) {
    overLimitWarned.value = true
    dialog.warning({
      title: '字数超出限制',
      content: `单条笔记不能超过 ${max} 字，请删减后再保存。`,
      positiveText: '确定',
    })
  }
  else if (len <= max && overLimitWarned.value) {
    overLimitWarned.value = false
  }
})

// ============== 输入与联想标签 ==============
const isComposing = ref(false)
const suppressNextBlur = ref(false)
let blurTimeoutId: number | null = null
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

// —— 样式弹层（B / 1. / H / I / • / 🖊️）
const showFormatPalette = ref(false)
const formatPalettePos = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })
const formatBtnRef = ref<HTMLElement | null>(null)
const formatPaletteRef = ref<HTMLElement | null>(null)

// 根节点 + 光标缓存
const rootRef = ref<HTMLElement | null>(null)
const lastSelectionStart = ref<number>(0)
function captureCaret() {
  const el = textarea.value
  if (el && typeof el.selectionStart === 'number')
    lastSelectionStart.value = el.selectionStart
}

// ============== 让工具栏贴“键盘上沿”的极简逻辑 ==============
const isImeOpen = ref(false)

function applyKbOffset() {
  const vv = window.visualViewport
  if (!vv) {
    document.documentElement.style.removeProperty('--kb-offset')
    isImeOpen.value = false
    return
  }
  const eaten = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  const THRESHOLD = 24
  const open = eaten > THRESHOLD
  isImeOpen.value = open
  document.documentElement.style.setProperty('--kb-offset', `${open ? eaten : 0}px`)
}

let _vvHandler: any = null
onMounted(() => {
  applyKbOffset()
  const vv = window.visualViewport
  if (vv) {
    _vvHandler = () => {
      applyKbOffset()
    }
    vv.addEventListener('resize', _vvHandler)
    vv.addEventListener('scroll', _vvHandler)
  }
  window.addEventListener('orientationchange', applyKbOffset)
  window.addEventListener('resize', applyKbOffset)
})
onUnmounted(() => {
  const vv = window.visualViewport
  if (vv && _vvHandler) {
    vv.removeEventListener('resize', _vvHandler)
    vv.removeEventListener('scroll', _vvHandler)
  }
  window.removeEventListener('orientationchange', applyKbOffset)
  window.removeEventListener('resize', applyKbOffset)
})

// ============== 滚动校准（保持光标可见，避免跳动） ==============
function ensureCaretVisibleInTextarea() {
  const el = textarea.value
  if (!el)
    return

  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  mirror.style.cssText = `position:absolute; visibility:hidden; white-space:pre-wrap; word-wrap:break-word; box-sizing:border-box; top:0; left:-9999px; width:${el.clientWidth}px; font:${style.font}; line-height:${style.lineHeight}; padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}; border:solid transparent; border-width:${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth};`
  document.body.appendChild(mirror)

  const val = el.value
  const selEnd = el.selectionEnd ?? val.length
  const before = val.slice(0, selEnd).replace(/\n$/, '\n ').replace(/ /g, '\u00A0')
  mirror.textContent = before

  const lineHeight = Number.parseFloat(style.lineHeight || '20')
  const caretTopInTextarea = mirror.scrollHeight - Number.parseFloat(style.paddingBottom || '0')
  document.body.removeChild(mirror)

  const viewTop = el.scrollTop
  const viewBottom = el.scrollTop + el.clientHeight
  const caretDesiredTop = caretTopInTextarea - lineHeight * 0.5
  const caretDesiredBottom = caretTopInTextarea + lineHeight * 1.5

  if (caretDesiredBottom > viewBottom)
    el.scrollTop = Math.min(caretDesiredBottom - el.clientHeight, el.scrollHeight - el.clientHeight)
  else if (caretDesiredTop < viewTop)
    el.scrollTop = Math.max(caretDesiredTop, 0)
}

// ========= 新建时写入天气：工具函数 =========
function getMappedCityName(enCity: string) {
  if (!enCity)
    return '未知地点'

  const lower = enCity.trim().toLowerCase()
  for (const [k, v] of Object.entries(cityMap)) {
    const kk = k.toLowerCase()
    if (lower === kk || lower.startsWith(kk))
      return v as string
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
function getWeatherIcon(code: number) {
  const item = (weatherMap as any)[code] || { icon: '❓' }
  return item.icon
}
async function fetchWeatherLine(): Promise<string | null> {
  try {
    let loc: { city: string; lat: number; lon: number }
    try {
      const r = await fetch('https://ipapi.co/json/')
      if (!r.ok)
        throw new Error(String(r.status))

      const d = await r.json()
      if (d?.error)
        throw new Error(d?.reason || 'ipapi error')

      loc = { city: d.city, lat: d.latitude, lon: d.longitude }
    }
    catch {
      const r2 = await fetch('https://ip-api.com/json/')
      if (!r2.ok)
        throw new Error(String(r2.status))

      const d2 = await r2.json()
      if (d2?.status === 'fail')
        throw new Error(d2?.message || 'ip-api error')

      loc = { city: d2.city || d2.regionName, lat: d2.lat, lon: d2.lon }
    }

    if (!loc?.lat || !loc?.lon)
      throw new Error('定位失败')

    const city = getMappedCityName(loc.city)

    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weathercode&timezone=auto`,
    )
    if (!w.ok)
      throw new Error(String(w.status))

    const d = await w.json()
    const tempC = d?.current?.temperature_2m
    const icon = getWeatherIcon(d?.current?.weathercode)

    return `${city} ${tempC}°C ${icon}`
  }
  catch {
    return null
  }
}

// ========= 保存 =========
async function handleSave() {
  const content = contentModel.value || ''
  let weather: string | null | undefined

  if (!props.isEditing)
    weather = await fetchWeatherLine()

  emit('save', content, weather)
}

// ============== 基础事件 ==============
function handleFocus() {
  emit('focus')
  captureCaret()
  requestAnimationFrame(ensureCaretVisibleInTextarea)
}
function onBlur() {
  emit('blur')
  if (suppressNextBlur.value) {
    suppressNextBlur.value = false
    return
  }
  if (blurTimeoutId)
    clearTimeout(blurTimeoutId)

  blurTimeoutId = window.setTimeout(() => {
    showTagSuggestions.value = false
  }, 200)
}
function handleClick() {
  captureCaret()
  requestAnimationFrame(ensureCaretVisibleInTextarea)
}

// —— 计算并展示“# 标签联想面板”
function computeAndShowTagSuggestions(el: HTMLTextAreaElement) {
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')
  if (lastHashIndex === -1 || /\s/.test(textBeforeCursor.substring(lastHashIndex + 1))) {
    showTagSuggestions.value = false
    return
  }

  const searchTerm = textBeforeCursor.substring(lastHashIndex + 1)
  const filtered = props.allTags
    .filter(tag => tag.toLowerCase().startsWith(`#${searchTerm.toLowerCase()}`))
    .sort((a, b) => {
      const ap = isPinned(a) ? 0 : 1
      const bp = isPinned(b) ? 0 : 1
      if (ap !== bp)
        return ap - bp

      return a.slice(1).toLowerCase().localeCompare(b.slice(1).toLowerCase())
    })

  tagSuggestions.value = filtered
  if (!tagSuggestions.value.length) {
    showTagSuggestions.value = false
    return
  }

  // 定位在“光标下一行”
  const wrapper = el.parentElement as HTMLElement
  const style = getComputedStyle(el)
  const lineHeight = Number.parseFloat(style.lineHeight || '20')
  const GAP = 6

  const mirror = document.createElement('div')
  mirror.style.cssText = `
    position:absolute; visibility:hidden; white-space:pre-wrap; word-wrap:break-word; overflow-wrap:break-word;
    box-sizing:border-box; top:0; left:0; width:${el.clientWidth}px;
    font:${style.font}; line-height:${style.lineHeight}; letter-spacing:${style.letterSpacing};
    padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft};
    border-width:${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth};
    border-style:solid;
  `
  wrapper.appendChild(mirror)

  const selEnd = el.selectionEnd ?? el.value.length
  const before = el.value.slice(0, selEnd)
    .replace(/\n$/u, '\n ')
    .replace(/ /g, '\u00A0')
  const probe = document.createElement('span')
  probe.textContent = '\u200B'
  mirror.textContent = before
  mirror.appendChild(probe)

  const probeRect = probe.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()

  const caretX = (probeRect.left - wrapperRect.left) - (el.scrollLeft || 0)
  const caretY = (probeRect.top - wrapperRect.top) - (el.scrollTop || 0)
  mirror.remove()

  const textAreaBox = {
    top: elRect.top - wrapperRect.top,
    left: elRect.left - wrapperRect.left,
    bottom: elRect.bottom - wrapperRect.top,
    width: el.clientWidth,
    height: el.clientHeight,
  }

  const top = caretY + lineHeight + GAP
  let left = caretX

  suggestionsStyle.value = { top: `${top}px`, left: `${left}px` }
  showTagSuggestions.value = true

  nextTick(() => {
    const panel = wrapper.querySelector('.tag-suggestions') as HTMLElement | null
    if (!panel)
      return

    const panelW = panel.offsetWidth
    const panelH = panel.offsetHeight

    if (left + panelW > textAreaBox.left + textAreaBox.width)
      left = Math.max(textAreaBox.left, textAreaBox.left + textAreaBox.width - panelW)

    const overflow = (top + panelH) - textAreaBox.bottom
    if (overflow > 0) {
      const need = overflow + 8
      const newScrollTop = Math.min(el.scrollTop + need, el.scrollHeight - el.clientHeight)
      if (newScrollTop !== el.scrollTop) {
        el.scrollTop = newScrollTop
        requestAnimationFrame(() => {
          computeAndShowTagSuggestions(el)
        })
        return
      }
    }

    suggestionsStyle.value = { top: `${top}px`, left: `${left}px` }
  })
}

function handleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  captureCaret()
  computeAndShowTagSuggestions(el)
}

// ============== 文本与工具栏 ==============
function updateTextarea(newText: string, newCursorPos?: number) {
  input.value = newText
  nextTick(() => {
    const el = textarea.value
    if (el) {
      el.focus()
      if (newCursorPos !== undefined)
        el.setSelectionRange(newCursorPos, newCursorPos)

      captureCaret()
      ensureCaretVisibleInTextarea()
    }
  })
}
function insertText(prefix: string, suffix = '') {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const end = el.selectionEnd
  const selectedText = el.value.substring(start, end)
  const newTextFragment = `${prefix}${selectedText}${suffix}`
  const finalFullText = el.value.substring(0, start) + newTextFragment + el.value.substring(end)
  const newCursorPos = selectedText ? start + newTextFragment.length : start + prefix.length

  if (blurTimeoutId) {
    clearTimeout(blurTimeoutId)
    blurTimeoutId = null
  }

  updateTextarea(finalFullText, newCursorPos)
}
function runToolbarAction(fn: () => void) {
  fn()
  nextTick(() => {
    const el = textarea.value
    if (el)
      el.focus()

    captureCaret()
  })
}
function addHeading() {
  insertText('## ', '')
}
function addBold() {
  insertText('**', '**')
}
function addUnderline() {
  insertText('++', '++')
}
function addBulletList() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const textToInsert = '- '
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)
  const newCursorPos = start + textToInsert.length
  updateTextarea(finalFullText, newCursorPos)
}
function addMarkHighlight() {
  insertText('==', '==')
}
function addTodo() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const textToInsert = '- [ ] '
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)
  const newCursorPos = start + textToInsert.length
  updateTextarea(finalFullText, newCursorPos)
}
function addOrderedList() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const textToInsert = '1. '
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)
  const newCursorPos = start + textToInsert.length
  updateTextarea(finalFullText, newCursorPos)
}

function handleEnterKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' || isComposing.value)
    return

  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const end = el.selectionEnd
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const currentLine = el.value.substring(currentLineStart, start)

  const orderedRe = /^(\d+)\.\s+/
  const orderedMatch = currentLine.match(orderedRe)
  const todoRe = /^-\s\[\s?\]\s+/
  const bulletRe = /^(-|\*|\+)\s+/
  const todoMatch = currentLine.match(todoRe)
  const bulletMatch = currentLine.match(bulletRe)

  if (!orderedMatch && !todoMatch && !bulletMatch)
    return

  event.preventDefault()

  const onlyPrefix
    = (orderedMatch && currentLine.trim() === orderedMatch[0].trim())
    || (todoMatch && currentLine.trim() === todoMatch[0].trim())
    || (bulletMatch && currentLine.trim() === bulletMatch[0].trim())

  if (onlyPrefix) {
    const before = el.value.substring(0, currentLineStart - 1)
    const after = el.value.substring(end)
    updateTextarea(before + after, currentLineStart - 1)
    return
  }

  if (orderedMatch) {
    const currentNumber = Number.parseInt(orderedMatch[1], 10)
    const nextPrefix = `\n${currentNumber + 1}. `
    const before2 = el.value.substring(0, start)
    const after2 = el.value.substring(end)
    updateTextarea(before2 + nextPrefix + after2, start + nextPrefix.length)
    return
  }

  if (todoMatch) {
    const nextPrefix = `\n- [ ] `
    const before2 = el.value.substring(0, start)
    const after2 = el.value.substring(end)
    updateTextarea(before2 + nextPrefix + after2, start + nextPrefix.length)
    return
  }

  if (bulletMatch) {
    const symbol = bulletMatch[1] || '-'
    const nextPrefix = `\n${symbol} `
    const before2 = el.value.substring(0, start)
    const after2 = el.value.substring(end)
    updateTextarea(before2 + nextPrefix + after2, start + nextPrefix.length)
  }
}

// —— 选择标签：使用 lastSelectionStart，稳定替换“#片段”
function selectTag(tag: string) {
  const el = textarea.value
  if (!el)
    return

  const value = el.value
  const cursorPos = Number.isFinite(lastSelectionStart.value)
    ? Math.min(Math.max(lastSelectionStart.value, 0), value.length)
    : value.length

  const hashIndex = value.lastIndexOf('#', Math.max(cursorPos - 1, 0))

  let replaceFrom = -1
  if (hashIndex >= 0) {
    const between = value.slice(hashIndex + 1, cursorPos)
    if (!/\s/.test(between))
      replaceFrom = hashIndex
  }

  const textAfterCursor = value.slice(cursorPos)
  let newText = ''
  let newCursorPos = 0

  if (replaceFrom >= 0) {
    newText = `${value.slice(0, replaceFrom)}${tag} ${textAfterCursor}`
    newCursorPos = replaceFrom + tag.length + 1
  }
  else {
    newText = `${value.slice(0, cursorPos)}${tag} ${value.slice(cursorPos)}`
    newCursorPos = cursorPos + tag.length + 1
  }

  updateTextarea(newText, newCursorPos)

  showTagSuggestions.value = false
  nextTick(() => {
    const el2 = textarea.value
    if (el2) {
      el2.focus()
      el2.setSelectionRange(newCursorPos, newCursorPos)
      captureCaret()
      ensureCaretVisibleInTextarea()
    }
  })
}

// —— 点击工具栏“#”：注入 # 并弹出联想面板
function openTagMenu() {
  suppressNextBlur.value = true
  runToolbarAction(() => {
    insertText('#', '')
  })
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = textarea.value
      if (el) {
        captureCaret()
        computeAndShowTagSuggestions(el)
      }
      suppressNextBlur.value = false
    })
  })
}

// —— 样式弹层定位（固定在 Aa 上方）
function placeFormatPalette() {
  const btn = formatBtnRef.value
  const root = rootRef.value
  const panel = formatPaletteRef.value
  if (!btn || !root || !panel)
    return

  const btnRect = btn.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const gap = 8
  const panelH = panel.offsetHeight || 0
  const top = (btnRect.top - rootRect.top) - panelH - gap
  const left = (btnRect.left - rootRect.left) + btnRect.width / 2
  formatPalettePos.value = { top: `${Math.max(top, 0)}px`, left: `${left}px` }
}
let paletteFollowRaf: number | null = null
function startPaletteFollowLoop() {
  stopPaletteFollowLoop()
  const loop = () => {
    if (showFormatPalette.value) {
      placeFormatPalette()
      paletteFollowRaf = requestAnimationFrame(loop)
    }
  }
  paletteFollowRaf = requestAnimationFrame(loop)
}
function stopPaletteFollowLoop() {
  if (paletteFollowRaf != null) {
    cancelAnimationFrame(paletteFollowRaf)
    paletteFollowRaf = null
  }
}
function openFormatPalette() {
  showFormatPalette.value = true
  nextTick(() => {
    placeFormatPalette()
    startPaletteFollowLoop()
  })
}
function closeFormatPalette() {
  showFormatPalette.value = false
  stopPaletteFollowLoop()
}
function toggleFormatPalette() {
  if (showFormatPalette.value)
    closeFormatPalette()
  else
    openFormatPalette()
}
function handleFormat(fn: () => void) {
  runToolbarAction(fn)
  closeFormatPalette()
}
function onWindowScrollOrResize() {
  if (showFormatPalette.value)
    placeFormatPalette()
}
onMounted(() => {
  window.addEventListener('scroll', onWindowScrollOrResize, true)
  window.addEventListener('resize', onWindowScrollOrResize)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onWindowScrollOrResize, true)
  window.removeEventListener('resize', onWindowScrollOrResize)
})

// —— 点击外部 & ESC 关闭格式面板
function onGlobalPointerDown(e: Event) {
  if (!showFormatPalette.value)
    return

  const btn = formatBtnRef.value
  const panel = formatPaletteRef.value
  if (!btn || !panel)
    return

  const target = e.target as Node
  if (btn.contains(target) || panel.contains(target))
    return

  closeFormatPalette()
}
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showFormatPalette.value)
    closeFormatPalette()
}
onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown, { capture: true })
  window.addEventListener('keydown', onGlobalKeydown)
})
onUnmounted(() => {
  // @ts-expect-error TS 对第三参类型收窄
  window.removeEventListener('pointerdown', onGlobalPointerDown, { capture: true })
  window.removeEventListener('keydown', onGlobalKeydown)
})

// —— 插入图片链接（记忆域名前缀）
const LAST_IMAGE_URL_PREFIX_KEY = 'note_image_url_prefix_v1'
function getLastPrefix() {
  try {
    const v = localStorage.getItem(LAST_IMAGE_URL_PREFIX_KEY)
    return v || 'https://'
  }
  catch {
    return 'https://'
  }
}
function looksLikeImage(urlText: string) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(urlText)
}
function savePrefix(urlText: string) {
  try {
    const u = new URL(urlText)
    let prefix = ''
    if (looksLikeImage(urlText)) {
      const dir = u.pathname.replace(/[^/]+$/u, '')
      prefix = `${u.origin}${dir}`
    }
    else {
      const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`
      prefix = `${u.origin}${path}`
    }
    localStorage.setItem(LAST_IMAGE_URL_PREFIX_KEY, prefix)
  }
  catch {
    // ignore
  }
}
function insertImageLink() {
  const valRef = ref(getLastPrefix())
  const errorRef = ref<string | null>(null)
  dialog.create({
    title: '插入图片链接',
    positiveText: '插入',
    negativeText: '取消',
    content: () =>
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;' }, [
        h(NInput, {
          'value': valRef.value,
          'placeholder': 'https://example.com/image.jpg 或分享链接',
          'onUpdate:value': (v: string) => {
            valRef.value = v
            errorRef.value = null
          },
          'autofocus': true,
          'clearable': true,
          'inputProps': { style: 'font-size:16px;' },
        }),
        errorRef.value
          ? h('div', { style: 'color:#dc2626;font-size:12px;' }, errorRef.value)
          : null,
      ]),
    onPositiveClick: () => {
      const raw = (valRef.value || '').trim()
      if (!raw) {
        errorRef.value = '请输入链接'
        return false
      }
      if (!/^https?:\/\//i.test(raw)) {
        errorRef.value = '必须以 http:// 或 https:// 开头'
        return false
      }
      savePrefix(raw)
      const text = looksLikeImage(raw) ? '图片（直链）' : '（点击查看图片）'
      insertText(`[${text}](${raw})`)
      return true
    },
  })
}

defineExpose({ reset: triggerResize })
</script>

<template>
  <div ref="rootRef" class="note-editor-reborn" :class="[isEditing ? 'editing-viewport' : '']">
    <div class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :class="`font-size-${settingsStore.noteFontSize}`"
        :placeholder="placeholder"
        @focus="handleFocus"
        @blur="onBlur"
        @click="handleClick"
        @keydown="captureCaret"
        @keyup="captureCaret"
        @mouseup="captureCaret"
        @keydown.enter="handleEnterKey"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
        @input="handleInput"
      />
      <div
        v-if="showTagSuggestions && tagSuggestions.length"
        class="tag-suggestions"
        :style="suggestionsStyle"
      >
        <ul>
          <li v-for="tag in tagSuggestions" :key="tag" @mousedown.prevent="selectTag(tag)">
            <span class="tag-text">{{ tag }}</span>
            <span v-if="isPinned(tag)" class="tag-star">★</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- 底部工具栏：键盘开= fixed；键盘关= sticky -->
    <div class="editor-footer" :class="{ fixed: isImeOpen }">
      <div class="footer-left">
        <div class="editor-toolbar">
          <!-- # 标签 -->
          <button
            type="button"
            class="toolbar-btn"
            title="添加标签"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="openTagMenu"
          >
            #
          </button>

          <!-- 待办 ✓ -->
          <button
            type="button"
            class="toolbar-btn"
            title="待办事项"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addTodo)"
          >
            <svg class="icon-20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6" />
              <path d="M7 12l4 4 6-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <!-- 样式(Aa) -->
          <button
            ref="formatBtnRef"
            type="button"
            class="toolbar-btn toolbar-btn-aa"
            title="样式"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="toggleFormatPalette"
          >
            Aa
          </button>

          <!-- 插入图片链接 -->
          <button
            type="button"
            class="toolbar-btn"
            title="插入图片链接"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="insertImageLink"
          >
            <svg class="icon-20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.6" />
              <circle cx="9" cy="9" r="1.6" fill="currentColor" />
              <path d="M6 17l4.2-4.2a1.5 1.5 0 0 1 2.1 0L17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M13.5 13.5 18 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <span class="toolbar-sep" aria-hidden="true" />
        </div>
        <span class="char-counter">{{ charCount }}</span>
      </div>

      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="emit('cancel')">取消</button>
        <button type="button" class="btn-primary" :disabled="isLoading || !contentModel" @click="handleSave">保存</button>
      </div>
    </div>

    <!-- 样式弹层（更小、更贴 Aa） -->
    <div
      v-if="showFormatPalette"
      ref="formatPaletteRef"
      class="format-palette"
      :style="{ top: formatPalettePos.top, left: formatPalettePos.left }"
      @mousedown.prevent
    >
      <div class="format-row">
        <button type="button" class="format-btn" title="加粗" @click="handleFormat(addBold)">B</button>
        <button type="button" class="format-btn" title="数字列表" @click="handleFormat(addOrderedList)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <text x="4.4" y="8" font-size="7" fill="currentColor">1</text>
            <text x="4.0" y="13" font-size="7" fill="currentColor">2</text>
            <text x="4.0" y="18" font-size="7" fill="currentColor">3</text>
            <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" class="format-btn" title="标题" @click="handleFormat(addHeading)">H</button>
        <button type="button" class="format-btn" title="下划线" @click="handleFormat(addUnderline)">U</button>
        <button type="button" class="format-btn" title="无序列表" @click="handleFormat(addBulletList)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="6" cy="7" r="2" fill="currentColor" />
            <circle cx="6" cy="12" r="2" fill="currentColor" />
            <circle cx="6" cy="17" r="2" fill="currentColor" />
            <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" class="format-btn" title="高亮（==文本==）" @click="handleFormat(addMarkHighlight)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6" />
            <text x="8" y="16" font-size="10" font-family="sans-serif" font-weight="bold" fill="currentColor">T</text>
          </svg>
        </button>
      </div>
      <div class="format-caret" />
    </div>
  </div>
</template>

<style scoped>
.note-editor-reborn {
  position: relative;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.note-editor-reborn:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.1);
}
.dark .note-editor-reborn {
  background-color: #2c2c2e;
  border-color: #48484a;
}
.dark .note-editor-reborn:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.2);
}

/* 让 wrapper 成为滚动容器，textarea 不单独滚动 */
.editor-wrapper {
  position: relative;
  overflow: auto;
  /* 预留底部工具栏空间（键盘收起时），避免最后一行被遮挡 */
  padding-bottom: calc(var(--editor-footer-h, 44px) + max(8px, env(safe-area-inset-bottom)));
}

.editor-textarea {
  width: 100%;
  min-height: 40px;
  /* 重要：交给 .editor-wrapper 滚动，避免 caret 跳动 */
  max-height: none;
  overflow-y: visible;

  padding: 12px 8px 0px 16px;
  border: none;
  background-color: transparent;
  color: inherit;
  line-height: 1.6;
  resize: none;
  outline: 0;
  box-sizing: border-box;
  font-family: inherit;
  caret-color: currentColor;
  scrollbar-gutter: stable both-edges;
}

.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }

.char-counter {
  font-size: 12px;
  color: #6b7280;
}
.dark .char-counter { color: #9ca3af; }

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.btn-primary {
  background-color: #00b386;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-primary:hover { background-color: #009a74; }
.btn-primary:disabled { background-color: #a5a5a5; cursor: not-allowed; opacity: 0.7; }

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-secondary:hover { background-color: #e0e0e0; }
.dark .btn-secondary { background-color: #4b5563; color: #fff; border-color: #555; }
.dark .btn-secondary:hover { background-color: #5a6676; }

/* 工具栏（键盘收起：sticky；键盘开启：fixed） */
.editor-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  height: var(--editor-footer-h, 44px);
  padding: 4px 12px max(4px, env(safe-area-inset-bottom)) 12px;
  background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.02));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.editor-footer.fixed {
  position: fixed;
  /* 居中并限制宽度，与你页面的 480px 卡片一致 */
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 100vw - 32px);
  /* 关键：把底边贴到键盘上沿（由 JS 写入 --kb-offset） */
  bottom: calc(var(--kb-offset, 0px) + env(safe-area-inset-bottom));
  z-index: 9999;
}

/* 深色模式的轻微背景区分 */
.dark .editor-footer,
.dark .editor-footer.fixed {
  background: linear-gradient(to bottom, rgba(0,0,0,0.0), rgba(0,0,0,0.12));
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 工具栏按钮间距（保持你之前 8px 的手感） */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  padding: 0;
}

.toolbar-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: #6b7280;
  border-radius: 4px;
  font-weight: bold;
  font-size: 18px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;
}
.toolbar-btn:hover { background-color: #f0f0f0; color: #333; }
.dark .toolbar-btn { color: #9ca3af; }
.dark .toolbar-btn:hover { background-color: #404040; color: #f0f0f0; }

.toolbar-btn-aa {
  font-size: 16px;
  font-weight: 600;
  width: 26px;
}

.toolbar-sep {
  display: inline-block;
  width: 1px;
  height: 16px;
  margin-left: 6px;
  background-color: rgba(0,0,0,0.08);
}
.dark .toolbar-sep { background-color: rgba(255,255,255,0.18); }

/* ======= 样式弹层（紧贴 Aa 上方） ======= */
.format-palette {
  position: absolute;
  z-index: 1100;
  transform: translateX(-50%);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 2px 4px;
}
.dark .format-palette {
  background: #2c2c2e;
  border-color: #3f3f46;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.format-row { display: flex; align-items: center; gap: 6px; }
.format-btn {
  width: 24px; height: 24px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: inherit;
  font-weight: 700; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.format-btn:hover { background: rgba(0,0,0,0.06); }
.dark .format-btn:hover { background: rgba(255,255,255,0.08); }
.format-caret {
  position: absolute; left: 50%; transform: translate(-50%, 3px) rotate(45deg);
  bottom: -3px; width: 6px; height: 6px; background: inherit;
  border-left: 1px solid inherit; border-bottom: 1px solid inherit;
}

/* 让 Aa 面板里的图标“视觉放大”，但按钮仍是 24×24 */
.format-btn { overflow: visible; }
.format-btn .icon-bleed {
  width: 40px !important; height: 40px !important;
  display: block; margin: -5px !important; pointer-events: none;
}

/* 标签联想 */
.tag-suggestions {
  position: absolute;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 150px;
  overflow-y: auto;
  min-width: 120px;
}
.dark .tag-suggestions { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li { padding: 6px 12px; cursor: pointer; font-size: 14px; }
.tag-suggestions li:hover { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover { background-color: #404040; }

.tag-suggestions li { display: flex; align-items: center; justify-content: space-between; }
.tag-suggestions .tag-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-suggestions .tag-star { opacity: 0.7; margin-left: 8px; font-size: 12px; color: #999; }

/* 编辑态占位高度策略（保持原有） */
.note-editor-reborn.editing-viewport .editor-wrapper {
  flex: 1 1 auto;
  overflow: auto;
}
.note-editor-reborn.editing-viewport {
  height: 70dvh;
  min-height: 70dvh;
  max-height: 70dvh;
  display: flex;
  flex-direction: column;
}
@supports not (height: 1dvh) {
  .note-editor-reborn.editing-viewport {
    height: 70vh;
    min-height: 70vh;
    max-height: 70vh;
  }
}
.note-editor-reborn.editing-viewport .editor-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}
.note-editor-reborn.editing-viewport .editor-textarea {
  flex: 1 1 auto;
  min-height: 0;
  height: 100% !important;
  max-height: none !important;
  overflow-y: auto;
}

/* 小图标尺寸 */
.icon-20 { width: 20px; height: 20px; display: block; }
</style>
