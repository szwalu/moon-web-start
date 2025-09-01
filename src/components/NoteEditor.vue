<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])

const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const localValue = ref(props.modelValue)

// 父传值变化时同步
watch(() => props.modelValue, (val) => {
  if (val !== localValue.value)
    localValue.value = val
})

// 输入时更新父组件 + 保持光标可见
async function handleInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  if (val.length > props.maxNoteLength)
    return
  localValue.value = val
  emit('update:modelValue', val)
  emit('triggerAutoSave')

  await nextTick()
  textareaRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div class="note-editor-mobile">
    <form class="editor-form" @submit.prevent="handleSubmit">
      <textarea
        ref="textareaRef"
        v-model="localValue"
        :style="{ fontSize: `${settingsStore.noteFontSize}px` }"
        :placeholder="t('notes.content_placeholder')"
        class="editor-textarea"
        :disabled="isLoading"
        @input="handleInput"
      />
      <div class="editor-footer">
        <span class="char-counter">
          {{ t('notes.char_count') }}: {{ localValue.length }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="ml-2">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
        <button
          type="submit"
          class="save-btn"
          :disabled="isLoading || !localValue"
        >
          {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.note-editor-mobile {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-textarea {
  flex: 1;
  width: 100%;
  resize: none;
  border: none;
  padding: 12px;
  font-family: inherit;
  line-height: 1.6;
  overflow-y: auto;
}

.editor-footer {
  position: sticky;
  bottom: 0;
  background: #fff;
  border-top: 1px solid #ddd;
  padding: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.char-counter {
  font-size: 12px;
  color: #666;
}

.save-btn {
  margin-left: auto;
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: #007aff;
  color: #fff;
  font-size: 14px;
}
.save-btn:disabled {
  opacity: 0.6;
}
</style>
