<script setup lang="ts">
import { computed, defineExpose, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { NInput, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// —— 天气映射（用于城市名映射与图标）——
import { cityMap, weatherMap } from '@/utils/weatherMap'

// ============== Props & Emits ==============
const props = defineProps({
  noteId: { type: String, default: '' },
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
const isInputFocused = ref(false)
const cachedWeather = ref<string | null>(null)
let weatherPromise: Promise<string | null> | null = null
const { t } = useI18n()

const dialog = useDialog()
const draftStorageKey = computed(() => {
  if (!props.enableDrafts)
    return null
  if (props.noteId)
    return `note_draft_${props.noteId}`

  // 之前的逻辑作为后备（用于新建笔记或未传 ID 的情况）
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

// 🔥 修正版：高度计算属性
const editorHeight = computed(() => {
  // 1. 键盘收起时（浏览模式）：85% 屏幕高度
  if (!isInputFocused.value)
    return '80dvh'

  // 2. 键盘弹出时（输入模式）：

  // 现场获取 UserAgent，确保判断准确
  const currentUA = navigator.userAgent.toLowerCase()
  // 增加 'macintosh' 判断，因为 iPad 有时会伪装成 Mac
  const isReallyIOS = /iphone|ipad|ipod|macintosh/.test(currentUA) && isMobile

  if (isReallyIOS) {
    // 🍎 iOS 专用：手动减去键盘高度
    // 如果 430px 还不够，说明你的键盘更高，或者是 Pro Max 机型
    return 'calc(100dvh - 430px)'
  }

  // 🤖 Android / 其他：直接填满
  // Android 配合 interactive-widget 会自动挤压 100dvh，所以不用减
  return '100dvh'
})

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
  })
  window.setTimeout(() => {
  })
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

const textarea = ref<HTMLTextAreaElement | null>(null)
const input = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val),
})

// 定义一个空的 triggerResize 防止报错（因为你 expose 出去了）
function triggerResize() { /* 不需要 resize 了，因为是 CSS 控制高度 */ }
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
  })
}

// ===== 简单自动草稿 =====
let draftTimer: number | null = null
const DRAFT_SAVE_DELAY = 400 // ms

// 1. 先定义所有需要的响应式变量
const showFormatPalette = ref(false)
const showDraftPrompt = ref(false)
const pendingDraftText = ref('')
// 🔥 新增：提示框模式 ('draft' | 'error') 和 错误信息
const promptMode = ref<'draft' | 'error'>('draft')
const promptErrorMsg = ref('')

// 🔥 新增：报错时的“好的”按钮点击事件
function handleErrorConfirm() {
  showDraftPrompt.value = false // 关闭弹窗
  // 核心：像草稿恢复一样，利用 nextTick 完美拉回焦点
  nextTick(() => {
    focusToEnd()
  })
}

// 2. 再定义函数：handleRecoverDraft (使用了上面的变量)
function handleRecoverDraft() {
  emit('update:modelValue', pendingDraftText.value)
  showDraftPrompt.value = false // 关闭遮罩

  nextTick(() => {
    try {
      triggerResize?.()
    }
    catch {
      // noop
    }
    focusToEnd() // 恢复数据后聚焦
  })
}

