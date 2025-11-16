<script setup lang="ts">
import { computed, defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'
import { useDialog } from 'naive-ui'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// —— 天气映射（用于城市名映射与图标）——
import { cityMap, weatherMap } from '@/utils/weatherMap'

// ============== Props & Emits ==============
const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 20000 },
  placeholder: { type: String, default: '写点什么...' },
  allTags: { type: Array as () => string[], default: () => [] },
  tagCounts: {
    type: Object as () => Record<string, number>,
    default: () => ({}),
  },

  // ===== 仅用于“简单自动草稿”的开关与键（新增）=====
  enableDrafts: { type: Boolean, default: false },
  // 不传就用一个安全的默认键；你也可以在父组件传一个自定义 key
  draftKey: { type: String, default: '' },
  // 是否在点击保存按钮后立即清理草稿（默认 false，避免误删）
  clearDraftOnSave: { type: Boolean, default: false },
  enableScrollPush: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'focus', 'blur', 'bottomSafeChange'])
const dialog = useDialog()
const draftStorageKey = computed(() => {
  if (!props.enableDrafts)
    return null
  // 优先使用父组件传入的 draftKey；否则根据 isEditing 给一个稳定的默认值
  return props.draftKey || (props.isEditing ? 'note_draft_edit' : 'note_draft_new')
})
// —— 常用标签（与 useTagMenu 保持同一存储键）——
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

const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

// 平台判定（尽量保守）
const UA = navigator.userAgent.toLowerCase()
const isIOS = /iphone|ipad|ipod/.test(UA)

// iOS：仅“首次输入”需要一点额外冗余，露出后立刻关闭
const iosFirstInputLatch = ref(false)

const isAndroid = /Android|Adr/i.test(navigator.userAgent)

const isFreezingBottom = ref(false)

// 手指按下：进入“选择/拖动”冻结期（两端都适用）
function onTextPointerDown() {
  isFreezingBottom.value = true
}

// 手指移动：保持冻结（避免过程中的抖动）
function onTextPointerMove() {
  // 保持监听，避免在拖动过程中触发布局重算；
  // 不需要显式 return，防止 no-useless-return
}

// 手指抬起/取消：退出冻结，并在下一帧 + 稍后各补算一次
function onTextPointerUp() {
  isFreezingBottom.value = false
  requestAnimationFrame(() => {
    recomputeBottomSafePadding()
  })
  window.setTimeout(() => {
    recomputeBottomSafePadding()
  }, 120)
}
// ============== Store ==============
const settingsStore = useSettingStore()

// ============== v-model ==============
const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })
// —— 进入编辑时把光标聚焦到末尾（并做一轮滚动/安全区校准）
async function focusToEnd() {
  await nextTick()
  const el = textarea.value
  if (!el)
    return

  el.focus()

  const len = el.value.length
  try {
    el.setSelectionRange(len, len)
  }
  catch {}

  try {
    triggerResize?.()
  }
  catch {}

  requestAnimationFrame(() => {
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
  })
}

// ===== 简单自动草稿 =====
let draftTimer: number | null = null
const DRAFT_SAVE_DELAY = 400 // ms

function loadDraft() {
  if (!props.enableDrafts)
    return
  const key = draftStorageKey.value
  if (!key)
    return

  try {
    const raw = localStorage.getItem(key)
    if (!raw)
      return
    // 兼容两种格式：纯字符串或 JSON 包 content 字段
    let text = ''
    try {
      const obj = JSON.parse(raw)
      text = typeof obj?.content === 'string' ? obj.content : ''
    }
    catch {
      text = raw
    }
    if (text && text !== contentModel.value) {
      emit('update:modelValue', text)
      // 如果你用了 autosize，触发一下
      try {
        triggerResize?.()
      }
      catch {
        // noop
      }
    }
  }
  catch (e) {
    console.warn('[NoteEditor] 读取草稿失败：', e)
  }
}
// --- 安全触发文件选择 ---
const imageInputRef = ref<HTMLInputElement | null>(null)

function onPickImageSync() {
  // 👇 一定要同步执行，不要有 await / setTimeout / nextTick 在它前面
  const el = imageInputRef.value
  if (!el)
    return
  // 允许连续选择同一文件
  el.value = ''
  el.click()
}

