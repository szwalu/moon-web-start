<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NModal, NRadioButton, NRadioGroup, NSpace } from 'naive-ui'
import { type NoteFontSize as FontSize, useSettingStore } from '@/stores/setting.ts'

// 1. props 定义保持不变
const props = defineProps<{
  show: boolean
}>()

// 2. emit 定义改变：我们只需要一个 'close' 事件
const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const settingsStore = useSettingStore()

// 3. 核心修改：改造 computed
//    - get: 依然读取 props.show
//    - set: 当 Naive UI 的 n-modal 尝试改变值（即关闭时），我们发出 'close' 事件通知父组件
const isVisible = computed({
  get: () => props.show,
  set: (value) => {
    if (!value)
      emit('close')
  },
})

// 这个部分保持不变
const selectedFontSize = computed({
  get: () => settingsStore.noteFontSize,
  set: value => settingsStore.setNoteFontSize(value as FontSize),
})
</script>

<template>
  <NModal v-model:show="isVisible">
    <NCard
      style="width: 400px"
      :title="t('settings.font_title')"
      :bordered="false"
      size="huge"
      role="dialog"
      aria-modal="true"
    >
      <template #header-extra>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </template>

      <NSpace vertical>
        <label>{{ t('settings.font_size_label', '字号大小') }}</label>
        <NRadioGroup v-model:value="selectedFontSize" name="font-size-group">
          <NRadioButton value="small">
            {{ t('settings.font_size_small', '小') }}
          </NRadioButton>
          <NRadioButton value="medium">
            {{ t('settings.font_size_medium', '中') }}
          </NRadioButton>
          <NRadioButton value="large">
            {{ t('settings.font_size_large', '大') }}
          </NRadioButton>
        </NRadioGroup>
      </NSpace>
    </NCard>
  </NModal>
</template>

<style scoped>
.n-card {
  border-radius: 8px;
}

.n-card {
  border-radius: 8px;
}

/* --- 新增这段样式 --- */
.close-btn {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: #888;
  padding: 0;
  line-height: 1;
  transition: color 0.2s;
}
.close-btn:hover {
  color: #333;
}
</style>