// 3. 再定义函数：handleDiscardDraft
function handleDiscardDraft() {
  clearDraft()
  showDraftPrompt.value = false // 立即关闭遮罩

  // 立即同步聚焦！
  const el = textarea.value
  if (el) {
    el.focus()
    try {
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
    catch {
      // noop
    }
  }
}

// 4. 最后定义函数：checkAndPromptDraft (使用了变量)
// NoteEditor.vue

function checkAndPromptDraft() {
  if (!props.enableDrafts)
    return
  const key = draftStorageKey.value
  if (!key)
    return
  const raw = localStorage.getItem(key)
  if (!raw)
    return

  let tVal = ''
  try {
    const obj = JSON.parse(raw)
    tVal = typeof obj?.content === 'string' ? obj.content : ''
  }
  catch {
    tVal = raw
  }

  // 只有内容不一致时才需要处理
  if (tVal && tVal !== props.modelValue) {
    // ✅ 核心修改：如果是“新建笔记”（没有 noteId），直接静默覆盖，不弹窗
    if (!props.noteId) {
      emit('update:modelValue', tVal)
      // 顺便触发一下高度调整，确保排版正确
      nextTick(() => {
        try {
          triggerResize?.()
        }
        catch {
          // ignore
        }
      })
      return
    }

    // 🛑 如果是“编辑已有笔记”（有 noteId），仍然保留弹窗
    // 因为已有笔记涉及版本冲突，弹窗更安全，防止覆盖了云端拉取的内容
    pendingDraftText.value = tVal
    promptMode.value = 'draft'
    showDraftPrompt.value = true
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
  }
  catch (err: any) {
    const isQuotaError = err.message && err.message.includes('row-level security policy')

    // 1. 设置错误信息
    promptErrorMsg.value = isQuotaError
      ? `${t('notes.account.errors.quota_exceeded_1')}\n${t('notes.account.errors.quota_exceeded_2')}`
      : (err?.message || t('notes.upload.error_content'))

    // 2. 设置为“报错模式”并显示弹窗
    promptMode.value = 'error'
    showDraftPrompt.value = true
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
    const payload = JSON.stringify({ content: contentModel.value || '' })
    localStorage.setItem(key, payload)
    localStorage.setItem(`${key}_ts`, String(Date.now()))

    // ✅ 新增：发送自定义事件，通知 NoteItem 更新状态
    // 如果有 noteId，就传 noteId，否则传 key 兜底
    const targetId = props.noteId || key
    window.dispatchEvent(new CustomEvent('note-draft-changed', { detail: targetId }))
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
    localStorage.removeItem(`${key}_ts`)

    // ✅ 新增：发送自定义事件，通知 NoteItem 移除小黄点
    const targetId = props.noteId || key
    window.dispatchEvent(new CustomEvent('note-draft-changed', { detail: targetId }))
  }
  catch {
    // noop
  }
}

// 初次挂载：尝试恢复
onMounted(() => {
  checkAndPromptDraft()

  if (props.isEditing) {
    focusToEnd()
  }
  else {
    weatherPromise = fetchWeatherLine()

    if (weatherPromise) {
      weatherPromise.then((res) => {
        cachedWeather.value = res
      }).catch((e) => {
        console.warn('[天气] 异步出错:', e)
        cachedWeather.value = null
      })
    }
  }
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

watch(
  [charCount, () => props.maxNoteLength],
  ([len, max]) => {
    // 统一算出一个可靠的 limit，防止 max 偶尔是 undefined
    const limit
      = typeof max === 'number' && Number.isFinite(max) && max > 0
        ? max
        : props.maxNoteLength

    if (len > limit && !overLimitWarned.value) {
      overLimitWarned.value = true

      // ✅ 这里明确指定 max: limit（一定是数字）
      dialog.warning({
        title: t('notes.editor.char_limit_title'),
        content: t('notes.editor.char_limit_content', { max: limit }),
        positiveText: t('notes.ok'),
      })
    }
    else if (len <= limit && overLimitWarned.value) {
      overLimitWarned.value = false
    }
  },
)

// ============== 状态与响应式变量 ==============
const isComposing = ref(false)
const isSubmitting = ref(false)
const suppressNextBlur = ref(false)
let blurTimeoutId: number | null = null
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

// —— 格式弹层（B / 1. / H / I / • / 🖊️）
const formatPalettePos = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })
const formatBtnRef = ref<HTMLElement | null>(null)
const formatPaletteRef = ref<HTMLElement | null>(null)

// —— 录音小条（固定在工具栏上方，不再全屏乱跳）——
const showRecordBar = ref(false)
const isRecording = ref(false)
const isRecordPaused = ref(false)
const isUploadingAudio = ref(false)

// 录音时长（秒）+ 定时器句柄
// 录音时长（秒）+ 定时器句柄
const recordSeconds = ref(0)
let recordTimer: number | null = null

const MAX_RECORD_SECONDS = 10 * 60
const WARNING_SECONDS = 2 * 60

// 已录制时长：mm:ss
const recordTimeText = computed(() => {
  const total = recordSeconds.value
  const m = Math.floor(total / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return `${mm}:${ss}`
})

/**
 * 剩余时间文本：还剩 01:59
 * 只在“剩余时间 <= WARNING_SECONDS（2 分钟）”时显示
 */
const recordRemainingText = computed(() => {
  const remaining = MAX_RECORD_SECONDS - recordSeconds.value
  if (remaining <= 0)
    return ''
  // 如果希望全程显示剩余时间，把这一行删掉即可
  if (remaining > WARNING_SECONDS)
    return ''

  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return `${mm}:${ss}`
})

function startRecordTimer() {
  if (recordTimer != null)
    window.clearInterval(recordTimer)

  recordTimer = window.setInterval(() => {
    recordSeconds.value += 1

    // 超时自动停止录音（10 分钟）
    if (recordSeconds.value >= MAX_RECORD_SECONDS) {
      isRecording.value = false
      isRecordPaused.value = false
      stopRecordTimer(false)
      stopRecording()
    }
  }, 1000) as unknown as number
}

function stopRecordTimer(reset = false) {
  if (recordTimer != null) {
    window.clearInterval(recordTimer)
    recordTimer = null
  }
  if (reset)
    recordSeconds.value = 0
}

// MediaRecorder 相关
let mediaRecorder: MediaRecorder | null = null
let audioChunks: BlobPart[] = []
let audioStream: MediaStream | null = null

function cleanupMediaRecorder() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive')
      mediaRecorder.stop()
  }
  catch {
    // ignore
  }
  mediaRecorder = null
  audioChunks = []

  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop())
    audioStream = null
  }
}