async function onImageChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file)
    return

  try {
    // 1) 原图体积兜底（防止误选超大原片）
    const MAX_ORIGIN_MB = 25
    if (file.size > MAX_ORIGIN_MB * 1024 * 1024) {
      dialog.warning({
        title: t('notes.upload.too_large_title'),
        content: t('notes.upload.too_large_content', { max: MAX_ORIGIN_MB }),
        positiveText: t('notes.upload.ok'),
      })
      return
    }

    // 2) ≤150KB 直接用原图；否则产出候选并择优
    const MAX_SKIP_BYTES = 150 * 1024
    const shouldSkip = file.size <= MAX_SKIP_BYTES

    const inferExt = (mime = '') => {
      const m = mime.toLowerCase()
      if (m.includes('png'))
        return 'png'
      if (m.includes('jpeg') || m.includes('jpg'))
        return 'jpg'
      if (m.includes('webp'))
        return 'webp'
      if (m.includes('gif'))
        return 'gif'
      if (m.includes('bmp'))
        return 'bmp'
      if (m.includes('svg'))
        return 'svg'
      return 'bin'
    }

    const candidateOriginal: { blob: Blob; ext: string; type: string } = {
      blob: file,
      ext: inferExt(file.type || ''),
      type: file.type || 'application/octet-stream',
    }
    let candidateWebp: { blob: Blob; ext: string; type: string } | null = null
    let candidateJpeg: { blob: Blob; ext: string; type: string } | null = null

    if (!shouldSkip) {
      // WebP 压缩（1080×1080，质量 0.6）
      const webpBlob = await compressToWebp(file, 1080, 1080, 0.6)
      candidateWebp = { blob: webpBlob, ext: 'webp', type: 'image/webp' }

      // 仅对“照片类”再试 JPEG（通常对照片更友好）
      const origType = (file.type || '').toLowerCase()
      const photoLike = origType.includes('jpeg') || origType.includes('jpg') || origType.includes('webp')
      if (photoLike) {
        const jpegBlob = await compressToJpeg(file, 1080, 1080, 0.82)
        // 如果 JPEG 比原图还大，就不要纳入候选
        if (jpegBlob.size < candidateOriginal.blob.size)
          candidateJpeg = { blob: jpegBlob, ext: 'jpg', type: 'image/jpeg' }
      }
    }

    // 3) 从候选中选择“最小体积”，但不允许比原图大（几乎不变时也回退原图）
    const candidates = [candidateOriginal, candidateWebp, candidateJpeg].filter(Boolean) as {
      blob: Blob
      ext: string
      type: string
    }[]
    let best = candidates[0]
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i]
      if (c.blob.size < best.blob.size)
        best = c
    }
    const notWorthIt = best.blob.size >= candidateOriginal.blob.size * 0.98
    if (notWorthIt)
      best = candidateOriginal

    // 4) 最终体积兜底（≤2MB）
    const MAX_FINAL_MB = 2
    const maxBytes = MAX_FINAL_MB * 1024 * 1024
    if (best.blob.size > maxBytes) {
      dialog.warning({
        title: t('notes.upload.too_large_title'),
        content: t('notes.upload.too_large_content', { max: MAX_FINAL_MB }),
        positiveText: t('notes.upload.ok'),
      })
      return
    }

    // 5) 上传并插入
    const url = await uploadImageToSupabase(best.blob, best.ext, best.type)
    insertText(`![](${url})`, '')
    dialog.success({
      title: t('notes.upload.success_title'),
      content: t('notes.upload.success_content'),
      positiveText: t('notes.upload.ok'),
    })
  }
  catch (err: any) {
    dialog.error({
      title: t('notes.upload.error_title'),
      content: err?.message || t('notes.upload.error_content'),
      positiveText: t('notes.upload.ok'),
    })
  }
  finally {
    // 允许连续选择同一张图片
    if (imageInputRef.value)
      imageInputRef.value.value = ''
  }
}
// ========== 图片压缩与上传：纯前端，无第三方库 ==========

// 读取 File -> HTMLImageElement
async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    return img
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

// 以最大边限制 + 质量压缩为 WebP（默认最长边 1600，质量 0.82）
async function compressToWebp(file: File, maxW = 1600, maxH = 1600, quality = 0.6): Promise<Blob> {
  const img = await fileToImage(file)

  const { width, height } = img
  const ratio = Math.min(maxW / width, maxH / height, 1) // 只缩小不放大
  const targetW = Math.round(width * ratio)
  const targetH = Math.round(height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx)
    throw new Error('Canvas 2D context not available')
  // 在一些移动端上抗锯齿更稳
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetW, targetH)

  const webp = await new Promise<Blob>((resolve, reject) => {
    // iOS 14+ / 现代浏览器均支持 webp；若极端环境不支持，会返回 null
    canvas.toBlob((blob) => {
      if (!blob)
        return reject(new Error('Failed to encode WebP (browser may not support)'))
      resolve(blob)
    }, 'image/webp', quality)
  })
  return webp
}

// 以最大边限制 + 质量压缩为 JPEG（默认最长边 1080，质量 0.82）
async function compressToJpeg(file: File, maxW = 1080, maxH = 1080, quality = 0.82): Promise<Blob> {
  const img = await fileToImage(file)
  const width = img.width
  const height = img.height
  const ratio = Math.min(maxW / width, maxH / height, 1)
  const targetW = Math.round(width * ratio)
  const targetH = Math.round(height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx)
    throw new Error('Canvas 2D context not available')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetW, targetH)

  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob)
        return reject(new Error('Failed to encode JPEG'))
      resolve(blob)
    }, 'image/jpeg', quality)
  })
  return jpeg
}

