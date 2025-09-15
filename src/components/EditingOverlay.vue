<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import NoteEditor from '@/components/NoteEditor.vue'

// 这个组件接收笔记内容，并在关闭或保存时发出事件
const props = defineProps({
  modelValue: { type: String, required: true },
  allTags: { type: Array as ()=>(string[]), default: () => [] },
  maxNoteLength: { type: Number, default: 5000 },
  isCreating: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'save', 'close'])

const internalContent = ref(props.modelValue)
const editorRef = ref<any>(null)

// 监听外部变化
watch(() => props.modelValue, (newValue) => {
  internalContent.value = newValue
})

// 将内部变化通知出去
watch(internalContent, (newValue) => {
  emit('update:modelValue', newValue)
})

function handleSave() {
  emit('save', internalContent.value)
}

function handleClose() {
  emit('close')
}

// 当组件显示时，立即聚焦到编辑器内部的textarea
onMounted(() => {
  // NoteEditor -> textarea
  const textarea = editorRef.value?.$refs.textarea
  if (textarea)
    textarea.focus()
})
</script>

<template>
  <div class="editing-overlay" @click.self="handleClose">
    <div class="editor-container">
      <NoteEditor
        ref="editorRef"
        v-model="internalContent"
        :all-tags="allTags"
        :max-note-length="maxNoteLength"
        placeholder="写点什么..."
        :is-editing="true"
        :is-active="true"
        @save="handleSave"
        @cancel="handleClose"
      />
    </div>
  </div>
</template>

<style scoped>
.editing-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.3);
  z-index: 5000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end; /* 让编辑器从底部出现 */
}

.editor-container {
  /* 这就是我们梦寐以求的高度！ */
  height: 80vh;
  background-color: #f9f9f9;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -5px 20px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;

  /* 动画效果 */
  animation: slide-up 0.25s ease-out;
}

.dark .editor-container {
  background-color: #2c2c2e;
}

/* 穿透修改 NoteEditor 样式，使其完美适配浮层 */
.editor-container :deep(.note-editor-reborn) {
  flex: 1;
  min-height: 0;
  border: none;
  box-shadow: none;
  border-radius: 16px 16px 0 0;
}

.editor-container :deep(.editor-wrapper) {
  flex: 1;
  min-height: 0;
}

.editor-container :deep(.editor-textarea) {
  /* 关键：让textarea自己滚动，并设置安全区 */
  overflow-y: auto !important;
  scroll-padding-bottom: 30vh;
}

@keyframes slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
