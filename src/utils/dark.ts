// src/utils/dark.ts
import { useDark, useToggle } from '@vueuse/core'

export const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: '',
  storageKey: 'vueuse-color-scheme',
})

export const toggleDark = useToggle(isDark)