// 生成存储路径：按用户与年月分目录，避免单目录过多文件
function buildImagePath(userId: string, ext = 'webp') {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const ts = d.getTime()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${userId}/${y}/${m}/${ts}_${rand}.${ext}`
}

// 通用上传：根据传入的 contentType 与扩展名保存
async function uploadImageToSupabase(blob: Blob, ext: string, contentType: string): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user)
    throw new Error('请先登录后再上传图片')
  const userId = userData.user.id

  const filePath = buildImagePath(userId, ext)
  const bucket = 'note-images'

  const { error: upErr } = await supabase
    .storage
    .from(bucket)
    .upload(filePath, blob, { contentType, upsert: false })
  if (upErr)
    throw upErr

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(filePath)
  if (pub?.publicUrl)
    return pub.publicUrl

  const { data: signed, error: sErr } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(filePath, 60 * 60 * 24 * 365)
  if (sErr || !signed?.signedUrl)
    throw new Error('获取图片 URL 失败')
  return signed.signedUrl
}

function saveDraft() {
  if (!props.enableDrafts)
    return
  const key = draftStorageKey.value
  if (!key)
    return
  try {
    // 存 JSON，后续扩展更安全
    const payload = JSON.stringify({ content: contentModel.value || '' })
    localStorage.setItem(key, payload)
  }
  catch (e) {
    console.warn('[NoteEditor] 保存草稿失败：', e)
  }
}

function clearDraft() {
  const key = draftStorageKey.value
  if (!key)
    return
  try {
    localStorage.removeItem(key)
  }
  catch {
    // noop
  }
}

// 初次挂载：尝试恢复
onMounted(() => {
  loadDraft()
})

// 内容变化：400ms 节流保存
watch(() => contentModel.value, () => {
  if (!props.enableDrafts)
    return
  if (draftTimer)
    window.clearTimeout(draftTimer)

  draftTimer = window.setTimeout(() => {
    saveDraft()
    draftTimer = null
  }, DRAFT_SAVE_DELAY) as unknown as number
})

// 进入编辑态：把光标移到末端并聚焦
watch(() => props.isEditing, (v) => {
  if (v)
    focusToEnd()
})

// 如果组件一挂载就处于编辑态，也执行一次
onMounted(() => {
  if (props.isEditing)
    focusToEnd()
})

// 组件卸载：收尾
onUnmounted(() => {
  if (draftTimer) {
    window.clearTimeout(draftTimer)
    draftTimer = null
  }
})

// ============== Autosize ==============
const charCount = computed(() => contentModel.value.length)

// ===== 超长提示：超过 maxNoteLength 弹出一次警告 =====
const overLimitWarned = ref(false)

watch([charCount, () => props.maxNoteLength], ([len, max]) => {
  if (len > max && !overLimitWarned.value) {
    overLimitWarned.value = true
    dialog.warning({
      title: t('notes.editor.char_limit_title'),
      content: t('notes.editor.char_limit_content', { max }),
      positiveText: t('notes.ok'),
      onAfterLeave: () => {},
    })
  }
  else if (len <= max && overLimitWarned.value) {
    overLimitWarned.value = false
  }
})

// ============== 状态与响应式变量 ==============
const isComposing = ref(false)
const isSubmitting = ref(false)
const suppressNextBlur = ref(false)
let blurTimeoutId: number | null = null
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

// —— 格式弹层（B / 1. / H / I / • / 🖊️）
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

watch(() => props.isLoading, (newValue) => {
  if (newValue === false)
    isSubmitting.value = false
})

// ============== 滚动校准 ==============
function ensureCaretVisibleInTextarea() {
  if (isFreezingBottom.value)
    return
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

function _getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node
  while (el) {
    const s = getComputedStyle(el)
    const canScroll
      = /(auto|scroll|overlay)/.test(s.overflowY)
      || /(auto|scroll|overlay)/.test(s.overflow)
    if (canScroll && el.scrollHeight > el.clientHeight)
      return el
    el = el.parentElement
  }
  return null
}

function getFooterHeight(): number {
  const root = rootRef.value
  const footerEl = root ? (root.querySelector('.editor-footer') as HTMLElement | null) : null
  return footerEl ? footerEl.offsetHeight : 88 // 兜底
}

let _hasPushedPage = false // 只在“刚被遮挡”时推一次，避免抖
let _lastBottomNeed = 0

function recomputeBottomSafePadding() {
  if (!isMobile) {
    emit('bottomSafeChange', 0)
    return
  }
  if (isFreezingBottom.value)
    return

  const el = textarea.value
  if (!el) {
    emit('bottomSafeChange', 0)
    return
  }

  const vv = window.visualViewport
  if (!vv) {
    emit('bottomSafeChange', 0)
    _hasPushedPage = false
    return
  }

  const keyboardHeight = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
  if (!isAndroid && keyboardHeight < 60) {
    emit('bottomSafeChange', 0)
    _hasPushedPage = false
    return
  }

  const style = getComputedStyle(el)
  const lineHeight = Number.parseFloat(style.lineHeight || '20') || 20

  const caretYInContent = (() => {
    const mirror = document.createElement('div')
    mirror.style.cssText
      = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;'
      + `box-sizing:border-box;top:0;left:-9999px;width:${el.clientWidth}px;`
      + `font:${style.font};line-height:${style.lineHeight};letter-spacing:${style.letterSpacing};`
      + `padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft};`
      + `border-width:${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth};`
      + 'border-style:solid;'
    document.body.appendChild(mirror)
    const val = el.value
    const selEnd = el.selectionEnd ?? val.length
    mirror.textContent = val.slice(0, selEnd).replace(/\n$/u, '\n ').replace(/ /g, '\u00A0')
    const y = mirror.scrollHeight
    document.body.removeChild(mirror)
    return y
  })()

  const rect = el.getBoundingClientRect()
  const caretBottomInViewport
    = (rect.top - vv.offsetTop)
    + (caretYInContent - el.scrollTop)
    + (isAndroid ? lineHeight * 1.25 : lineHeight * 1.15) // iOS 抬高估值，避免被候选栏吃掉

  const caretBottomAdjusted = isAndroid
    ? (caretBottomInViewport + lineHeight * 2)
    : caretBottomInViewport

  const footerH = getFooterHeight()
  const EXTRA = isAndroid ? 28 : (iosFirstInputLatch.value ? 48 : 32) // iOS 提高冗余量
  const safeInset = (() => {
    try {
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;bottom:0;left:0;height:0;padding-bottom:env(safe-area-inset-bottom);'
      document.body.appendChild(div)
      const px = Number.parseFloat(getComputedStyle(div).paddingBottom || '0')
      document.body.removeChild(div)
      return Number.isFinite(px) ? px : 0
    }
    catch { return 0 }
  })()
  const HEADROOM = isAndroid ? 60 : 70
  const SAFE = footerH + safeInset + EXTRA + HEADROOM

  const threshold = vv.height - SAFE
  const rawNeed = isAndroid
    ? Math.ceil(Math.max(0, caretBottomAdjusted - threshold))
    : Math.ceil(Math.max(0, caretBottomInViewport - threshold))

  // === 新增：迟滞/死区 + 最小触发步长 + 微抖动抑制 ===
  const DEADZONE = isAndroid ? 72 : 46 // 离底部还差这么多像素就先不托
  const MIN_STEP = isAndroid ? 24 : 14 // 小于这个像素的需要值不托，避免细碎抖动
  const STICKY = 12 // 微抖动抑制阈值

  let need = rawNeed - DEADZONE
  if (need < MIN_STEP)
    need = 0

  // 抑制小幅抖动：与上次差异很小时保持不变
  if (need > 0 && _lastBottomNeed > 0 && Math.abs(need - _lastBottomNeed) < STICKY)
    need = _lastBottomNeed

  _lastBottomNeed = need

  // 把需要的像素交给外层垫片（只有超过死区与步长才会非零）
  emit('bottomSafeChange', need)

  // —— Android 与 iOS 都只轻推“一次”，iOS 推得更温和 —— //
  if (need > 0) {
    if (!_hasPushedPage) {
      if (isAndroid) {
        const ratio = 1.6
        const cap = 420
        const delta = Math.min(Math.ceil(need * ratio), cap)
        if (props.enableScrollPush)
          window.scrollBy(0, delta) // ✅ 仅在开启时推页
      }
      else {
        const ratio = 0.35
        const cap = 80
        const delta = Math.min(Math.ceil(need * ratio), cap)
        if (delta > 0 && props.enableScrollPush)
          window.scrollBy(0, delta) // ✅ 仅在开启时推页
      }
      _hasPushedPage = true
      window.setTimeout(() => {
        _hasPushedPage = false
        recomputeBottomSafePadding()
      }, 140)
    }
    if (isIOS && iosFirstInputLatch.value)
      iosFirstInputLatch.value = false
  }
  else {
    _hasPushedPage = false
  }
}

// ========= 新建时写入天气：工具函数（从版本1移植） =========
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

    // ===== 1. 主动触发定位弹窗（仅第一次），成功则用 Geolocation =====
    const browserLoc = await getBrowserLocationWithPromptOnce(10000)

    if (browserLoc) {
      // 有精确坐标：基于坐标做反向地理编码拿城市名
      let cityFromGeo = await reverseGeocodeCityFromCoords(browserLoc.lat, browserLoc.lon)

      if (!cityFromGeo)
        cityFromGeo = '当前位置'

      loc = {
        city: cityFromGeo,
        lat: browserLoc.lat,
        lon: browserLoc.lon,
      }
    }
    else {
      // ===== 2. 用户拒绝 / 定位失败 / 超时：退回 IP 定位（行为跟原来一致） =====
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
    }

    if (!loc?.lat || !loc?.lon)
      throw new Error('定位失败')

    const city = getMappedCityName(loc.city)

    // ===== 3. 天气 =====
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weathercode&timezone=auto`,
    )
    if (!w.ok)
      throw new Error(String(w.status))
    const d = await w.json()
    const tempC = d?.current?.temperature_2m
    const icon = getWeatherIcon(d?.current?.weathercode)

    if (typeof tempC !== 'number')
      throw new Error('温度数据异常')

    // 只保留：城市 温度°C 图标（无文字）
    return `${city} ${tempC}°C ${icon}`
  }
  catch {
    return null
  }
}

