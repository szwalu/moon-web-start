// src/composables/useKeyboardPrelift.ts
import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 目标：
 * - 第一次点击/聚焦：把 --prelift-top 设为 liftPx（默认 20px）。
 * - 后续再次点击：如果当前已 >= liftPx，则不再设置（不重复抬升，不累加）。
 * - 键盘期间：无论 visualViewport 怎么变化，都保持至少 liftPx 的抬升。
 * - 失焦/键盘收起：不自动还原（除非你手动调用 clearKeyboardPrelift()）。
 *
 * 使用：
 * const el = ref<HTMLInputElement|null>(null)
 * useKeyboardPrelift(el, 20)
 *
 * 可选 API：
 *   setKeyboardPrelift(px)   // 手动设定绝对抬升值
 *   clearKeyboardPrelift()   // 手动清零（恢复为 0）
 *   getKeyboardPrelift()     // 读取当前抬升像素（number）
 */

const PRELIFT_CSS_VAR = '--prelift-top'
let rafId = 0

export function getKeyboardPrelift(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(PRELIFT_CSS_VAR)
  const n = Number.parseFloat(v || '0')
  return Number.isFinite(n) ? n : 0
}

export function setKeyboardPrelift(px: number) {
  // 绝对覆盖，不叠加，保证“不会越点越高”
  document.documentElement.style.setProperty(PRELIFT_CSS_VAR, `${px}px`)
}

export function clearKeyboardPrelift() {
  document.documentElement.style.setProperty(PRELIFT_CSS_VAR, '0px')
}

export function useKeyboardPrelift(targetEl: Ref<HTMLElement | null>, liftPx = 20) {
  const ensureLiftAtLeast = (px: number) => {
    // 如果当前 < 目标，则提升到目标；否则维持当前（不重复抬）
    const cur = getKeyboardPrelift()
    if (cur + 0.5 < px)
      setKeyboardPrelift(px)
  }

  const keepLiftRaf = () => {
    if (rafId)
      cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      // 键盘期间保持至少 liftPx，不自动降回
      ensureLiftAtLeast(liftPx)
    })
  }

  const onPressStart = () => {
    // 首次点击/聚焦前先确保至少 liftPx
    ensureLiftAtLeast(liftPx)
  }

  const onFocusIn = () => {
    ensureLiftAtLeast(liftPx)
  }

  // 按你的要求：失焦也不恢复，避免体感“跳上跳下”
  const onBlur = () => {
    // 故意不做任何还原
  }

  onMounted(() => {
    const el = targetEl.value
    if (el) {
      el.addEventListener('touchstart', onPressStart, { passive: true })
      el.addEventListener('mousedown', onPressStart as any, { passive: true as any })
      el.addEventListener('focusin', onFocusIn)
      el.addEventListener('blur', onBlur)
    }

    // 键盘/旋转/系统条变化时，维持至少 liftPx（不降低）
    if ('visualViewport' in window) {
      const vv = (window as any).visualViewport
      vv.addEventListener('resize', keepLiftRaf, { passive: true })
      vv.addEventListener('scroll', keepLiftRaf, { passive: true })
      keepLiftRaf()
    }
  })

  onBeforeUnmount(() => {
    const el = targetEl.value
    if (el) {
      el.removeEventListener('touchstart', onPressStart)
      el.removeEventListener('mousedown', onPressStart as any)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('blur', onBlur)
    }
    if ('visualViewport' in window) {
      const vv = (window as any).visualViewport
      vv.removeEventListener('resize', keepLiftRaf)
      vv.removeEventListener('scroll', keepLiftRaf)
    }
    if (rafId)
      cancelAnimationFrame(rafId)
    // 按需求：这里也不清理 --prelift-top
  })
}
