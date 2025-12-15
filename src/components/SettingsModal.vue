<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NModal, NRadioButton, NRadioGroup, NSpace, NSwitch } from 'naive-ui'
import { type NoteFontSize as FontSize, useSettingStore } from '@/stores/setting.ts'

type UiFontSize = 'xs' | 'sm' | 'md' | 'lg'
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const UI_FONT_KEY = 'ui_font_size'
const UI_FOLLOW_KEY = 'ui_font_follow'

const uiPxMap: Record<UiFontSize, string> = { xs: '12px', sm: '13px', md: '14px', lg: '15px' }

function readUiFont(): UiFontSize {
  const v = localStorage.getItem(UI_FONT_KEY)
  return v === 'xs' || v === 'sm' || v === 'md' || v === 'lg' ? v : 'md'
}
function readUiFollow(): boolean {
  return localStorage.getItem(UI_FOLLOW_KEY) === 'true'
}
function writeUiFont(v: UiFontSize) {
  localStorage.setItem(UI_FONT_KEY, v)
}
function writeUiFollow(flag: boolean) {
  localStorage.setItem(UI_FOLLOW_KEY, String(flag))
}

/** 仅对浮层/抽屉/下拉/消息等系统 UI 应用字号；不改主文档流 */
function ensureGlobalUiFontStyle(px: string) {
  const id = 'ui-font-global'
  let styleEl = document.getElementById(id) as HTMLStyleElement | null

  const css = `
:root { --ui-font: ${px}; }

/* ==============================================
   1. 核心容器覆盖
   ============================================== */
.n-drawer,
.n-dropdown,
.n-dropdown-menu,
.n-base-select-menu,
.n-popover,
.n-popconfirm,
.n-modal,
.n-message,
.n-notification,
.v-binder-follower {
  /* 强制覆盖 Naive UI 组件内部读取的 CSS 变量 */
  --n-font-size: var(--ui-font) !important;
  font-size: var(--ui-font) !important;
}

/* ==============================================
   2. 针对 Dropdown 菜单项的强力修正 (解决你的问题)
   ============================================== */
/* 使用 "菜单容器 + 选项" 的组合选择器，提升优先级 */
.n-dropdown-menu .n-dropdown-option-body,
.n-dropdown-menu .n-dropdown-option-body__label,
.n-dropdown-menu .n-dropdown-option-body__prefix,
.n-dropdown-menu .n-dropdown-option-body__suffix,
.n-dropdown-menu .n-dropdown-option-body .n-icon {
  font-size: var(--ui-font) !important;
}

/* 确保图标大小也跟随变动 */
.n-dropdown-menu .n-icon {
  font-size: var(--ui-font) !important;
}

/* ==============================================
   3. 通用继承 (处理自定义内容，如截图下半部分)
   ============================================== */
.n-drawer :where(*):not(svg):not(svg *),
.n-dropdown :where(*):not(svg):not(svg *),
.n-dropdown-menu :where(*):not(svg):not(svg *),
.n-base-select-menu :where(*):not(svg):not(svg *),
.n-popover :where(*):not(svg):not(svg *),
.n-popconfirm :where(*):not(svg):not(svg *),
.n-modal :where(*):not(svg):not(svg *),
.n-message :where(*):not(svg):not(svg *),
.n-notification :where(*):not(svg):not(svg *),
.v-binder-follower :where(.n-select-menu, .n-date-panel, .n-time-picker, .n-cascader-menu, .n-tree-select-menu, .n-color-picker-panel, .n-mention, .n-auto-complete, .n-transfer) :where(*):not(svg):not(svg *) {
  font-size: inherit !important;
}

/* ==============================================
   4. 特殊层级修正 (嵌套菜单等)
   ============================================== */
.n-drawer .n-menu :where(*):not(svg):not(svg *),
.n-dropdown-menu .n-menu :where(*):not(svg):not(svg *),
.n-popover .n-menu :where(*):not(svg):not(svg *) {
  font-size: inherit !important;
}
`.trim()

  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = id
    styleEl.type = 'text/css'
    styleEl.appendChild(document.createTextNode(css))
    document.head.appendChild(styleEl)
  }
  else {
    styleEl.textContent = css
  }
}

function mapNoteToUi(noteSize: FontSize): UiFontSize {
  const map: Record<FontSize, UiFontSize> = {
    'small': 'sm',
    'medium': 'md',
    'large': 'lg',
    'extra-large': 'lg',
  }
  return map[noteSize]
}

const { t } = useI18n()
const settingsStore = useSettingStore()

const isVisible = computed({
  get: () => props.show,
  set: (v) => {
    if (!v)
      emit('close')
  },
})

const selectedFontSize = computed({
  get: () => settingsStore.noteFontSize || 'medium',
  set: v => settingsStore.setNoteFontSize(v as FontSize),
})

const uiFontSize = ref<UiFontSize>(readUiFont())
const uiFontFollowsNote = ref<boolean>(readUiFollow())