const GEO_CONSENT_KEY = 'geo_consent_v1' // 'granted' | 'denied'

async function getBrowserLocationWithPromptOnce(timeoutMs = 10000): Promise<{ lat: number; lon: number } | null> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.geolocation)
    return null

  // 本地记一下用户在“本应用”里的选择：拒绝过就别再弹了
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(GEO_CONSENT_KEY)
  }
  catch {
    // localStorage 不可用时忽略
  }

  if (stored === 'denied')
    return null

  return new Promise((resolve) => {
    let done = false

    const finish = (value: { lat: number; lon: number } | null) => {
      if (done)
        return
      done = true
      resolve(value)
    }

    const timer = window.setTimeout(() => {
      // 超时就直接放弃本次定位，不再回退到 IP，避免“没等用户点就用 IP”
      finish(null)
    }, timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer)
        try {
          window.localStorage.setItem(GEO_CONSENT_KEY, 'granted')
        }
        catch {}

        finish({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        })
      },
      (err) => {
        window.clearTimeout(timer)

        // 用户明确点了“拒绝”
        // GeolocationPositionError.PERMISSION_DENIED === 1
        if (err && (err as GeolocationPositionError).code === 1) {
          try {
            window.localStorage.setItem(GEO_CONSENT_KEY, 'denied')
          }
          catch {}
        }

        finish(null)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5 * 60 * 1000,
        timeout: timeoutMs,
      },
    )
  })
}

async function reverseGeocodeCityFromCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })
    if (!r.ok)
      throw new Error(String(r.status))

    const data = await r.json()
    const addr = data?.address || {}

    // 从细到粗兜底：城市 > 镇 > 村 > 郡县
    const city
      = addr.city
      || addr.town
      || addr.village
      || addr.hamlet
      || addr.county
      || null

    return city
  }
  catch {
    return null
  }
}

// ========= 保存：不把天气写进正文；仅新建时生成一次，并作为第二参数传递 =========
async function handleSave() {
  // 1. 安全锁依然保留，防止重复提交
  if (props.isLoading || isSubmitting.value)
    return

  // 2. 立即将状态设为“提交中”，禁用按钮
  isSubmitting.value = true

  const content = contentModel.value || ''
  let weather: string | null = null // 默认天气为 null

  // 3. 仅在创建新笔记时尝试获取天气
  if (!props.isEditing) {
    try {
      // 尝试获取天气，如果成功，weather 会被赋值
      weather = await fetchWeatherLine()
    }
    catch (error) {
      // 如果获取天气失败，只在控制台打印一个警告，然后继续执行。
      // weather 的值将保持为 null，保存操作不会被中断。
      console.warn(t('notes.editor.save.weather_fetch_failed'), error)
    }
  }

  // 4. 无论天气是否获取成功，都发射 save 事件
  emit('save', content, weather)
  // ✅ 如果父组件愿意“点击保存就清草稿”，在 props.clearDraftOnSave = true 时清掉
  if (props.clearDraftOnSave)
    clearDraft()
}