// 生成音频文件路径：按用户 + 年月分目录
function buildAudioPath(userId: string, ext = 'webm') {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const ts = d.getTime()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${userId}/${y}/${m}/${ts}_${rand}.${ext}`
}

// 上传音频到 Supabase，返回可访问 URL
async function uploadAudioToSupabase(blob: Blob): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user)
    throw new Error(t('notes.editor.record.login_required'))

  const userId = userData.user.id
  const bucket = 'note-audios' // 你原来用的桶名如果不一样，这里要改成原来的
  const ext = 'webm'
  const contentType = 'audio/webm'

  const filePath = buildAudioPath(userId, ext)

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
    throw new Error(t('notes.editor.record.url_failed'))

  return signed.signedUrl
}

// 当一段录音结束后：上传并在光标处插入链接（无成功弹窗）
async function handleAudioFinished(blob: Blob) {
  if (!blob.size)
    return

  isUploadingAudio.value = true
  try {
    const url = await uploadAudioToSupabase(blob)

    // 1. 插入录音链接到当前光标位置
    const label = t('notes.editor.record.link_label')
    insertText(`[🎙️${label}](${url}) `, '')

    // 2. 下一帧把焦点和光标拉回 textarea（避免光标消失）
    await nextTick()
    const el = textarea.value
    if (el) {
      el.focus()
      const len = el.value.length
      try {
        el.setSelectionRange(len, len)
      }
      catch {
        // 某些环境会抛错，忽略即可
      }
      captureCaret()
      ensureCaretVisibleInTextarea()
      requestAnimationFrame(() => {
      })
    }
  }
  catch (err: any) {
    const isQuotaError = err.message && err.message.includes('row-level security policy')
    promptErrorMsg.value = isQuotaError
      ? `${t('notes.account.errors.quota_exceeded_1')}\n${t('notes.account.errors.quota_exceeded_2')}`
      : (err?.message || t('notes.editor.record.upload_failed_content'))

    promptMode.value = 'error'
    showDraftPrompt.value = true
  }
  finally {
    isUploadingAudio.value = false
  }
}

// 开始录音
async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    dialog.warning({
      title: t('notes.editor.record.no_mic_title'),
      content: t('notes.editor.record.no_mic_content'),
      positiveText: t('notes.ok'),
    })
    return
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    // 🔽 新增：尽量请求更低的码率（16 kbps 左右）
    const targetBits = 16000 // 也可以换成 24000，看你能接受的音质

    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType,
      audioBitsPerSecond: targetBits,
    })

    audioChunks = []

    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0)
        audioChunks.push(e.data)
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: mimeType })
      cleanupMediaRecorder()

      // 录音结束后上传并插入链接
      handleAudioFinished(blob)
        .then(() => {
          // ✅ 上传成功后关闭录音条
          showRecordBar.value = false
          isRecording.value = false
          isRecordPaused.value = false
          recordSeconds.value = 0
        })
        .catch(() => {
          // ❗ 上传失败时，同样关闭录音条（可按需保留）
          showRecordBar.value = false
          isRecording.value = false
          isRecordPaused.value = false
          recordSeconds.value = 0
        })
    }

    mediaRecorder.start()
  }
  catch (err: any) {
    cleanupMediaRecorder()
    dialog.error({
      title: t('notes.editor.record.start_failed_title'),
      content: err?.message || t('notes.editor.record.start_failed_content'),
      positiveText: t('notes.ok'),
    })
  }
}

// 暂停录音
function pauseRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording')
    mediaRecorder.pause()
}

// 继续录音
function resumeRecording() {
  if (mediaRecorder && mediaRecorder.state === 'paused')
    mediaRecorder.resume()
}

// 停止录音（会触发 onstop → 上传 → 插入）
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive')
    mediaRecorder.stop()
}

// —— 录音条按钮：展开 / 收起 —— //
function toggleRecordBarVisible() {
  if (showRecordBar.value) {
    // 再次点麦克风：直接收起录音条、重置状态和录音器
    showRecordBar.value = false
    isRecording.value = false
    isRecordPaused.value = false
    stopRecordTimer(true)
    cleanupMediaRecorder()
    return
  }

  // 打开录音条时，只是展示控件，不自动开始录音
  showRecordBar.value = true
  isRecording.value = false
  isRecordPaused.value = false
  recordSeconds.value = 0
}
// —— 录音条按钮：取消 —— //
function handleRecordCancelClick() {
  // 取消：关闭录音条，丢弃本次录音
  showRecordBar.value = false
  isRecording.value = false
  isRecordPaused.value = false
  stopRecordTimer(true)
  cleanupMediaRecorder()
}

// —— 录音条按钮：录音 / 停止 —— //
function handleRecordButtonClick() {
  if (isUploadingAudio.value)
    return

  // 当前不是录音状态 → 开始录音
  if (!isRecording.value) {
    isRecording.value = true
    isRecordPaused.value = false
    recordSeconds.value = 0
    stopRecordTimer(false)
    startRecordTimer()
    startRecording().catch(() => {})
    return
  }

  // 已经在录音中：此时按钮含义是“停止并生成链接”
  isRecording.value = false
  isRecordPaused.value = false
  stopRecordTimer(false) // 停止计时，但保留最后时长显示
  stopRecording()

  // 不立刻收起录音条，等上传结束也可以；你如果想直接收起就取消下面注释
  // showRecordBar.value = false
}

// —— 录音条按钮：暂停 / 继续 —— //
function handleRecordPauseClick() {
  if (!isRecording.value || isUploadingAudio.value)
    return

  // 正在录音 → 暂停
  if (!isRecordPaused.value) {
    isRecordPaused.value = true
    pauseRecording()
    stopRecordTimer(false)
    return
  }

  // 已暂停 → 继续
  isRecordPaused.value = false
  resumeRecording()
  startRecordTimer()
}

// 生命周期：卸载时一定要关掉麦克风
onUnmounted(() => {
  cleanupMediaRecorder()
  stopRecordTimer(true)
})

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

let _hasPushedPage = false // 只在“刚被遮挡”时推一次，避免抖
let _lastBottomNeed = 0

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

    // 🔥 1. 新增：优先检查 Store 里有没有手动设置的城市
    if (settingsStore.manualLocation) {
      const m = settingsStore.manualLocation
      // 如果有，直接使用，不需要 await，也就没有延迟
      loc = { city: m.name, lat: m.lat, lon: m.lon }
    }
    else {
      // 🔥 2. 原有逻辑：如果没有手动设置，才走自动定位流程 (放入 else 块)

      // ===== 1. 主动触发定位 (GPS) =====
      // 之前改过的 2500ms 超时，保证不卡顿
      const browserLoc = await getBrowserLocationWithPromptOnce(3000)

      if (browserLoc) {
        // 🟢 情况 A：GPS 定位成功
        // 1. 优先：尝试用 Nominatim 把坐标转成城市名 (最准确)
        let cityFromGeo = await reverseGeocodeCityFromCoords(browserLoc.lat, browserLoc.lon)

        // 2. 补救：如果 Nominatim 挂了(503)或超时，才尝试用 IP API 查城市名
        if (!cityFromGeo) {
          try {
            // 这里只查城市名，不查坐标（坐标还是用 GPS 的，准确）
            const r = await fetch('https://ipapi.co/json/')
            if (r.ok) {
              const d = await r.json()
              cityFromGeo = d.city
            }
          }
          catch {
            // IP 也查不到，忽略
          }
        }

        // 3. 兜底：如果都失败，叫“当前位置”
        if (!cityFromGeo)
          cityFromGeo = '当前位置'

        loc = {
          city: cityFromGeo,
          lat: browserLoc.lat,
          lon: browserLoc.lon,
        }
      }
      else {
        // 🔴 情况 B：GPS 定位失败（用户拒绝或设备不支持）
        // 退回纯 IP 定位（既查坐标，也查城市）
        try {
          const r = await fetch('https://ipapi.co/json/')
          if (!r.ok)
            throw new Error(String(r.status))
          const d = await r.json()
          loc = { city: d.city, lat: d.latitude, lon: d.longitude }
        }
        catch {
          const r2 = await fetch('https://ip-api.com/json/')
          if (!r2.ok)
            throw new Error(String(r2.status))
          const d2 = await r2.json()
          loc = { city: d2.city || d2.regionName, lat: d2.lat, lon: d2.lon }
        }
      }
    }

    // --- 下面是公共逻辑（无论是手动的还是自动的，都在这里查天气） ---

    if (!loc?.lat || !loc?.lon)
      throw new Error('定位失败')

    // 格式化城市名（映射中文等）
    const city = getMappedCityName(loc.city)

    // ===== 3. 获取天气 =====
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

// ✅ 替换这个函数：增加了 AbortController 超时控制
async function reverseGeocodeCityFromCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`

    // 🔥 新增：定义一个 1500ms (1.5秒) 的超时控制器
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)

    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal, // 👈 绑定信号，超时会自动取消请求
    })

    // 请求成功返回，清除定时器
    clearTimeout(timeoutId)

    if (!r.ok)
      throw new Error(String(r.status))

    const data = await r.json()
    const addr = data?.address || {}

    // 从细到粗兜底
    const city
      = addr.city
      || addr.town
      || addr.village
      || addr.hamlet
      || addr.county
      || null

    return city
  }
  catch (e) {
    // 这里的 catch 会捕获 503 错误或超时错误，直接返回 null
    // console.warn('获取城市失败或超时:', e)
    return null
  }
}

