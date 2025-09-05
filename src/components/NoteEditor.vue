<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'

const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  placeholder: { type: String, default: '写点什么...' },
})

const emit = defineEmits(['update:modelValue', 'save', 'cancel'])

// 使用 v-model 绑定
const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})

// [核心修改] 从 useTextareaAutosize 中获取 triggerResize 函数
const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })

const charCount = computed(() => contentModel.value.length)

function handleSave() {
  if (!props.isLoading && contentModel.value)
    emit('save', contentModel.value)
}

function handleCancel() {
  emit('cancel')
}

// [核心修改] 监听 modelValue 的变化
watch(() => props.modelValue, (newValue) => {
  // 当内容被外部清空时 (例如，在父组件中保存后)
  if (newValue === '') {
    // 等待 DOM 更新后，手动触发一次高度重新计算
    nextTick(() => {
      triggerResize()
    })
  }
})
</script>

<template>
  <div class="note-editor-reborn">
    <div class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :placeholder="placeholder"
        :maxlength="maxNoteLength"
      />
    </div>

    <div class="editor-footer">
      <span class="char-counter">
        {{ charCount }}/{{ maxNoteLength }}
      </span>
      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="handleCancel">
          取消
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="isLoading || !contentModel"
          @click="handleSave"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor-reborn {
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

.editor-textarea {
  width: 100%;
  min-height: 120px;
  /* --- 在这里微调，找到最适合你设备的高度 --- */
  max-height: 40vh; /* 例如，可以试试 40vh 或者 35vh */
  padding: 16px;
  border: none;
  background-color: transparent;
  color: inherit;
  font-size: 16px;
  line-height: 1.6;
  resize: none;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  transition: height 0.1s ease-out;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid #e0e0e0;
  background-color: #fff;
  border-radius: 0 0 11px 11px;
}
.dark .editor-footer {
  background-color: #1e1e1e;
  border-top-color: #3a3a3c;
}
.char-counter {
  font-size: 12px;
  color: #6b7280;
}
.dark .char-counter {
  color: #9ca3af;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn-primary {
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-primary:hover { background-color: #009a74; }
.btn-primary:disabled {
  background-color: #a5a5a_regular;
  cursor: not-allowed;
  opacity: 0.7;
}
.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-secondary:hover { background-color: #e0e0e0; }
.dark .btn-secondary {
  background-color: #4b5563;
  color: #fff;
  border-color: #555;
}
.dark .btn-secondary:hover { background-color: #5a6676; }
</style>
