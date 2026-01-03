<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCard,
  NModal,
  NResult,
  NSelect,
  NSpin,
  NTabPane,
  NTabs,
  NText,
  NUpload,
  NUploadDragger,
  useMessage,
} from 'naive-ui'
import { CheckCircle2, Download, FileJson, FileText, Upload } from 'lucide-vue-next'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import MobileDateRangePicker from '@/components/MobileDateRangePicker.vue'

const props = defineProps({
  show: { type: Boolean, required: true },
  user: { type: Object, required: true },
  allTags: { type: Array as () => string[], default: () => [] },
})

const emit = defineEmits(['update:show', 'refresh'])

const { t } = useI18n()
const message = useMessage()

const activeTab = ref('export')
const isLoading = ref(false)
const loadingText = ref('')

// ==========================================
// 📤 导出逻辑
// ==========================================
const exportDateRange = ref<[number, number] | null>(null)
const exportTagFilter = ref<string | null>(null)
const exportFormat = ref<'markdown' | 'json'>('json')

const EXPORT_BATCH_SIZE = 100
const EXPORT_MAX_ROWS = 5000

const tagOptions = computed(() => {
  return [...new Set(props.allTags)].map(tag => ({ label: tag, value: tag }))
})

async function handleExport() {
  if (!exportDateRange.value) {
    message.warning(t('notes.select_date_range_first') || '请先选择日期范围')
    return
  }

  isLoading.value = true
  loadingText.value = t('notes.export_preparing') || '正在准备导出...'

  try {
    const [startDate, endDate] = exportDateRange.value
    let allNotes: any[] = []
    let page = 0
    let hasMore = true

    while (hasMore && allNotes.length < EXPORT_MAX_ROWS) {
      const from = page * EXPORT_BATCH_SIZE
      const to = from + EXPORT_BATCH_SIZE - 1

      let query = supabase
        .from('notes')
        .select('content, created_at, weather')
        .eq('user_id', props.user.id)
        .order('created_at', { ascending: false })
        .range(from, to)
        .gte('created_at', new Date(startDate).toISOString())

      const endOfDay = new Date(endDate)
      endOfDay.setHours(23, 59, 59, 999)
      query = query.lte('created_at', endOfDay.toISOString())

      if (exportTagFilter.value)
        query = query.ilike('content', `%${exportTagFilter.value}%`)

      const { data, error } = await query
      if (error)
        throw error

      if (data && data.length > 0) {
        allNotes = allNotes.concat(data)
        page++
        if (data.length < EXPORT_BATCH_SIZE)
          hasMore = false
      }
      else {
        hasMore = false
      }
    }

    if (allNotes.length === 0) {
      message.warning(t('notes.no_notes_to_export_in_range') || '该范围内没有笔记')
      isLoading.value = false
      return
    }

    let blob: Blob
    let fileName: string
    const datePart = `${new Date(startDate).toISOString().slice(0, 10)}_to_${new Date(endDate).toISOString().slice(0, 10)}`

    if (exportFormat.value === 'json') {
      const jsonContent = JSON.stringify(allNotes, null, 2)
      blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' })
      fileName = `notes_backup_${datePart}.json`
    }
    else {
      const textContent = allNotes.map((note) => {
        const separator = '----------------------------------------'
        const date = new Date(note.created_at).toLocaleString('zh-CN')
        return `${separator}\n${t('notes.created_at_label') || '创建时间'}： ${date}\n${separator}\n\n${note.content}\n\n========================================\n\n`
      }).join('')
      blob = new Blob([textContent], { type: 'text/markdown;charset=utf-8' })
      fileName = `notes_export_${datePart}.md`
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    message.success(t('notes.export_all_success', { count: allNotes.length }) || `导出成功 ${allNotes.length} 条`)
  }
  catch (e: any) {
    message.error(e.message || 'Export failed')
  }
  finally {
    isLoading.value = false
  }
}

// ==========================================
// 📥 导入逻辑
// ==========================================
const importFileList = ref<any[]>([])
const importResult = ref<{ success: number; skipped: number; total: number } | null>(null)

function parseMarkdownNotes(text: string) {
  const blocks = text.split('========================================')
  const parsedNotes: any[] = []
  for (const block of blocks) {
    if (!block.trim())
      continue
    const dateMatch = block.match(/创建时间[：:]\s*(.+?)\n/)
    let createdAt = new Date().toISOString()
    if (dateMatch && dateMatch[1]) {
      const d = new Date(dateMatch[1].trim())
      if (!Number.isNaN(d.getTime()))
        createdAt = d.toISOString()
    }
    const contentParts = block.split('----------------------------------------')
    let content = ''
    if (contentParts.length >= 3)
      content = contentParts.slice(2).join('----------------------------------------').trim()
    else
      content = block.trim()

    if (content) {
      parsedNotes.push({
        content,
        created_at: createdAt,
        updated_at: new Date().toISOString(),
        weather: null,
      })
    }
  }
  return parsedNotes
}

async function handleImport() {
  const file = importFileList.value[0]?.file
  if (!file) {
    message.warning(t('notes.import_select_file') || '请选择文件')
    return
  }

  isLoading.value = true
  loadingText.value = t('notes.import_parsing') || '正在解析并导入...'
  importResult.value = null

  try {
    const text = await file.text()
    let notesToInsert: any[] = []

    if (file.name.endsWith('.json')) {
      try {
        const json = JSON.parse(text)
        if (Array.isArray(json)) {
          notesToInsert = json.map(n => ({
            content: n.content,
            created_at: n.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_id: props.user.id,
            id: uuidv4(),
            weather: n.weather || null,
          }))
        }
      }
      catch (e) {
        throw new Error(t('notes.import_json_error') || 'JSON 解析失败，请检查文件格式')
      }
    }
    else {
      const parsed = parseMarkdownNotes(text)
      notesToInsert = parsed.map(n => ({
        ...n,
        user_id: props.user.id,
        id: uuidv4(),
      }))
    }

    if (notesToInsert.length === 0)
      throw new Error(t('notes.import_no_valid_notes') || '未解析到有效笔记')

    const BATCH_INSERT_SIZE = 50
    let successCount = 0

    for (let i = 0; i < notesToInsert.length; i += BATCH_INSERT_SIZE) {
      const batch = notesToInsert.slice(i, i + BATCH_INSERT_SIZE)
      const { error } = await supabase.from('notes').insert(batch)
      if (error)
        throw error
      successCount += batch.length
    }

    importResult.value = {
      success: successCount,
      skipped: 0,
      total: notesToInsert.length,
    }

    message.success(t('notes.import_success_count', { count: successCount }) || `成功导入 ${successCount} 条笔记`)
    importFileList.value = []
    emit('refresh')
  }
  catch (e: any) {
    message.error(`${t('notes.import_failed') || '导入失败'}: ${e.message}`)
  }
  finally {
    isLoading.value = false
  }
}

function handleClose() {
  emit('update:show', false)
  importResult.value = null
  importFileList.value = []
}
</script>

<template>
  <NModal
    :show="show"
    transform-origin="center"
    @update:show="(v) => emit('update:show', v)"
  >
    <NCard
      style="width: 500px; max-width: 90vw;"
      :title="t('settings.backup_data') || '数据备份与恢复'"
      :bordered="false"
      size="small"
      role="dialog"
      aria-modal="true"
      closable
      :content-style="{ paddingTop: '10px' }"
      @close="handleClose"
    >
      <div class="modal-content-wrapper">
        <NTabs v-model:value="activeTab" type="segment" animated>
          <NTabPane name="export" :tab="t('notes.export_all') || '导出笔记'">
            <div class="tab-content-compact">
              <NText depth="3" class="desc-text">
                <i18n-t keypath="notes.export_tip_json" tag="span">
                  <template #json><strong>JSON</strong></template>
                </i18n-t>
                <span v-if="!t('notes.export_tip_json')">
                  {{ t('notes.export_max_limit_hint', { max: EXPORT_MAX_ROWS }) || `单次最多导出 ${EXPORT_MAX_ROWS} 条` }}{{ '建议使用 JSON 格式以保留天气数据。' }}
                </span>
              </NText>

              <div class="compact-form-item date-picker-container">
                <label>1. {{ t('notes.export_select_range') || '选择时间范围' }}</label>
                <MobileDateRangePicker v-model="exportDateRange" />
              </div>

              <div class="compact-form-item">
                <label>2. {{ t('notes.tag_filter_optional') || '按标签筛选（可选）' }}</label>
                <NSelect
                  v-model:value="exportTagFilter"
                  :options="tagOptions"
                  clearable
                  filterable
                  size="small"
                  :placeholder="t('notes.all_notes') || '全部笔记'"
                />
              </div>

              <div class="compact-form-item">
                <label>3. {{ t('notes.export_format') || '导出格式' }}</label>
                <div class="format-options-grid">
                  <div
                    class="format-card"
                    :class="{ active: exportFormat === 'json' }"
                    @click="exportFormat = 'json'"
                  >
                    <div class="format-card-header">
                      <FileJson :size="18" />
                      <span class="format-title">JSON</span>
                      <CheckCircle2 v-if="exportFormat === 'json'" :size="16" class="check-icon" />
                    </div>
                    <div class="format-desc">{{ t('notes.export_fmt_json_desc') || '含天气数据 (推荐)' }}</div>
                  </div>

                  <div
                    class="format-card"
                    :class="{ active: exportFormat === 'markdown' }"
                    @click="exportFormat = 'markdown'"
                  >
                    <div class="format-card-header">
                      <FileText :size="18" />
                      <span class="format-title">Markdown</span>
                      <CheckCircle2 v-if="exportFormat === 'markdown'" :size="16" class="check-icon" />
                    </div>
                    <div class="format-desc">{{ t('notes.export_fmt_md_desc') || '阅读通用格式' }}</div>
                  </div>
                </div>
              </div>

              <div class="action-footer">
                <NButton
                  type="primary"
                  size="medium"
                  :loading="isLoading"
                  :disabled="!exportDateRange"
                  style="flex: 1"
                  @click="handleExport"
                >
                  <template #icon><Download /></template>
                  {{ t('notes.confirm_export') || '开始导出' }}
                </NButton>
              </div>
            </div>
          </NTabPane>

          <NTabPane name="import" :tab="t('notes.import_notes') || '导入笔记'">
            <div class="tab-content-compact">
              <div v-if="importResult" class="import-result">
                <NResult status="success" :title="t('notes.import_completed') || '导入完成'">
                  <template #default>
                    {{ t('notes.import_success_count', { count: importResult.success }) || `成功导入: ${importResult.success} 条` }}
                  </template>
                  <template #footer>
                    <NButton size="small" @click="importResult = null">
                      {{ t('notes.continue_import') || '继续导入' }}
                    </NButton>
                  </template>
                </NResult>
              </div>
              <div v-else>
                <NText depth="3" class="desc-text">
                  {{ t('notes.import_desc') || '支持导入 Markdown 或 JSON 备份文件。' }}
                  <br>
                  <span style="font-size:12px; opacity:0.8">
                    * {{ t('notes.import_json_hint') || 'JSON 导入支持恢复天气数据。' }}
                  </span>
                </NText>

                <div class="upload-zone">
                  <NUpload
                    v-model:file-list="importFileList"
                    accept=".md,.json,.txt"
                    :max="1"
                  >
                    <NUploadDragger class="upload-dragger-custom">
                      <div style="margin-bottom: 12px">
                        <Upload :size="32" style="opacity: 0.5" />
                      </div>
                      <NText style="font-size: 14px">
                        {{ t('notes.import_drag_drop') || '点击或拖拽文件到此处' }}
                      </NText>
                      <NText depth="3" style="margin-top: 6px; font-size: 12px;">
                        {{ t('notes.import_formats') || '支持 Markdown / JSON' }}
                      </NText>
                    </NUploadDragger>
                  </NUpload>
                </div>

                <div class="action-footer">
                  <NButton
                    type="primary"
                    size="medium"
                    :loading="isLoading"
                    :disabled="!importFileList.length"
                    style="flex: 1"
                    @click="handleImport"
                  >
                    <template #icon><FileText /></template>
                    {{ t('notes.confirm_import') || '确认导入' }}
                  </NButton>
                </div>
              </div>
            </div>
          </NTabPane>
        </NTabs>
      </div>

      <div v-if="isLoading" class="loading-overlay">
        <NSpin size="large" :description="loadingText" />
      </div>
    </NCard>
  </NModal>
</template>

<style scoped>
.modal-content-wrapper {
  min-height: 350px;
  display: flex;
  flex-direction: column;
}

.tab-content-compact {
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.desc-text {
  font-size: 13px;
  line-height: 1.4;
  margin-bottom: 2px;
}

.compact-form-item label {
  display: block;
  font-weight: 500;
  margin-bottom: 4px;
  font-size: 13px;
}

.format-options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.format-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.format-card:hover {
  border-color: #aaa;
  background-color: #fafafa;
}

.format-card.active {
  border-color: #6366f1;
  background-color: #eef2ff;
  color: #4338ca;
}

.format-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.format-title {
  font-weight: 600;
  font-size: 14px;
}

.format-desc {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
  margin-left: 24px;
}

.format-card.active .format-desc { color: #555; }
.check-icon { margin-left: auto; color: #6366f1; }

.action-footer {
  display: flex;
  align-items: center;
  margin-top: 8px;
}

.hint-text-center {
  font-size: 12px;
  color: #999;
  text-align: center;
  margin-top: 4px;
}

.upload-zone { margin: 12px 0; }
.loading-overlay {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(255,255,255,0.8);
  display: flex; align-items: center; justify-content: center;
  z-index: 100; border-radius: 3px;
}

/* 🔥 [核心修改] 强制拉高上传框的高度，使其与导出界面视觉平衡 */
:deep(.upload-dragger-custom) {
  height: 220px !important; /* 根据导出界面的高度大致估算 */
  display: flex !important;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0 !important; /* 移除默认内边距，让 flex 居中生效 */
}

/* 压缩 MobileDateRangePicker 内部按钮 */
:deep(.date-picker-container .n-button),
:deep(.date-picker-container button) {
  height: 28px !important;
  line-height: 28px !important;
  font-size: 12px !important;
  padding: 0 8px !important;
}

/* Dark Mode 适配 */
:global(.dark) .format-card {
  border-color: #333;
  background-color: #262626;
}
:global(.dark) .format-card:hover { background-color: #333; }
:global(.dark) .format-card.active {
  border-color: #818cf8;
  background-color: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
}
:global(.dark) .format-desc { color: #999; }
:global(.dark) .format-card.active .format-desc { color: #ccc; }
</style>