// ========= 保存：不把天气写进正文；仅新建时生成一次，并作为第二参数传递 =========
async function handleSave() {
  if (props.isLoading || isSubmitting.value)
    return
  isSubmitting.value = true

  const content = contentModel.value || ''

  let finalWeather = cachedWeather.value

  // 如果没有缓存，但有请求在跑，就尝试等待
  if (!finalWeather && weatherPromise) {
    try {
      // ✅ 给 3500ms 足够覆盖修改后的定位超时(2500ms) + 网络请求时间
      const TIMEOUT_MS = 4500
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS))

      const result = await Promise.race([weatherPromise, timeout])

      if (result)
        finalWeather = result
    }
    catch {
      // 忽略错误
    }
  }

  emit('save', content, finalWeather)

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
  }, 80)
}

onMounted(() => {
  document.addEventListener('selectionchange', onDocSelectionChange)
})
onUnmounted(() => {
  document.removeEventListener('selectionchange', onDocSelectionChange)
})

function handleFocus() {
  isInputFocused.value = true
  emit('focus')
  captureCaret()

  // 允许再次“轻推”
  _hasPushedPage = false

  // 用真实 footer 高度“临时托起”，不等 vv
  emit('bottomSafeChange', getFooterHeight())

  // 立即一轮计算
  requestAnimationFrame(() => {
    ensureCaretVisibleInTextarea()
  })

  // 1. 【修改重点】去掉了 if (!props.isEditing) 判断
  // 无论是新建还是编辑旧笔记，都强制执行归位逻辑
  setTimeout(() => {
    window.scrollTo(0, 0)
    if (document.body.scrollTop !== 0)
      document.body.scrollTop = 0

    if (document.documentElement.scrollTop !== 0)
      document.documentElement.scrollTop = 0
  }, 300) // 2. 【修改建议】改为 300ms，确保覆盖 iOS 键盘弹起后的原生滚动行为

  // 覆盖 visualViewport 延迟：iOS 稍慢、Android 稍快
  const t1 = isIOS ? 120 : 80
  window.setTimeout(() => {
    // 原有逻辑保留
  }, t1)

  const t2 = isIOS ? 260 : 180
  window.setTimeout(() => {
    // 原有逻辑保留
  }, t2)

  setTimeout(() => {
    ensureCaretVisibleInTextarea()
  }, 400) // 400ms > transition 0.3s

  // 启动短时“助推轮询”（iOS 尤其需要）
  startFocusBoost()
}

