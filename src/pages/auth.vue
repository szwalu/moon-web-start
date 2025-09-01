<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDark } from '@vueuse/core'
import { useDialog, useMessage } from 'naive-ui'
import { debounce } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'
import NoteList from '@/components/NoteList.vue'
import NoteEditor from '@/components/NoteEditor.vue'
import Authentication from '@/components/Authentication.vue'
import AnniversaryBanner from '@/components/AnniversaryBanner.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import AccountModal from '@/components/AccountModal.vue'
import 'easymde/dist/easymde.min.css'

// --- 初始化 & 状态定义 ---
useDark()
const { t } = useI18n()
const router = useRouter()
const messageHook = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()

// [关键改动] 使用 isEditing 状态来切换视图
const isEditing = ref(false)
const showSettingsModal = ref(false)
const showAccountModal = ref(false)
const showDropdown = ref(false)
const dropdownContainerRef = ref(null)
const notesListWrapperRef = ref<HTMLElement | null>(null)
const user = computed(() => authStore.user)
const loading = ref(false)

// --- 笔记相关状态 (已简化) ---
const notes = ref<any[]>([])
const content = ref('')
const editingNote = ref<any>(null)
const isLoadingNotes = ref(false)

let authListener: any = null

const debouncedSaveNote = debounce(() => {
  if (content.value && user.value?.id)
    saveNote({ showMessage: false })
}, 12000)

// --- 生命周期钩子 ---
onMounted(() => {
  const result = supabase.auth.onAuthStateChange(
    (_event, session) => {
      authStore.user = session?.user ?? null
      if (authStore.user) {
        nextTick(() => {
          fetchNotes()
        })
      }
      else {
        notes.value = []
        content.value = ''
        editingNote.value = null
      }
    },
  )
  authListener = result.data.subscription
})

onUnmounted(() => {
  if (authListener)
    authListener.unsubscribe()
  document.removeEventListener('click', closeDropdownOnClickOutside)
  debouncedSaveNote.cancel()
})

// --- 核心业务逻辑函数 ---
function closeDropdownOnClickOutside(event: MouseEvent) {
  if (dropdownContainerRef.value && !(dropdownContainerRef.value as HTMLElement).contains(event.target as Node))
    showDropdown.value = false
}

watch(showDropdown, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      document.addEventListener('click', closeDropdownOnClickOutside)
    })
  }
  else {
    document.removeEventListener('click', closeDropdownOnClickOutside)
  }
})

async function fetchNotes() {
  if (!user.value)
    return
  isLoadingNotes.value = true
  try {
    const { data, error } = await supabase.from('notes').select('*').eq('user_id', user.value.id).order('created_at', { ascending: false })
    if (error)
      throw error
    notes.value = data || []
  }
  catch (err: any) {
    messageHook.error(`${t('notes.fetch_error')}: ${err.message}`)
  }
  finally {
    isLoadingNotes.value = false
  }
}

async function saveNote({ showMessage = false } = {}) {
  if (!content.value.trim() || !user.value?.id)
    return null
  loading.value = true
  try {
    const noteData = { content: content.value.trim(), updated_at: new Date().toISOString() }
    let savedNote
    if (editingNote.value) {
      const { data, error } = await supabase.from('notes').update(noteData).eq('id', editingNote.value.id).select()
      if (error || !data)
        throw error
      savedNote = data[0]
      const index = notes.value.findIndex(n => n.id === savedNote.id)
      if (index !== -1)
        notes.value[index] = savedNote
    }
    else {
      const { data, error } = await supabase.from('notes').insert({ ...noteData, user_id: user.value.id, id: uuidv4() }).select()
      if (error || !data)
        throw error
      savedNote = data[0]
      notes.value.unshift(savedNote)
    }
    if (showMessage)
      messageHook.success(editingNote.value ? '更新成功' : '保存成功')
    return savedNote
  }
  catch (error: any) {
    messageHook.error(`保存失败: ${error.message}`)
    return null
  }
  finally {
    loading.value = false
  }
}

function resetEditorAndState() {
  content.value = ''
  editingNote.value = null
}

function handleAddNewNoteClick() {
  debouncedSaveNote.cancel()
  resetEditorAndState()
  isEditing.value = true
}

function handleEdit(note: any) {
  content.value = note.content
  editingNote.value = { ...note }
  isEditing.value = true
}

