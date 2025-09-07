<script setup lang="ts">
import { ref } from 'vue'
import { DatePicker } from 'v-calendar'
import 'v-calendar/dist/style.css'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  initialDate: {
    type: Date,
    default: () => new Date(),
  },
})

const emit = defineEmits(['close', 'confirm'])

const selectedDate = ref(new Date(props.initialDate))
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content">
        <DatePicker
          v-model="selectedDate"
          mode="dateTime"

          is-expanded is24hr hide-time-header
        />
        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('close')">取消</button>
          <button class="btn-primary" @click="emit('confirm', selectedDate)">确定</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.dark .modal-content {
  background: #2c2c2e;
}

:deep(.vc-container) {
  border: none;
  font-family: inherit;
}
.dark :deep(.vc-container) {
  background: transparent;
  color: #f0f0f0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
/* -- Reusing button styles from your app -- */
.btn-primary, .btn-secondary {
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s;
}
.btn-primary {
  background-color: #00b386;
  color: #fff;
}
.btn-primary:hover {
  background-color: #009a74;
}
.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
}
.btn-secondary:hover {
  background-color: #e0e0e0;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