function onBlur() {
  isInputFocused.value = false
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
    // iOS 常见：vv 延迟 ~120–240ms
    window.setTimeout(() => {
    }, 140)

    window.setTimeout(() => {
    }, 280)
  })

  // Android 专用加一道兜底
  if (isAndroid) {
    window.setTimeout(() => {
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
  const tableTemplate = '| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n|          |          |          |\n|          |          |          |'

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

/** 插入当前时间：只插入 HH:mm */
function addCurrentTime() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const text = `${hh}:${mm}`
  insertText(text, '')
}

function addLink() {
  const el = textarea.value
  if (!el)
    return

  const value = el.value
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = value.slice(start, end)

  // 默认值：如果选中的是以 http 开头的文本，就用选中值，否则用 https://
  const urlRef = ref(
    selected && /^https?:\/\//i.test(selected) ? selected : 'https://',
  )

  dialog.create({
    title: t('notes.editor.toolbar.link'),
    maskClosable: true,
    zIndex: 4000, // 把层级拉高，盖住编辑器
    content: () =>
      h(NInput, {
        'value': urlRef.value,
        'onUpdate:value': (v: string) => { urlRef.value = v },
        'placeholder': 'https://example.com',
        'autofocus': true,
        'inputmode': 'url',
      }),
    positiveText: t('notes.ok'),
    negativeText: t('button.cancel'),
    onPositiveClick: () => {
      const raw = urlRef.value.trim()
      if (!raw)
        return false

      const url = raw
      const label = selected || url

      const before = value.slice(0, start)
      const after = value.slice(end)
      const linkMd = `[${label}](${url})`
      const newText = `${before}${linkMd}${after}`
      const newCursorPos = before.length + linkMd.length

      updateTextarea(newText, newCursorPos)

      nextTick(() => {
        const textareaEl = textarea.value
        if (textareaEl) {
          textareaEl.focus()
          textareaEl.setSelectionRange(newCursorPos, newCursorPos)
          captureCaret()
          ensureCaretVisibleInTextarea()
          requestAnimationFrame(() => recomputeBottomSafePadding())
        }
      })

      return true
    },
  })
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

// —— 样式弹层定位（改为在 Aa 按钮【下方】）
// —— 样式弹层定位（改为在 Aa 按钮【下方】）
function placeFormatPalette() {
  const btn = formatBtnRef.value
  const root = rootRef.value
  const panel = formatPaletteRef.value
  if (!btn || !root || !panel)
    return

  const btnRect = btn.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const gap = 8

  // 🔴 删除这行: const panelH = panel.offsetHeight || 0
  // 因为现在是在下方显示，不需要知道面板高度也能算出 top

  const panelW = panel.offsetWidth || 0
  const rootWidth = rootRect.width

  // 🔥 计算 Top: 按钮底部 + 间隙
  const top = (btnRect.bottom - rootRect.top) + gap

  // 基准：Aa 按钮中点
  const centerBase = (btnRect.left - rootRect.left) + btnRect.width / 2
  const H_OFFSET = 6
  let left = centerBase + H_OFFSET

  const margin = 4
  const minLeft = (panelW / 2) + margin
  const maxLeft = rootWidth - (panelW / 2) - margin
  left = Math.min(Math.max(left, minLeft), maxLeft)

  formatPalettePos.value = {
    top: `${Math.max(top, 0)}px`,
    left: `${left}px`,
  }
}

// 另外，原来的 getFooterHeight 可能需要调整
// 因为底部没有工具栏了，键盘弹起时不需要额外把工具栏的高度算进去
// 你可以把这个函数改为返回一个较小的安全距离（比如 20）
function getFooterHeight(): number {
  return 20 // 底部只需留一点点缝隙即可
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
  // ✅ 修复：vv 变量未定义的问题
  const vv = window.visualViewport
  const startVvH = vv ? vv.height : 0
  let ticks = 0
  focusBoostTimer = window.setInterval(() => {
    ticks++
    ensureCaretVisibleInTextarea()
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
  })
}
</script>

<template>
  <div
    ref="rootRef"
    class="note-editor-reborn"
    :class="{
      'editing-viewport': isEditing,
      'is-focused': isInputFocused,
    }"
    :style="{
      paddingBottom: `${bottomSafePadding}px`,
      /* ✅✅✅ 核心修改：高度直接由 JS 接管，谁也别想乱改 */
      height: props.isEditing ? undefined : editorHeight,
    }"
    @click.stop
  >
    <input
      ref="imageInputRef"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onImageChosen"
    >

    <div class="editor-footer">
      <div class="footer-left">
        <div class="editor-toolbar">
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

          <button
            type="button"
            class="toolbar-btn"
            :title="t('notes.editor.format.bold')"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addBold)"
          >
            B
          </button>

          <button
            type="button"
            class="toolbar-btn"
            :title="t('notes.editor.format.bullet_list')"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addBulletList)"
          >
            <svg
              class="icon-20"
              viewBox="0 0 24 24" fill="none"
              xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
            >
              <circle cx="6" cy="7" r="2" fill="currentColor" />
              <circle cx="6" cy="12" r="2" fill="currentColor" />
              <circle cx="6" cy="17" r="2" fill="currentColor" />
              <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
              <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
              <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
          </button>

          <button
            type="button"
            class="toolbar-btn"
            :title="t('notes.editor.image_dialog.title')"
            @pointerdown="onPickImageSync"
            @click="onPickImageSync"
          >
            <svg
              class="icon-20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="3" y="4" width="18" height="16" rx="2.5"
                stroke="currentColor" stroke-width="1.6"
              />
              <circle cx="9" cy="9" r="1.6" fill="currentColor" />
              <path
                d="M6 17l4.2-4.2a1.5 1.5 0 0 1 2.1 0L17 17"
                stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round"
              />
              <path
                d="M13.5 13.5 18 9"
                stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round"
              />
            </svg>
          </button>

          <button
            ref="formatBtnRef"
            type="button"
            class="toolbar-btn toolbar-btn-aa"
            :title="t('notes.editor.toolbar.more_toolbar') || '更多工具'"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="toggleFormatPalette"
          >
            ···
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

    <div v-if="showRecordBar" class="record-bar">
      <div class="record-status">
        <span class="record-dot" :class="{ active: isRecording && !isRecordPaused }" />
        <span class="record-text">
          <template v-if="isUploadingAudio">
            {{ t('notes.editor.record.uploading') }}
          </template>
          <template v-else-if="!isRecording">
            {{ t('notes.editor.record.status_ready') }}
          </template>
          <template v-else-if="isRecordPaused">
            {{ t('notes.editor.record.status_paused') }}
          </template>
          <template v-else>
            {{ t('notes.editor.record.status_recording') }}
          </template>
        </span>
        <span
          v-if="recordSeconds > 0 || isRecording"
          class="record-time"
        >
          {{ recordTimeText }}
          <span
            v-if="recordRemainingText"
            class="record-remaining"
          >
            |{{ t('notes.editor.record.remaining', { time: recordRemainingText }) }}
          </span>
        </span>
      </div>
      <div class="record-actions">
        <button
          type="button"
          class="record-btn record-btn-secondary"
          @click="handleRecordCancelClick"
        >
          {{ t('notes.editor.record.button_cancel') }}
        </button>
        <button
          type="button"
          class="record-btn record-btn-secondary"
          :disabled="!isRecording || isUploadingAudio"
          @click="handleRecordPauseClick"
        >
          {{ isRecordPaused ? t('notes.editor.record.button_resume') : t('notes.editor.record.button_pause') }}
        </button>
        <button
          type="button"
          class="record-btn record-btn-primary"
          :disabled="isUploadingAudio"
          @click="handleRecordButtonClick"
        >
          {{ isRecording ? t('notes.editor.record.button_stop') : t('notes.editor.record.button_start') }}
        </button>
      </div>
    </div>

    <div class="editor-wrapper">
      <div v-if="showDraftPrompt" class="draft-prompt-overlay" @click.stop>
        <div class="draft-prompt-card">
          <div class="draft-prompt-title">
            {{ promptMode === 'draft' ? t('notes.draft.title') : t('notes.upload.error_title') }}
          </div>

          <div
            class="draft-prompt-content"
            :style="promptMode === 'error' ? 'white-space: pre-wrap; text-align: center; line-height: 1.6;' : ''"
          >
            <template v-if="promptMode === 'draft'">
              {{ t('notes.draft.restore_confirm') }}
            </template>
            <template v-else>
              {{ promptErrorMsg }}
            </template>
          </div>

          <div class="draft-prompt-actions">
            <template v-if="promptMode === 'draft'">
              <button
                class="btn-secondary draft-btn"
                @click.prevent="handleDiscardDraft"
              >
                {{ t('notes.draft.discard') }}
              </button>
              <button
                class="draft-btn btn-primary"
                @click.prevent="handleRecoverDraft"
              >
                {{ t('notes.draft.continue') }}
              </button>
            </template>

            <template v-else>
              <button
                class="draft-btn btn-primary"
                @click.prevent="handleErrorConfirm"
              >
                {{ t('notes.ok') }}
              </button>
            </template>
          </div>
        </div>
      </div>
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

    <div
      v-if="showFormatPalette"
      ref="formatPaletteRef"
      class="format-palette"
      :style="{ top: formatPalettePos.top, left: formatPalettePos.left }"
      @mousedown.prevent
    >
      <div class="format-row">
        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.toolbar.todo')"
          @click="handleFormat(addTodo)"
        >
          <svg
            class="icon-bleed" viewBox="0 0 24 24" fill="none"
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

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.format.ordered_list')"
          @click="handleFormat(addOrderedList)"
        >
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <text x="4.4" y="8" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">1</text>
            <text x="4.0" y="13" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">2</text>
            <text x="4.0" y="18" font-size="7" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">3</text>
            <path d="M10 7h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M10 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.format.heading')"
          @click="handleFormat(addHeading)"
        >
          H
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.format.underline')"
          @click="handleFormat(addUnderline)"
        >
          U
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.format.highlight')"
          @click="handleFormat(addMarkHighlight)"
        >
          <svg
            class="icon-bleed"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6" />
            <text x="8" y="16" font-size="10" font-family="sans-serif" font-weight="bold" fill="currentColor">T</text>
          </svg>
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.format.insert_table')"
          @click="handleFormat(addTable)"
        >
          <svg
            class="icon-bleed"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
            <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.6" />
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" stroke-width="1.6" />
            <line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </button>
      </div>

      <div class="format-row">
        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.toolbar.link') || '插入链接'"
          @click="handleFormat(addLink)"
        >
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.toolbar.time') || '插入时间'"
          @click="handleFormat(addCurrentTime)"
        >
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.6" />
            <path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          class="format-btn"
          :title="t('notes.editor.toolbar.recording') || '录音'"
          @click="handleFormat(() => toggleRecordBarVisible())"
        >
          <svg class="icon-bleed" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 4a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M7 11a5 5 0 0 0 10 0M12 16v4M9 20h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
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

  /* --- 场景 A：键盘收起时 (浏览态) --- */
  /* 设置一个较高的值，比如 85% 屏幕高度，让你能看到更多内容 */
  height: 80dvh;

  /* 2. 最小高度保底 */
  min-height: 430px;

  /* 3. 封顶 */
  max-height: 90dvh;

  /* 4. 沉底逻辑 */
  margin-top: auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  /* 加上过渡动画，让变高变矮时丝般顺滑 */
  transition: height 0.3s cubic-bezier(0.25, 0.8, 0.5, 1), box-shadow 0.2s ease;
}