// ============== 基础事件 ==============
let selectionIdleTimer: number | null = null

function onDocSelectionChange() {
  const el = textarea.value
  if (!el)
    return
  if (document.activeElement !== el)
    return
  if (isFreezingBottom.value)
    return
  if (selectionIdleTimer)
    window.clearTimeout(selectionIdleTimer)
  selectionIdleTimer = window.setTimeout(() => {
    captureCaret()
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
  }, 80)
}

onMounted(() => {
  document.addEventListener('selectionchange', onDocSelectionChange)
})
onUnmounted(() => {
  document.removeEventListener('selectionchange', onDocSelectionChange)
})

function handleFocus() {
  emit('focus')
  captureCaret()

  // 允许再次“轻推”
  _hasPushedPage = false

  // 用真实 footer 高度“临时托起”，不等 vv
  emit('bottomSafeChange', getFooterHeight())

  // 立即一轮计算
  requestAnimationFrame(() => {
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
  })

  // 覆盖 visualViewport 延迟：iOS 稍慢、Android 稍快
  const t1 = isIOS ? 120 : 80
  window.setTimeout(() => {
    recomputeBottomSafePadding()
  }, t1)

  const t2 = isIOS ? 260 : 180
  window.setTimeout(() => {
    recomputeBottomSafePadding()
  }, t2)

  // 启动短时“助推轮询”（iOS 尤其需要）
  startFocusBoost()
}

function onBlur() {
  emit('blur')
  emit('bottomSafeChange', 0)
  _hasPushedPage = false
  stopFocusBoost()
  _lastBottomNeed = 0

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
  if (isFreezingBottom.value)
    return

  // 新增：点击 textarea 任意位置时，若面板已打开则关闭
  if (showTagSuggestions.value)
    showTagSuggestions.value = false

  captureCaret()
  requestAnimationFrame(() => {
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
  })
}
// —— 计算并展示“# 标签联想面板”（智能决定在光标下方或上方，不够则限高）
function computeAndShowTagSuggestions(el: HTMLTextAreaElement) {
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')

  // 不在“#片段”内就隐藏
  if (lastHashIndex === -1 || /\s/.test(textBeforeCursor.substring(lastHashIndex + 1))) {
    showTagSuggestions.value = false
    return
  }

  const searchTerm = textBeforeCursor.substring(lastHashIndex + 1)
  const filtered = props.allTags
    .filter(tag => tag.toLowerCase().startsWith(`#${searchTerm.toLowerCase()}`))
    .sort((a, b) => {
      // 优先级1：常用标签 (Pinned) 永远最前
      const isAPinned = isPinned(a)
      const isBPinned = isPinned(b)
      if (isAPinned !== isBPinned)
        return isAPinned ? -1 : 1
      // 优先级2：按使用频率（笔记数量）降序
      const countA = props.tagCounts[a] || 0
      const countB = props.tagCounts[b] || 0
      if (countA !== countB)
        return countB - countA
      // 优先级3：频率相同则按字母序
      return a.slice(1).toLowerCase().localeCompare(b.slice(1).toLowerCase())
    })

  tagSuggestions.value = filtered
  if (!tagSuggestions.value.length) {
    showTagSuggestions.value = false
    return
  }

  // === 计算光标像素位置（相对 .editor-wrapper） ===
  const wrapper = el.parentElement as HTMLElement | null // .editor-wrapper（position: relative）
  if (!wrapper) {
    showTagSuggestions.value = false
    return
  }

  const style = getComputedStyle(el)
  const lineHeight = Number.parseFloat(style.lineHeight || '20') || 20
  const GAP = 6 // 面板与光标之间的额外间距

  // 用镜像元素拿到光标（选区末端）位置
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
  const before = el.value.slice(0, selEnd).replace(/\n$/u, '\n ').replace(/ /g, '\u00A0')
  const probe = document.createElement('span')
  probe.textContent = '\u200B' // 零宽探针当作光标点
  mirror.textContent = before
  mirror.appendChild(probe)

  const probeRect = probe.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const caretX = (probeRect.left - wrapperRect.left) - (el.scrollLeft || 0)
  const caretY = (probeRect.top - wrapperRect.top) - (el.scrollTop || 0)
  mirror.remove()

  // textarea 可视框（相对 wrapper）
  const textAreaBox = {
    top: elRect.top - wrapperRect.top,
    left: elRect.left - wrapperRect.left,
    right: elRect.right - wrapperRect.left,
    bottom: elRect.bottom - wrapperRect.top,
    width: el.clientWidth,
    height: el.clientHeight,
  }

  // 先按“下方”给一个初值并显示，以便下一帧拿到尺寸
  const initialTop = caretY + lineHeight + GAP
  let left = caretX
  suggestionsStyle.value = { top: `${initialTop}px`, left: `${left}px` }
  showTagSuggestions.value = true

  nextTick(() => {
    const panel = wrapper.querySelector('.tag-suggestions') as HTMLElement | null
    if (!panel)
      return

    // 1. 计算基准高度和输入框内的可用空间
    const firstItem = panel.querySelector('li')
    const singleItemHeight = firstItem ? firstItem.offsetHeight : 28
    const verticalPadding = 8
    const fiveItemsHeight = (singleItemHeight * 5) + verticalPadding

    const spaceAboveInTextarea = caretY - textAreaBox.top - GAP
    const spaceBelowInTextarea = textAreaBox.bottom - caretY - lineHeight - GAP

    // 2. 决定面板的朝向（是向上还是向下）
    const willPlaceAbove = spaceAboveInTextarea >= fiveItemsHeight

    // --- 🚀 新逻辑开始 ---
    // 计算6个和10个标签的基准高度
    const sixItemsHeight = (singleItemHeight * 6) + verticalPadding
    const tenItemsHeight = (singleItemHeight * 10) + verticalPadding

    let newMaxHeight = sixItemsHeight // 默认高度为6个标签

    // 仅在朝下显示时应用特殊拉伸规则
    if (!willPlaceAbove) {
      // 如果朝下，且下方空间大于5个标签的高度，则拉伸至最多10个标签的高度
      if (spaceBelowInTextarea > fiveItemsHeight)
        newMaxHeight = tenItemsHeight
    }
    panel.style.maxHeight = `${newMaxHeight}px`
    // --- 🚀 新逻辑结束 ---

    // 4. 获取应用了 maxHeight 之后的最终面板尺寸
    const panelH = panel.offsetHeight
    const panelW = panel.offsetWidth

    // 5. 水平位置防溢出
    if (left + panelW > textAreaBox.left + textAreaBox.width)
      left = Math.max(textAreaBox.left, textAreaBox.left + textAreaBox.width - panelW)

    // 6. 使用最终的面板高度(panelH)来计算最终的 top 位置
    const top = willPlaceAbove
      ? (caretY - GAP - panelH)
      : (caretY + lineHeight + GAP)

    suggestionsStyle.value = { top: `${top}px`, left: `${left}px` }
  })
}

function handleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement

  // 允许这一轮输入重新触发“轻推一次”
  _hasPushedPage = false

  // 先让 textarea 内部把光标行滚到可见（这一帧不等 vv）
  captureCaret()
  ensureCaretVisibleInTextarea()

  // 标签联想的位置也要基于最新滚动
  computeAndShowTagSuggestions(el)

  // 分三次重算，覆盖键盘动画 / visualViewport 延迟
  requestAnimationFrame(() => {
    recomputeBottomSafePadding()
    // iOS 常见：vv 延迟 ~120–240ms
    window.setTimeout(() => {
      recomputeBottomSafePadding()
    }, 140)

    window.setTimeout(() => {
      recomputeBottomSafePadding()
    }, 280)
  })

  // Android 专用加一道兜底
  if (isAndroid) {
    window.setTimeout(() => {
      recomputeBottomSafePadding()
    }, 240)
  }
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
      requestAnimationFrame(() => recomputeBottomSafePadding())
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
  // 用 == 包裹选中内容（需要渲染端启用 markdown-it-mark 才会显示黄色背景）
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

function addTable() {
  const el = textarea.value
  if (!el)
    return

  // 这是一个 3列 x 2行 的基础表格模板
  const tableTemplate = '| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n|          |          |          |\n|          |          |          |'

  const startPos = el.selectionStart
  const textBefore = el.value.substring(0, startPos)

  // 智能判断：如果光标不在段首，自动在表格前添加空行，确保表格格式正确
  const prefix = (textBefore.length === 0 || textBefore.endsWith('\n\n'))
    ? ''
    : (textBefore.endsWith('\n') ? '\n' : '\n\n')

  const textToInsert = `${prefix + tableTemplate}\n`

  // 使用现有的 updateTextarea 工具函数来插入文本
  const finalFullText = el.value.substring(0, startPos) + textToInsert + el.value.substring(el.selectionEnd)

  // 插入后，将光标自动定位到第一个单元格（Header 1），方便立即开始编辑
  const newCursorPos = startPos + prefix.length + 2 // `| ` 之后的位置
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

  // 1) 有序列表续行
  const orderedRe = /^(\d+)\.\s+/
  const orderedMatch = currentLine.match(orderedRe)

  // 2) 无序/待办续行
  const todoRe = /^-\s\[\s?\]\s+/
  const bulletRe = /^(-|\*|\+)\s+/
  const todoMatch = currentLine.match(todoRe)
  const bulletMatch = currentLine.match(bulletRe)

  if (!orderedMatch && !todoMatch && !bulletMatch)
    return

  event.preventDefault()

  // 如果只有前缀本身 => 结束该列表（删除本行）
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

  // 正常续行逻辑
  if (orderedMatch) {
    const currentNumber = Number.parseInt(orderedMatch[1], 10)
    const nextPrefix = `\n${currentNumber + 1}. `
    const before2 = el.value.substring(0, start)
    const after2 = el.value.substring(end)
    updateTextarea(before2 + nextPrefix + after2, start + nextPrefix.length)
    return
  }

  // 待办优先于普通无序
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

// —— 点击工具栏的“#”：注入一个 # 并弹出同款联想面板
function openTagMenu() {
  suppressNextBlur.value = true
  runToolbarAction(() => insertText('#', ''))
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

// —— 样式弹层定位（固定在 Aa 按钮上方）
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
  else openFormatPalette()
}

// ✅ 统一处理样式按钮点击（修复 eslint: max-statements-per-line）
function handleFormat(fn: () => void) {
  runToolbarAction(fn)
  closeFormatPalette()
}

// —— 监听滚动/尺寸变化，保持面板跟随 Aa
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

onMounted(() => {
  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', recomputeBottomSafePadding)
    vv.addEventListener('scroll', recomputeBottomSafePadding)
  }
})
onUnmounted(() => {
  const vv = window.visualViewport
  if (vv) {
    vv.removeEventListener('resize', recomputeBottomSafePadding)
    vv.removeEventListener('scroll', recomputeBottomSafePadding)
  }
})

// —— 点击外部 & ESC 关闭（排除 Aa 按钮与面板自身）
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
  if (isAndroid && rootRef.value)
    rootRef.value.classList.add('android')
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown as any, { capture: true } as any)
  window.removeEventListener('keydown', onGlobalKeydown)
  stopFocusBoost()
})

