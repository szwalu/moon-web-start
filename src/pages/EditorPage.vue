<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NoteEditor from '@/components/NoteEditor.vue'

// 假设您有从 supabase 获取数据的函数
import { fetchNoteById } from '@/api/notes'

const route = useRoute()
const router = useRouter()

const noteContent = ref('')
const currentNote = ref(null)
const isDataReady = ref(false)

onMounted(async () => {
  const noteId = route.params.id
  if (noteId) {
    // 这是编辑模式，根据ID加载笔记内容
    const note = await fetchNoteById(noteId)
    if (note) {
      currentNote.value = note
      noteContent.value = note.content
    }
  }
  // 如果没有 noteId，就是新建笔记模式，noteContent 默认为空
  isDataReady.value = true
})

async function handleSave() {
  // ... 保存逻辑 ...
  // 保存成功后返回列表页
  router.back()
}
</script>

<template>
  <div>
    <NoteEditor
      v-if="isDataReady"
      v-model="noteContent"
      :editing-note="currentNote"
      @submit="handleSave"
    />
  </div>
</template>