/* --- 场景 B：键盘弹出时 (输入态) --- */
.note-editor-reborn.is-focused {
  /* 高度已经由 style 绑定控制了，这里不需要写 height */

  /* 1. 保持相对定位，不要用 fixed */
  position: relative !important;

  /* 2. 只有这行 min-height 是为了防止小屏幕溢出 */
  min-height: 200px !important;

  /* 3. 去掉过渡，响应更干脆 */
  transition: none;
}

/* --- 场景 C：编辑旧笔记 (全屏模式) --- */
/* 保持原有的逻辑，优先级最高 */
.note-editor-reborn.editing-viewport {
  height: 100dvh !important;
  margin-top: 0 !important;
  border-radius: 0;
}

/* 2. 🔥🔥🔥 Android 修复补丁 🔥🔥🔥 */
/* 当可视区域高度小于 600px 时（意味着大概率是手机且键盘弹起了），
   强制把高度设为 100%，铺满键盘上方区域，不再按 80% 计算 */
@media (max-height: 600px) {
  .note-editor-reborn.editing-viewport {
    height: 100dvh !important;
    border-radius: 0 !important; /* 键盘弹起时，建议直角，贴合更紧密 */
  }
}

/* 🔥🔥🔥 电脑端 (PC/Mac/iPad) 专属样式 🔥🔥🔥 */
@media (min-width: 768px) {
  .note-editor-reborn {
    /* 1. 高度调整 */
    /* 手机是 45dvh，电脑屏幕大，可以设为 60vh 甚至 70vh */
    height: 90vh !important;

    /* 或者你喜欢固定像素，也可以写：
    height: 600px !important;
    */

    /* 3. 视觉优化 (可选) */
    /* 电脑上圆角可以稍微大一点，阴影重一点，更有卡片感 */
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.08);
  }
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
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0; /* Flex 布局防溢出经典补丁 */
  overflow: hidden;
}
.note-editor-reborn.android .editor-wrapper {
  overflow-anchor: auto;
}

