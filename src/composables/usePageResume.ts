// src/composables/usePageResume.ts
import { nextTick, onMounted, onUnmounted } from 'vue'

type SaveStateFn = () => Record<string, any>
type RestoreStateFn = (s: Record<string, any>) => void

interface Options {
  storageKey: string
  scrollSelector?: string
  saveExtra?: SaveStateFn
  restoreExtra?: RestoreStateFn
}

export function usePageResume(opts: Options) {
  const key = opts.storageKey

  const getScroller = (): HTMLElement | Window => {
    if (!opts.scrollSelector)
      return window

    const el = document.querySelector<HTMLElement>(opts.scrollSelector)
    if (el)
      return el

    return window
  }

  const read = () => {
    try {
      const raw = sessionStorage.getItem(key) || '{}'
      return JSON.parse(raw)
    }
    catch {
      return {}
    }
  }

  const write = (s: any) => {
    try {
      const raw = JSON.stringify(s)
      sessionStorage.setItem(key, raw)
    }
    catch {
      // ignore
    }
  }

  const save = () => {
    const sc = getScroller()
    const scrollTop = sc === window ? window.scrollY : (sc as HTMLElement).scrollTop
    const extra = opts.saveExtra ? opts.saveExtra() : {}
    write({ scrollTop, ts: Date.now(), ...extra })
  }

  const restore = async () => {
    const s = read()

    // 临时禁用过渡，避免闪
    document.documentElement.classList.add('restoring')

    await nextTick()

    const sc = getScroller()

    const doScroll = () => {
      if (typeof s.scrollTop === 'number') {
        if (sc === window)
          window.scrollTo(0, s.scrollTop)

        else
          (sc as HTMLElement).scrollTop = s.scrollTop
      }
    }

    requestAnimationFrame(() => {
      doScroll()
      requestAnimationFrame(() => {
        doScroll()

        if (opts.restoreExtra)
          opts.restoreExtra(s)

        window.setTimeout(() => {
          document.documentElement.classList.remove('restoring')
        }, 120)
      })
    })
  }

  const onHide = () => {
    save()
  }

  const onVis = () => {
    if (document.hidden)
      save()
  }

  onMounted(() => {
    restore()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onVis)
  })

  onUnmounted(() => {
    window.removeEventListener('pagehide', onHide)
    window.removeEventListener('beforeunload', onHide)
    document.removeEventListener('visibilitychange', onVis)
  })

  return { saveNow: save, restoreNow: restore }
}
