<script setup lang="ts">
// --- 核心改动：引入 watch ---
import { ref, watch } from 'vue'
import { debounce } from 'lodash-es'
import { useI18n } from 'vue-i18n'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import NoteItem from '@/components/NoteItem.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const props = defineProps({
  notes: {
    type: Array as () => any[],
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  hasMore: {
    type: Boolean,
    default: true,
  },
  isSelectionModeActive: {
    type: Boolean,
    default: false,
  },
  selectedNoteIds: {
    type: Array as () => string[],
    default: () => [],
  },
  allTags: {
    type: Array as () => string[],
    default: () => [],
  },
  maxNoteLength: {
    type: Number,
    default: 5000,
  },
  searchQuery: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'loadMore',
  'updateNote',
  'deleteNote',
  'pinNote',
  'copyNote',
  'taskToggle',
  'toggleSelect',
  'dateUpdated',
])

const { t } = useI18n()
const scrollerRef = ref(null)

const expandedNote = ref<string | null>(null)
const editingNoteId = ref<string | null>(null)
const editingNoteContent = ref('')
const isUpdating = ref(false)
const noteContainers = ref({})

const handleScroll = debounce(() => {
  const el = scrollerRef.value?.$el
  if (!el || props.isLoading || !props.hasMore)
    return

  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300)
    emit('loadMore')
}, 200)

// --- 核心改动：用 watch 替换 onMounted 和 onUnmounted ---
watch(scrollerRef, (newScroller, oldScroller) => {
  // 当组件销毁时，oldScroller 会有值，我们需要移除旧的监听器
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)

  // 当组件挂载或更新后，newScroller 会有值，我们添加新的监听器
  if (newScroller?.$el)
    newScroller.$el.addEventListener('scroll', handleScroll)
})

/* --- 核心改动：删除下面的 onMounted 和 onUnmounted ---
onMounted(() => {
  if (scrollerRef.value?.$el) {
    scrollerRef.value.$el.addEventListener('scroll', handleScroll)
  }
})

onUnmounted(() => {
  handleScroll.cancel()
  if (scrollerRef.value?.$el) {
    scrollerRef.value.$el.removeEventListener('scroll', handleScroll)
  }
})
*/

function startEdit(note: any) {
  if (editingNoteId.value)
    cancelEdit()
  editingNoteId.value = note.id
  editingNoteContent.value = note.content
  expandedNote.value = null
}

function cancelEdit() {
  editingNoteId.value = null
  editingNoteContent.value = ''
}

async function handleUpdateNote() {
  if (!editingNoteId.value)
    return
  isUpdating.value = true
  emit('updateNote', { id: editingNoteId.value, content: editingNoteContent.value }, (success: boolean) => {
    if (success)
      cancelEdit()

    isUpdating.value = false
  })
}

async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return
  expandedNote.value = expandedNote.value === noteId ? null : noteId
}

function handleEditorFocus(containerEl: HTMLElement) {
  setTimeout(() => {
    containerEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 300)
}
</script>

<template>
  <div class="notes-list-wrapper">
    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <DynamicScroller
      v-else
      ref="scrollerRef"
      :items="notes"
      :min-item-size="120"
      class="scroller"
      key-field="id"
    >
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="[
            item.content,
            expandedNote === item.id,
            editingNoteId === item.id,
          ]"
          class="note-item-container"
        >
          <div
            :ref="(el) => { if (el) noteContainers[item.id] = el }"
            class="note-selection-wrapper"
            :class="{ 'selection-mode': isSelectionModeActive }"
            @click.stop="isSelectionModeActive && emit('toggleSelect', item.id)"
          >
            <div v-if="isSelectionModeActive" class="selection-indicator">
              <div
                class="selection-circle"
                :class="{ selected: selectedNoteIds.includes(item.id) }"
              />
            </div>
            <div class="note-content-wrapper">
              <NoteEditor
                v-if="editingNoteId === item.id"
                v-model="editingNoteContent"
                :is-editing="true"
                :is-loading="isUpdating"
                :max-note-length="maxNoteLength"
                :placeholder="$t('notes.update_note')"
                :all-tags="allTags"
                @save="handleUpdateNote"
                @cancel="cancelEdit"
                @focus="handleEditorFocus(noteContainers[item.id])"
              />
              <NoteItem
                v-else
                :note="item"
                :is-expanded="expandedNote === item.id"
                :is-selection-mode-active="isSelectionModeActive"
                :search-query="searchQuery"
                @toggle-expand="toggleExpand"
                @edit="startEdit"
                @copy="(content) => emit('copyNote', content)"
                @pin="(note) => emit('pinNote', note)"
                @delete="(id) => emit('deleteNote', id)"
                @task-toggle="(payload) => emit('taskToggle', payload)"
                @date-updated="() => emit('dateUpdated')"
              />
            </div>
          </div>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
          {{ t('notes.loading') }}
        </div>
      </template>
    </DynamicScroller>
  </div>
</template>

<style scoped>
.notes-list-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.scroller {
  height: 100%;
  overflow-y: auto;
}
.note-item-container {
  padding-bottom: 1.5rem;
}
.note-item-container:last-child {
  padding-bottom: 0;
}
.note-selection-wrapper {
  display: flex;
  gap: 0.75rem;
  transition: background-color 0.2s;
}
.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem;
  border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.dark .note-selection-wrapper.selection-mode:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
.note-content-wrapper {
  flex: 1;
  min-width: 0;
}
.selection-indicator {
  padding-top: 0.75rem;
}
.selection-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #ccc;
  transition: all 0.2s ease;
}
.dark .selection-circle {
  border-color: #555;
}
.selection-circle.selected {
  background-color: #00b386;
  border-color: #00b386;
  position: relative;
}
.selection-circle.selected::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.text-gray-500 {
  color: #6b7280;
}
.dark .text-gray-500 {
  color: #9ca3af;
}
</style>