.editor-textarea {
  width: 100%;
  /* 🔥 核心修改：高度 100%，不再由内容决定高度 */
  height: 100%;
  flex: 1;
  padding: 12px 16px; /* 调整内边距 */

  border: none;
  background-color: transparent;
  color: inherit;
  line-height: 1.6;

  /* 🔥 核心修改：禁止调整大小，开启内部滚动 */
  resize: none;
  overflow-y: auto;

  /* 🔴 删除 min-height 和 max-height */
  /* min-height: 360px; */
  /* max-height: 75dvh; */

  box-sizing: border-box;
  font-family: inherit;
  caret-color: currentColor;
  scrollbar-gutter: stable;
  height: 100%;
  overflow-y: auto; /* 让文字在内部滚动 */
  padding-bottom: 10px; /* 给文字底部留点空隙，别贴着工具栏太紧 */

  scroll-padding-top: 80px;
  padding-top: 10px;
}

/* 4. Android 特殊处理也可以删掉了，或者保留 height: 100% */
.note-editor-reborn.android .editor-textarea {
  /* max-height: 50dvh;  <-- 删除这行 */
  height: 100%;
}

/* 👇 然后在外面写针对大屏幕的规则 */
@media (min-width: 768px) {
  .editor-textarea {
    line-height: 2.0; /* 桌面端行距 */
    padding: 16px 24px; /* 桌面端内边距 */
  }
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
  padding: 3px 9px;
  min-width: 54px;
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

  /* 原来可能写的 8px 太少了，改成 20px 或更多 */
  padding: 4px 10px;

  /* 🔥 核心修改：加大基础间距 */
  /* 解释：env(safe-area...) 是系统保留区，前面加的 24px 是为了防止浏览器底部栏遮挡的额外保险距离 */
  padding-bottom: calc(-20px + constant(safe-area-inset-bottom));
  padding-bottom: calc(-20px + env(safe-area-inset-bottom));

  background-color: #fff;
  border-top: 1px solid #eee;
  z-index: 100;
  flex-shrink: 0;

  /* 确保内边距不会撑大整体高度导致溢出 */
  box-sizing: border-box;
}
/* 深色模式适配 */
.dark .editor-footer {
  background-color: #1e1e1e;
  border-top-color: #333;
}
/* ===== 录音条（固定在工具栏上方） ===== */
.record-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  margin: 0 8px 2px;
  border-radius: 8px;
  background-color: #f3f4f6;
  border: 1px solid #e5e7eb;
  gap: 8px;
  font-size: 13px;
}
.dark .record-bar {
  background-color: #374151;
  border-color: #4b5563;
}