async function handleSubmit() {
  const saved = await saveNote({ showMessage: true })
  if (saved) {
    resetEditorAndState()
    isEditing.value = false
  }
}

function handleCloseEditor() {
  if (!editingNote.value && content.value.trim()) {
    dialog.warning({
      title: '提醒',
      content: '内容尚未保存，确定要退出吗？',
      positiveText: '确定退出',
      negativeText: '取消',
      onPositiveClick: () => {
        resetEditorAndState()
        isEditing.value = false
      },
    })
  }
  else {
    resetEditorAndState()
    isEditing.value = false
  }
}
</script>

<template>
  <div class="auth-container">
    <template v-if="user">
      <template v-if="isEditing">
        <div class="editor-view-header">
          <button class="header-action-btn" @click="handleCloseEditor">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m6.4 18l-.7-.7l5.6-5.6L5.7 6.1l.7-.7l5.6 5.6l5.6-5.6l.7.7l-5.6 5.6l5.6 5.6l-.7.7l-5.6-5.6z" /></svg>
          </button>
          <h1 class="page-title">{{ editingNote ? '编辑笔记' : '新建笔记' }}</h1>
          <button class="header-action-btn submit-btn" :disabled="loading || !content.trim()" @click="handleSubmit">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m9 20.42l-6.21-6.21l1.41-1.41L9 17.59l10.59-10.59l1.41 1.41z" /></svg>
          </button>
        </div>
        <NoteEditor
          v-model="content"
          @trigger-auto-save="debouncedSaveNote"
        />
      </template>

      <template v-else>
        <div class="page-header">
          <div ref="dropdownContainerRef" class="dropdown-menu-container">
            <button class="header-action-btn" @click.stop="showDropdown = !showDropdown">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h16v2H4zm0 5h12v2H4zm0 5h8v2H4z" /></svg>
            </button>
            <Transition name="fade">
              <div v-if="showDropdown" class="dropdown-menu">
                <div class="dropdown-item" @click.stop="showSettingsModal = true; showDropdown = false">设置</div>
                <div class="dropdown-item" @click.stop="showAccountModal = true; showDropdown = false">账户</div>
              </div>
            </Transition>
          </div>
          <h1 class="page-title">{{ $t('notes.notes') }}</h1>
          <div class="header-actions">
            <button class="header-action-btn" @click="router.push('/')">×</button>
          </div>
        </div>
        <AnniversaryBanner />
        <div ref="notesListWrapperRef" class="notes-list-wrapper">
          <NoteList
            :notes="notes"
            :is-loading="isLoadingNotes"
            @edit="handleEdit"
          />
        </div>
        <button class="fab" @click="handleAddNewNoteClick">+</button>
      </template>

      <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />
      <AccountModal :show="showAccountModal" :email="user?.email" :total-notes="notes.length" :user="user" @close="showAccountModal = false" />
    </template>
    <template v-else>
      <Authentication />
    </template>
  </div>
</template>

<style scoped>
.auth-container {
  max-width: 480px;
  margin: 0 auto;
  background: white;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding: 0 1.5rem;
}
.dark .auth-container {
  background: #1e1e1e;
  color: #e0e0e0;
}

/* 列表视图的样式 */
.page-header {
  flex-shrink: 0;
  padding: 0.75rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  height: 44px;
}
.page-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}
.dark .page-title {
  color: #f0f0f0;
}
.notes-list-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.fab {
  position: absolute;
  bottom: 2.5rem;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: #00b386;
  color: white;
  border: none;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  z-index: 40;
}

/* 编辑视图的新增样式 */
.editor-view-header {
  flex-shrink: 0;
  padding: 0.75rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 44px;
  position: relative;
}

.header-action-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #555;
  border-radius: 50%;
  z-index: 1;
}
.dark .header-action-btn {
  color: #bbb;
}
.header-action-btn:disabled {
  color: #ccc;
}
.dark .header-action-btn:disabled {
  color: #555;
}
.submit-btn {
  color: #00b386;
}

/* 其他通用样式 */
.dropdown-menu-container { position: relative; }
.dropdown-menu { position: absolute; top: 100%; left: 0; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #eee; padding: 0.5rem 0; z-index: 100; width: 120px; }
.dark .dropdown-menu { background: #2c2c2e; border-color: #444; }
.dropdown-item { padding: 1rem; cursor: pointer; }
.header-actions { display: flex; align-items: center; gap: .5rem; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