// 让初始焦点落在关闭按钮，避免第一个单选（"小"）出现焦点框
const closeBtnRef = ref<HTMLButtonElement | null>(null)
watch(isVisible, async (v) => {
  if (v) {
    await nextTick()
    closeBtnRef.value?.focus()
  }
})

onMounted(() => {
  ensureGlobalUiFontStyle(uiPxMap[uiFontSize.value])
  if (uiFontFollowsNote.value) {
    const mapped = mapNoteToUi(settingsStore.noteFontSize)
    if (mapped !== uiFontSize.value) {
      uiFontSize.value = mapped
      writeUiFont(mapped)
      ensureGlobalUiFontStyle(uiPxMap[mapped])
    }
  }
})

watch(uiFontSize, (v) => {
  writeUiFont(v)
  ensureGlobalUiFontStyle(uiPxMap[v])
})

watch(uiFontFollowsNote, (flag) => {
  writeUiFollow(flag)
  if (flag) {
    const mapped = mapNoteToUi(settingsStore.noteFontSize)
    uiFontSize.value = mapped
  }
})

watch(() => settingsStore.noteFontSize, (noteSize) => {
  if (!uiFontFollowsNote.value)
    return
  const mapped = mapNoteToUi(noteSize)
  if (mapped !== uiFontSize.value)
    uiFontSize.value = mapped
})
</script>

<template>
  <NModal v-model:show="isVisible" :auto-focus="false">
    <NCard
      style="width: 420px"
      :title="t('settings.font_title', '字号设置')"
      :bordered="false"
      size="huge"
      role="dialog"
      aria-modal="true"
    >
      <template #header-extra>
        <button ref="closeBtnRef" class="close-btn" @click="emit('close')">&times;</button>
      </template>

      <NSpace vertical size="large">
        <!-- 内容字号（编辑器/列表/正文） -->
        <section>
          <label class="group-label">
            {{ t('settings.font_size_label', '内容字号（笔记编辑与列表）') }}
          </label>
          <NRadioGroup v-model:value="selectedFontSize" name="note-font-size-group">
            <NRadioButton value="small">
              {{ t('settings.font_size_small', '小') }}
            </NRadioButton>
            <NRadioButton value="medium">
              {{ t('settings.font_size_medium', '中') }}
            </NRadioButton>
            <NRadioButton value="large">
              {{ t('settings.font_size_large', '大') }}
            </NRadioButton>
            <NRadioButton value="extra-large">
              {{ t('settings.font_size_extra_large', '特大') }}
            </NRadioButton>
          </NRadioGroup>
        </section>

        <!-- 系统字号（界面 UI） -->
        <section>
          <div class="row">
            <label class="group-label">
              {{ t('settings.ui_font_title', '系统字号（界面控件）') }}
            </label>
            <div class="follow">
              <span class="follow-text">
                {{ t('settings.ui_font_follow_note', '跟随内容字号') }}
              </span>
              <NSwitch v-model:value="uiFontFollowsNote" />
            </div>
          </div>

          <NRadioGroup
            v-model:value="uiFontSize"
            name="ui-font-size-group"
            :disabled="uiFontFollowsNote"
          >
            <NRadioButton value="xs">
              {{ t('settings.ui_font_xs', '极小') }}
            </NRadioButton>
            <NRadioButton value="sm">
              {{ t('settings.ui_font_sm', '偏小') }}
            </NRadioButton>
            <NRadioButton value="md">
              {{ t('settings.ui_font_md', '适中') }}
            </NRadioButton>
            <NRadioButton value="lg">
              {{ t('settings.ui_font_lg', '偏大') }}
            </NRadioButton>
          </NRadioGroup>

          <p class="hint">
            {{ t('settings.ui_font_hint', '提示：系统字号影响抽屉、下拉、弹窗、消息等界面元素；开启“跟随”后将根据内容字号自动选择合适的系统字号。') }}
          </p>
        </section>
      </NSpace>
    </NCard>
  </NModal>
</template>

<style scoped>
.n-card { border-radius: 8px; }

/* 关闭按钮 */
.close-btn {
  background: none;
  border: none;
  font-size: 28px !important;
  cursor: pointer;
  color: #888;
  padding: 0;
  line-height: 1;
  transition: color 0.2s;
}
.close-btn:hover { color: #333; }

.group-label {
  display: inline-block;
  margin-bottom: 10px;
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.follow { display: inline-flex; align-items: center; gap: 8px; }
.follow-text { opacity: 0.8; font-size: 13px; }

.hint { margin-top: 10px; font-size: 12px; opacity: 0.7; }

/* 关键：未选中的单选按钮获得焦点时，不显示默认焦点外框 */
:deep(.n-radio-button:not(.n-radio-button--checked):focus),
:deep(.n-radio-button:not(.n-radio-button--checked):focus-visible) {
  outline: none !important;
  box-shadow: none !important;
}

/* 修改字号设置弹窗标题文字大小 */
:deep(.n-card-header__main) {
  font-size: 18px !important;
  font-weight: 600; /* 可选 */
}
</style>