.record-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.record-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background-color: #9ca3af;
}
.record-dot.active {
  background-color: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25);
}

.record-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #4b5563;
}
.dark .record-text {
  color: #e5e7eb;
}

.record-time {
  margin-left: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #6b7280;
  white-space: nowrap;       /* ✅ 让时间 + 剩余一起尽量不换行 */
}
.dark .record-time {
  color: #d1d5db;
}

.record-remaining {
  margin-left: 2px;          /* ✅ 间距更紧一点，减少换行概率 */
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #ef4444;
}
.dark .record-remaining {
  color: #f97316;
}

.record-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.record-btn {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.record-btn-primary {
  background-color: #ef4444;
  color: #fff;
  border-color: #ef4444;
}
.record-btn-primary:hover {
  background-color: #dc2626;
  border-color: #dc2626;
}

.record-btn-secondary {
  background-color: #e5e7eb;
  color: #374151;
  border-color: #d1d5db;
}
.record-btn-secondary:hover {
  background-color: #d1d5db;
}
.dark .record-btn-secondary {
  background-color: #4b5563;
  color: #e5e7eb;
  border-color: #6b7280;
}
.dark .record-btn-secondary:hover {
  background-color: #6b7280;
}

.record-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 工具栏按钮间距（维持你之前已加大的 8px） */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
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
  margin-left: 0px;
  background-color: rgba(0,0,0,0.08);
}
.dark .toolbar-sep { background-color: rgba(255,255,255,0.18); }

/* ======= 更小的样式弹层（紧贴 Aa 上方） ======= */
/* ======= 更小的样式弹层（紧贴 Aa 上方） ======= */
.format-palette {
  position: absolute;
  z-index: 1100;
  transform: translateX(-50%);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  /* 2. gap 控制上下两行的距离，你可以根据需要调整这个数值（例如 8px, 10px, 12px） */
  gap: 10px;
  /* 3. 稍微调整一下内边距，原来是 2px 4px，稍微加大一点会让整体更协调 */
  padding: 6px 6px;
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
  transform: translate(calc(-50% - 7px), 3px) rotate(45deg);
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
.icon-20.icon-link-small {
  width: 16px;
  height: 16px;
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

/* 底部工具栏：拉大四个图标左右间距 */
.editor-footer .toolbar-btn {
  margin: 0 3px; /* 原本一般是 4px～6px，这里加大到 10px */
}

/* 草稿提示遮罩：覆盖在编辑器区域上方 */
.draft-prompt-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;

  /* ✅ 修改 1：改成淡淡的半透明黑色，让背后的字能透出来 */
  background-color: rgba(0, 0, 0, 0.05);

  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;

  /* ✅ 修改 2：删除了 backdrop-filter: blur(2px); */
  /* backdrop-filter: blur(2px); */
}

/* 深色模式 */
.dark .draft-prompt-overlay {
  /* ✅ 修改 3：深色模式也稍微加深一点点遮罩即可 */
  background-color: rgba(0, 0, 0, 0.4);
}

.draft-prompt-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 20px 24px;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 80%;
  min-width: 280px;
}
.dark .draft-prompt-card {
  background: #1e1e1e;
  border-color: #3f3f46;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
}

.draft-prompt-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #1f2937;
}
.dark .draft-prompt-title { color: #f3f4f6; }

.draft-prompt-content {
  font-size: 14px;
  color: #4b5563;
  margin-bottom: 20px;
  line-height: 1.5;
}
.dark .draft-prompt-content { color: #d1d5db; }

.draft-prompt-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.draft-btn {
  padding: 6px 16px; /* 比工具栏按钮稍微大一点 */
  height: auto;
  font-size: 14px;
}

/* 🔥 新增/修改：顶部工具栏样式 */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;

  /* ✅ 核心 1：适配刘海屏 */
  /* 使用 env(safe-area-inset-top) 确保内容不会被刘海挡住 */
  padding-top: calc(8px + env(safe-area-inset-top));
  height: calc(44px + env(safe-area-inset-top)); /* 稍微定高一点，保证点击区域 */

  background-color: #fff;

  /* ✅ 核心 2：改为下边框 */
  border-bottom: 1px solid #eee;
  /* border-top: 1px solid #eee;  <-- 删掉原来的上边框 */

  z-index: 100;
  flex-shrink: 0; /* 防止被挤压 */
  box-sizing: border-box;
}

.dark .editor-header {
  background-color: #1e1e1e;
  border-bottom-color: #333;
}

/* 录音条稍微调整 margin-top，避免贴太紧 */
.record-bar {
  margin-top: 4px;
}

/* 样式小三角的方向调整（可选） */
/* 因为菜单在下方，小三角应该指向上面 */
.format-caret {
  top: -3px; /* 移到上面 */
  bottom: auto;
  border-left: 1px solid inherit;
  border-top: 1px solid inherit; /* 改为上边框 */
  border-bottom: none;
}
</style>
