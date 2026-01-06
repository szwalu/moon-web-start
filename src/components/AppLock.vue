<script setup lang="ts">
import { ref, watch } from 'vue'
import { Delete, LockKeyhole } from 'lucide-vue-next'

const props = defineProps<{
  correctCode: string // 父组件传进来的正确密码（从数据库读的）
}>()

const emit = defineEmits(['unlock'])

const inputCode = ref('')
const errorAnim = ref(false)
const isSuccess = ref(false)

// 数字键盘按键处理
function append(num: number) {
  if (inputCode.value.length < 4 && !errorAnim.value && !isSuccess.value)
    inputCode.value += num.toString()
}

// 删除键处理
function backspace() {
  if (inputCode.value.length > 0 && !errorAnim.value && !isSuccess.value)
    inputCode.value = inputCode.value.slice(0, -1)
}

// 核心逻辑：监听输入长度
watch(inputCode, (val) => {
  if (val.length === 4) {
    if (val === props.correctCode) {
      // 1. 密码正确：显示绿色成功状态，并在短暂延迟后解锁
      isSuccess.value = true
      setTimeout(() => {
        emit('unlock')
      }, 300)
    }
    else {
      // 2. 密码错误：触发震动动画，并在动画结束后清空
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
  <div class="lock-overlay">
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
/* 全屏遮罩：层级设为极高，背景适配深色模式 */
.lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background-color: var(--app-bg, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 毛玻璃效果增加高级感 */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  /* 禁止页面滚动 */
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

/* 图标 */
.lock-icon-wrapper {
  color: var(--theme-primary, #6366f1);
  margin-bottom: 16px;
  transition: color 0.3s;
}
.lock-icon-wrapper.success {
  color: #10b981; /* Emerald Green */
}

/* 标题 */
.lock-title {
  margin: 0 0 32px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

/* 圆点区域 */
.dots-container {
  display: flex;
  gap: 20px;
  margin-bottom: 48px;
  height: 16px; /* 占位防止跳动 */
}

.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #ddd;
  transition: all 0.2s ease;
}

/* 圆点激活状态 */
.dot.filled {
  background-color: var(--theme-primary, #6366f1);
  border-color: var(--theme-primary, #6366f1);
  transform: scale(1.1);
}

/* 错误状态：变红 */
.dot.filled.error {
  background-color: #ef4444;
  border-color: #ef4444;
}

/* 成功状态：变绿 */
.dot.filled.success {
  background-color: #10b981;
  border-color: #10b981;
}

/* 键盘布局 */
.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px 32px; /* 行间距 和 列间距 */
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
  color: #333;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.key-btn:active {
  background-color: rgba(0, 0, 0, 0.05);
}

/* 特殊按键样式 */
.delete-btn {
  font-size: 18px;
  color: #666;
}

/* 错误时的震动动画 */
.shake-anim {
  animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
}

@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}

/* === 深色模式适配 (Dark Mode) === */
:global(.dark) .lock-overlay {
  background-color: #1e1e1e;
}

:global(.dark) .lock-title {
  color: #f0f0f0;
}

:global(.dark) .dot {
  border-color: #444;
}

:global(.dark) .key-btn {
  color: #e0e0e0;
}

:global(.dark) .key-btn:active {
  background-color: rgba(255, 255, 255, 0.1);
}

:global(.dark) .delete-btn {
  color: #999;
}
</style>
