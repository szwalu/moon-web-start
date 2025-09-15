<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restored'): void
  (e: 'purged'): void
}>()

const dialog = useDialog()
const message = useMessage()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

interface TrashNote {
  id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  deleted_at: string
}

const loading = ref(false)
const list = ref<TrashNote[]>([])
const selected = ref<string[]>([])

const allChecked = computed({
  get: () => list.value.length > 0 && selected.value.length === list.value.length,
  set: (val: boolean) => {
    if (val)
      selected.value = list.value.map(n => n.id)
    else selected.value = []
  },
})

function daysLeft(n: TrashNote): number {
  const del = new Date(n.deleted_at).getTime()
  const now = Date.now()
  const passed = Math.floor((now - del) / (1000 * 60 * 60 * 24))
  const left = 30 - passed
  return left > 0 ? left : 0
}

async function fetchTrash() {
  if (!user.value)
    return
  loading.value = true
  selected.value = []
  try {
    const { data, error } = await supabase
      .from('notes_trash')
      .select('*')
      .eq('user_id', user.value.id)
      .order('deleted_at', { ascending: false })
    if (error)
      throw error
    list.value = (data || []) as TrashNote[]
  }
  catch (err: any) {
    console.error(err)
    message.error(`加载回收站失败：${err.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

async function restoreOne(id: string) {
  try {
    const { error } = await supabase.rpc('restore_note', { p_note_id: id })
    if (error)
      throw error
    list.value = list.value.filter(n => n.id !== id)
    selected.value = selected.value.filter(s => s !== id)
    message.success('已恢复 1 条笔记')
    emit('restored')
  }
  catch (err: any) {
    console.error(err)
    message.error(`恢复失败：${err.message || '未知错误'}`)
  }
}

async function restoreSelected() {
  if (selected.value.length === 0)
    return
  const ids = [...selected.value]
  loading.value = true
  try {
    for (const id of ids) {
      const { error } = await supabase.rpc('restore_note', { p_note_id: id })
      if (error)
        throw error
    }
    list.value = list.value.filter(n => !ids.includes(n.id))
    selected.value = []
    message.success(`已恢复 ${ids.length} 条笔记`)
    emit('restored')
  }
  catch (err: any) {
    console.error(err)
    message.error(`恢复失败：${err.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

function openPurgeConfirm() {
  if (selected.value.length === 0)
    return
  const count = selected.value.length
  dialog.warning({
    title: '删除确认',
    content: `确定要彻底删除选中的 ${count} 条笔记吗？此操作不可恢复。`,
    negativeText: '取消',
    positiveText: '确认删除',
    onPositiveClick: async () => {
      await confirmPurge()
    },
  })
}

async function confirmPurge() {
  if (selected.value.length === 0 || !user.value)
    return
  const ids = [...selected.value]
  loading.value = true
  try {
    const { error } = await supabase
      .from('notes_trash')
      .delete()
      .in('id', ids)
      .eq('user_id', user.value.id)
    if (error)
      throw error
    list.value = list.value.filter(n => !ids.includes(n.id))
    selected.value = []
    message.success(`已彻底删除 ${ids.length} 条笔记`)
    emit('purged')
  }
  catch (err: any) {
    console.error(err)
    message.error(`彻底删除失败：${err.message || '未知错误'}`)
  }
  finally {
    loading.value = false
  }
}

watch(() => props.show, (v) => {
  if (v)
    fetchTrash()
})
onMounted(() => {
  if (props.show)
    fetchTrash()
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content" role="dialog" aria-modal="true" aria-label="回收站">
        <div class="modal-header">
          <h2 class="modal-title">回收站（保留 30 天）</h2>
          <button class="close-button" @click="emit('close')">&times;</button>
        </div>

        <div class="toolbar">
          <label class="check-all">
            <input
              type="checkbox"
              :checked="allChecked"
              @change="allChecked = ($event.target as HTMLInputElement).checked"
            >
            <span>全选</span>
          </label>
          <div class="spacer" />
          <button class="btn-secondary" :disabled="selected.length === 0 || loading" @click="restoreSelected">恢复</button>
          <button class="btn-danger" :disabled="selected.length === 0 || loading" @click="openPurgeConfirm">彻底删除</button>
        </div>

        <div v-if="loading" class="loading">加载中...</div>
        <div v-else-if="list.length === 0" class="empty">回收站为空</div>

        <div v-else class="trash-list">
          <div
            v-for="n in list"
            :key="n.id"
            class="trash-item"
          >
            <label class="item-check">
              <input
                type="checkbox"
                :checked="selected.includes(n.id)"
                @change="
                  ($event.target as HTMLInputElement).checked
                    ? selected.push(n.id)
                    : selected.splice(selected.indexOf(n.id), 1)
                "
              >
            </label>

            <div class="item-main">
              <div class="content">{{ n.content }}</div>
              <div class="meta">
                <span>创建于：{{ new Date(n.created_at).toLocaleString('zh-CN') }}</span>
                <span>删除于：{{ new Date(n.deleted_at).toLocaleString('zh-CN') }}</span>
                <span class="left">剩余 {{ daysLeft(n) }} 天</span>
              </div>
            </div>

            <div class="item-actions">
              <button class="btn-link" title="恢复" @click="restoreOne(n.id)">恢复</button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary wide" @click="emit('close')">返回</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #fff;
  color: #111;
  width: 92%;
  max-width: 520px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
  padding: 1rem 1rem 0.75rem;
}
.dark .modal-content { background: #2a2a2a; color: #e0e0e0; }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: .5rem;
  border-bottom: 1px solid #eee;
}
.dark .modal-header { border-bottom-color: #444; }
.modal-title { margin: 0; font-size: 20px; font-weight: 700; }
.close-button {
  background: none; border: 0; font-size: 28px; line-height: 1; cursor: pointer; color: #888;
}
.dark .close-button { color: #bbb; }

.toolbar {
  margin: .75rem 0;
  display: flex;
  align-items: center;
  gap: .5rem;
}
.check-all { display: inline-flex; align-items: center; gap: .4rem; }
.spacer { flex: 1; }
.btn-secondary,
.btn-danger {
  padding: .5rem .9rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 14px;
}
.btn-secondary { background: #f3f4f6; color: #111; border-color: #ddd; }
.dark .btn-secondary { background: #3a3a3c; color: #e0e0e0; border-color: #555; }
.btn-danger { background: #ef4444; color: #fff; border-color: #ef4444; }

.loading, .empty {
  text-align: center;
  color: #6b7280;
  padding: 1.25rem 0 .5rem;
}
.dark .loading, .dark .empty { color: #a3a3a3; }

.trash-list { display: flex; flex-direction: column; gap: .75rem; max-height: 60vh; overflow: auto; }
.trash-item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: .5rem .75rem;
  padding: .75rem;
  border-radius: 10px;
  background: #f9fafb;
  border: 1px solid #eee;
}
.dark .trash-item { background: #1f2937; border-color: #374151; }
.item-check { display: flex; align-items: start; padding-top: .2rem; }
.item-main .content {
  white-space: pre-wrap; word-break: break-word; color: inherit; font-size: 14px;
}
.item-main .meta {
  margin-top: .35rem;
  display: flex;
  flex-wrap: wrap;
  gap: .5rem .75rem;
  font-size: 12px;
  color: #6b7280;
}
.dark .item-main .meta { color: #9ca3af; }
.item-main .meta .left { margin-left: auto; }
.item-actions { display: flex; align-items: center; }
.btn-link {
  background: none; border: none; color: #2563eb; cursor: pointer; padding: .25rem .4rem; border-radius: 4px;
}
.btn-link:hover { background: rgba(37,99,235,.08); }
.dark .btn-link { color: #93c5fd; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: .75rem;
  margin-top: .75rem;
  border-top: 1px solid #eee;
}
.dark .modal-footer { border-top-color: #444; }
.wide { min-width: 120px; }
.fade-enter-active,.fade-leave-active { transition: opacity .25s }
.fade-enter-from,.fade-leave-to { opacity: 0 }
</style>