// —— 插入图片链接（Naive UI 对话框 + 增强记忆前缀规则）
const LAST_IMAGE_URL_PREFIX_KEY = 'note_image_url_prefix_v1'
function _getLastPrefix() {
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
function _savePrefix(urlText: string) {
  try {
    const u = new URL(urlText)
    let prefix = ''
    if (looksLikeImage(urlText)) {
      // 直链图片：记“目录”（去掉文件名）
      const dir = u.pathname.replace(/[^/]+$/u, '')
      prefix = `${u.origin}${dir}`
    }
    else {
      // 非直链：记“完整路径”，去掉查询/哈希，不补尾斜杠
      const path = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname
      prefix = `${u.origin}${path}`
    }
    localStorage.setItem(LAST_IMAGE_URL_PREFIX_KEY, prefix)
  }
  catch {
    // 不是合法 URL 就不记忆
  }
}

defineExpose({
  reset: triggerResize,
  focus: () => { focusToEnd() },
})

let focusBoostTimer: number | null = null

function stopFocusBoost() {
  if (focusBoostTimer != null) {
    clearInterval(focusBoostTimer)
    focusBoostTimer = null
  }
}

// 在键盘弹起早期，连续重算 600~720ms，直到 vv 有明显变化或超时
function startFocusBoost() {
  stopFocusBoost()
  const vv = window.visualViewport
  const startVvH = vv ? vv.height : 0
  let ticks = 0
  focusBoostTimer = window.setInterval(() => {
    ticks++
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
    const vvNow = window.visualViewport
    const changed = vvNow && Math.abs((vvNow.height || 0) - startVvH) >= 40 // 键盘高度变化阈值
    if (changed || ticks >= 12) { // 12*60ms ≈ 720ms
      stopFocusBoost()
    }
  }, 60)
}

function handleBeforeInput(e: InputEvent) {
  if (!isMobile)
    return
  _hasPushedPage = false

  // 不是插入/删除（如仅移动光标/选区）的 beforeinput，跳过预抬升
  const t = e.inputType || ''
  const isRealTyping
    = t.startsWith('insert')
    || t.startsWith('delete')
    || t === 'historyUndo'
    || t === 'historyRedo'
  if (!isRealTyping)
    return

  // iOS 首次输入：打闩，让 EXTRA 生效一轮
  if (isIOS && !iosFirstInputLatch.value)
    iosFirstInputLatch.value = true

  // 预抬升：iPhone 保底 120，Android 保底 180
  const base = getFooterHeight() + 24
  const prelift = Math.max(base, isAndroid ? 180 : 120)
  emit('bottomSafeChange', prelift)

  requestAnimationFrame(() => {
    ensureCaretVisibleInTextarea()
    recomputeBottomSafePadding()
  })
}
</script>

<template>
  <div
    ref="rootRef"
    class="note-editor-reborn" :class="[isEditing ? 'editing-viewport' : '']"
  >
    <input
      ref="imageInputRef"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onImageChosen"
    >
    <div class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :class="`font-size-${settingsStore.noteFontSize}`"
        :placeholder="placeholder"
        autocomplete="off"
        autocorrect="on"
        autocapitalize="sentences"
        inputmode="text"
        enterkeyhint="done"
        @beforeinput="handleBeforeInput"
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
        @pointerdown="onTextPointerDown"
        @pointerup="onTextPointerUp"

        @pointercancel="onTextPointerUp"
        @touchstart.passive="onTextPointerDown"
        @touchmove.passive="onTextPointerMove"
        @touchend.passive="onTextPointerUp"
        @touchcancel.passive="onTextPointerUp"
      />
      <div
        v-if="showTagSuggestions && tagSuggestions.length"
        class="tag-suggestions"
        :style="suggestionsStyle"
      >
        <ul>
          <li
            v-for="tag in tagSuggestions"
            :key="tag"
            @mousedown.prevent="selectTag(tag)"
          >
            <span class="tag-text">{{ tag }}</span>
            <span v-if="isPinned(tag)" class="tag-star">★</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="editor-footer">
      <div class="footer-left">
        <div class="editor-toolbar">
          <!-- # 标签 -->
          <button
            type="button"
            class="toolbar-btn"
            :title="t('notes.editor.toolbar.add_tag')"
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
            :title="t('notes.editor.toolbar.todo')"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addTodo)"
          >
            <svg
              class="icon-20" viewBox="0 0 24 24" fill="none"
              xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
            >
              <rect
                x="3" y="3" width="18" height="18" rx="2.5"
                stroke="currentColor" stroke-width="1.6"
              />
              <path
                d="M7 12l4 4 6-8"
                stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"
              />
            </svg>
          </button>

          <!-- 样式(Aa)汇总按钮 -->
          <button
            ref="formatBtnRef"
            type="button"
            class="toolbar-btn toolbar-btn-aa"
            :title="t('notes.editor.toolbar.styles')"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="toggleFormatPalette"
          >
            Aa
          </button>

          <!-- 插入图片链接（Naive UI 对话框） -->
          <button
            type="button"
            class="toolbar-btn"
            :title="t('notes.editor.image_dialog.title')"
            @pointerdown="onPickImageSync"
            @click="onPickImageSync"
          >
            <!-- Image icon -->
            <svg class="icon-20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.6" />
              <circle cx="9" cy="9" r="1.6" fill="currentColor" />
              <path d="M6 17l4.2-4.2a1.5 1.5 0 0 1 2.1 0L17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M13.5 13.5 18 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <span class="toolbar-sep" aria-hidden="true" />
        </div>
        <span class="char-counter">
          {{ charCount }}
        </span>
      </div>
      <div class="actions">
        <button type="button" class="btn-secondary" @click="emit('cancel')">
          {{ t('notes.editor.save.button_cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="isLoading || isSubmitting || !contentModel"
          @click="handleSave"
        >
          {{ t('notes.editor.save.button_save') }}
        </button>
      </div>
    </div>

    <!-- 样式弹层（更小、更贴合 Aa） -->
    <div
      v-if="showFormatPalette"
      ref="formatPaletteRef"
      class="format-palette"
      :style="{ top: formatPalettePos.top, left: formatPalettePos.left }"
      @mousedown.prevent
    >
      <div class="format-row">
        <button type="button" class="format-btn" :title="t('notes.editor.format.bold')" @click="handleFormat(addBold)">B</button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.ordered_list')" @click="handleFormat(addOrderedList)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <text x="4.4" y="8" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">1</text>
            <text x="4.0" y="13" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">2</text>
            <text x="4.0" y="18" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">3</text>
            <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.heading')" @click="handleFormat(addHeading)">H</button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.underline')" @click="handleFormat(addUnderline)">U</button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.bullet_list')" @click="handleFormat(addBulletList)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="6" cy="7" r="2" fill="currentColor" />
            <circle cx="6" cy="12" r="2" fill="currentColor" />
            <circle cx="6" cy="17" r="2" fill="currentColor" />
            <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.highlight')" @click="handleFormat(addMarkHighlight)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6" />
            <text x="8" y="16" font-size="10" font-family="sans-serif" font-weight="bold" fill="currentColor">T</text>
          </svg>
        </button>
        <button type="button" class="format-btn" :title="t('notes.editor.format.insert_table')" @click="handleFormat(addTable)">
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
            <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.6" />
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" stroke-width="1.6" />
            <line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" stroke-width="1.6" />
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

.editor-wrapper {
  position: relative;
  overflow-anchor: none;
}
.note-editor-reborn.android .editor-wrapper {
  overflow-anchor: auto;
}

.editor-textarea {
  width: 100%;
  min-height: 360px;
  max-height: 75dvh;
  overflow-y: auto;
  padding: 12px 8px 8px 16px;
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

/* ——— 颜色与交互保持不变 ——— */
.btn-primary {
  background-color: #00b386;
  color: #fff;
  border: 1px solid transparent;   /* 用透明边框统一高度 */
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-primary:hover { background-color: #009a74; }
.btn-primary:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
  opacity: 0.7;
}

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-secondary:hover { background-color: #e0e0e0; }

/* Dark 模式保持颜色 */
.dark .btn-secondary { background-color: #4b5563; color: #fff; border-color: #555; }
.dark .btn-secondary:hover { background-color: #5a6676; }

/* ——— 新增：统一尺寸（高度 & 宽度） ——— */
.btn-primary,
.btn-secondary {
  padding: 3px 12px;
  min-width: 64px;
  height: 28px;
  box-sizing: border-box;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border-top: none;
  background-color: transparent;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 工具栏按钮间距（维持你之前已加大的 8px） */
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

.icon-image {
  font-size: 16px;
  line-height: 1;
}

.toolbar-sep {
  display: inline-block;
  width: 1px;
  height: 16px;
  margin-left: 6px;
  background-color: rgba(0,0,0,0.08);
}
.dark .toolbar-sep { background-color: rgba(255,255,255,0.18); }

/* ======= 更小的样式弹层（紧贴 Aa 上方） ======= */
.format-palette {
  position: absolute;
  z-index: 1100;
  transform: translateX(-50%);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 2px 4px;          /* 缩小内边距 */
}
.dark .format-palette {
  background: #2c2c2e;
  border-color: #3f3f46;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}

.format-row {
  display: flex;
  align-items: center;
  gap: 6px;                  /* 缩小内部间距 */
}
.format-btn {
  width: 24px;               /* 缩小按钮 */
  height: 24px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font-weight: 700;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.format-btn:hover { background: rgba(0,0,0,0.06); }
.dark .format-btn:hover { background: rgba(255,255,255,255,0.08); }

/* 小三角：指向 Aa 按钮（大幅缩小） */
.format-caret {
  position: absolute;
  left: 50%;
  transform: translate(-50%, 3px) rotate(45deg);
  bottom: -3px;
  width: 6px;
  height: 6px;
  background: inherit;
  border-left: 1px solid inherit;
  border-bottom: 1px solid inherit;
}

/* 标签联想 */
.tag-suggestions {
  position: absolute;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 300px;
  overflow-y: auto;
  min-width: 120px;
}
.dark .tag-suggestions { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li { padding: 6px 12px; cursor: pointer; font-size: 14px; }
.tag-suggestions li:hover { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover { background-color: #404040; }

/* 新增：编辑模式下，允许 textarea 无限增高 */
.note-editor-reborn.editing-viewport .editor-textarea {
  max-height:75dvh;
}

/* tag 面板样式增强 */
.tag-suggestions li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
}
.tag-suggestions .tag-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-suggestions .tag-star {
  opacity: 0.7;
  margin-left: 8px;
  font-size: 12px;
  color: #999;
}

.icon-20 {
  width: 20px;
  height: 20px;
  display: block;
}

/* 允许图标溢出按钮盒，不改变按钮盒尺寸 */
.format-btn { overflow: visible; }

/* 让 Aa 面板里的图标“视觉放大”，但按钮仍旧是 24×24 */
.format-btn .icon-bleed {
  width: 40px !important;    /* 图标比按钮大一些 */
  height: 40px !important;
  display: block;
  margin: -5px !important;    /* 负外边距把放大的图形居中回去，不撑大面板 */
  pointer-events: none;       /* 防止图标遮挡点击（点击事件仍落到 button 上） */
}
</style>
