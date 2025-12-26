<script setup lang="ts">
import { computed, h, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

// 如果 SettingSelection 在同级目录，保持 ./ ；如果在 components 根目录，请改为 @/components/SettingSelection.vue
import SettingSelection from '@/components/SettingSelection.vue'
import { useSettingStore } from '@/stores/setting'
import * as S from '@/utils/settings'
import { toggleTheme } from '@/composables/theme'
import { getText } from '@/utils'

// 🔥 [新增] 1. 定义 Props 接收颜色，定义 Emits 用于关闭
const props = defineProps<{
  themeColor?: string
}>()

defineEmits(['close'])

const settingStore = useSettingStore()
const { t } = useI18n()

// 🔥 [新增] 2. 计算当前颜色（有默认值兜底）
const currentThemeColor = computed(() => props.themeColor || '#6366f1')

function renderThemeLabel(option: any) {
  const currentTheme = S.theme.children.find(item => item.key === option.key)!
  const bgColor = currentTheme.value!.bgC
  return h('div', { class: 'flex items-center gap-x-8' }, [
    h('div', { class: 'w-16 h-16 circle border-1 border-fff', style: { backgroundColor: bgColor } }),
    h('div', getText(option.name)),
  ])
}

function handleThemeChange(theme: string) {
  settingStore.setSettings({
    ...settingStore.settings,
    theme,
  })
  toggleTheme(theme)
}

onMounted(() => {
  if (!settingStore.settings.theme || settingStore.settings.theme === 'Default')
    handleThemeChange('Violet')
})
</script>

<template>
  <div
    class="theme-content"
    :style="{
      '--btn-bg': currentThemeColor,
      '--btn-hover': `color-mix(in srgb, ${currentThemeColor}, black 10%)`,
    }"
  >
    <div class="setting-item">
      <SettingSelection
        v-model="settingStore.settings.theme"
        :title="S.theme.name"
        :options="S.theme.children"
        :render-label="renderThemeLabel"
        label-field="name"
        value-field="key"
        :on-update-value="handleThemeChange"
      />
    </div>

    <div class="footer-actions">
      <button class="confirm-btn" @click="$emit('close')">
        {{ t('button.confirm') || '完成' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-content {
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
}

.confirm-btn {
  /* 使用绑定的变量 */
  background-color: var(--btn-bg);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 24px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%; /* 在弹窗里通常全宽看起来比较大气，也可以去掉这行 */
}

.confirm-btn:hover {
  background-color: var(--btn-hover);
}
</style>
