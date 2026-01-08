<script setup lang="ts">
import { ref, watch } from 'vue'
import { Delete, LockKeyhole } from 'lucide-vue-next'

const props = defineProps<{
  correctCode: string
}>()

const emit = defineEmits(['unlock'])

const inputCode = ref('')
const errorAnim = ref(false)
const isSuccess = ref(false)

function append(num: number) {
  if (inputCode.value.length < 4 && !errorAnim.value && !isSuccess.value)
    inputCode.value += num.toString()
}

function backspace() {
  if (inputCode.value.length > 0 && !errorAnim.value && !isSuccess.value)
    inputCode.value = inputCode.value.slice(0, -1)
}

watch(inputCode, (val) => {
  if (val.length === 4) {
    if (val === props.correctCode) {
      isSuccess.value = true
      setTimeout(() => {
        emit('unlock')
      }, 300)
    }
    else {
      errorAnim.value = true
      setTimeout(() => {
        inputCode.value = ''
        errorAnim.value = false
      }, 500)
    }
  }
})
</script>

<template>
  <div id="app-lock-overlay" class="lock-overlay">
    <div class="lock-content" :class="{ 'shake-anim': errorAnim }">
      <div class="lock-icon-wrapper" :class="{ success: isSuccess }">
        <LockKeyhole :size="40" :stroke-width="2" />
      </div>

      <h2 class="lock-title">
        {{ isSuccess ? $t('settings.lock_screen_success') : $t('settings.lock_screen_prompt') }}
      </h2>

      <div class="dots-container">
        <div
          v-for="i in 4"
          :key="i"
          class="dot"
          :class="{
            filled: inputCode.length >= i,
            error: errorAnim,
            success: isSuccess,
          }"
        />
      </div>

      <div class="keypad-grid">
        <button
          v-for="n in 9"
          :key="n"
          class="key-btn"
          @click="append(n)"
        >
          {{ n }}
        </button>

        <div class="key-placeholder" />

        <button class="key-btn" @click="append(0)">0</button>

        <button class="key-btn delete-btn" @click="backspace">
          <Delete :size="24" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;

  /* 默认背景 (亮色) */
  background-color: #ffffff;
  /* 如果你的应用定义了 --app-bg，也可以优先用变量，这里做兜底 */
  background-color: var(--app-bg, #ffffff);

  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overscroll-behavior: none;
  touch-action: none;
}

.lock-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 320px;
  padding: 0 20px;
}

.lock-icon-wrapper {
  color: var(--theme-primary, #6366f1);
  margin-bottom: 16px;
  transition: color 0.3s;
}
.lock-icon-wrapper.success { color: #10b981; }

.lock-title {
  margin: 0 0 32px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333333; /* 默认亮色文字 */
  transition: color 0.3s;
}

.dots-container {
  display: flex;
  gap: 20px;
  margin-bottom: 48px;
  height: 16px;
}

.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #dddddd; /* 默认亮色边框 */
  transition: all 0.2s ease;
}

.dot.filled {
  background-color: var(--theme-primary, #6366f1);
  border-color: var(--theme-primary, #6366f1);
  transform: scale(1.1);
}
.dot.filled.error { background-color: #ef4444; border-color: #ef4444; }
.dot.filled.success { background-color: #10b981; border-color: #10b981; }

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px 32px;
  width: 100%;
}

.key-btn {
  width: 68px;
  height: 68px;
  margin: 0 auto;
  border-radius: 50%;
  border: 1px solid transparent;
  background-color: transparent;
  font-size: 26px;
  font-weight: 500;
  color: #333333; /* 默认亮色按键 */
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.key-btn:active { background-color: rgba(0, 0, 0, 0.05); }

.delete-btn { font-size: 18px; color: #666666; }

.shake-anim { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}
</style>

<style>
/* 使用 "html.dark .lock-overlay" 这种选择器，
  它能无视组件层级，直接命中 DOM 结构，修复“不生效”的问题。
*/
html.dark .lock-overlay,
body.dark .lock-overlay {
  background-color: #1e1e1e !important;
}

html.dark .lock-title {
  color: #f0f0f0 !important;
}

html.dark .lock-content .dot {
  border-color: #444444 !important;
}

/* 注意：填充状态不需要改 border，因为是用的主题色/红色/绿色，深色模式也通用 */

html.dark .key-btn {
  color: #e0e0e0 !important;
}

html.dark .key-btn:active {
  background-color: rgba(255, 255, 255, 0.1) !important;
}

html.dark .delete-btn {
  color: #999999 !important;
}
</style>
