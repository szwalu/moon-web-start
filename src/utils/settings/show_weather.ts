import { t } from '@/composables/i18n'
import { SettingItem, type SettingItemChildren } from '@/types'

const showWeatherOptions: SettingItemChildren<boolean> = [
  { name: () => t('settings.common.show'), key: 'Show', value: true },
  { name: () => t('settings.common.hide'), key: 'Hide', value: false },
]

export const showWeather = new SettingItem({
  name: () => t('settings.showWeather.title'),
  key: 'showWeather',
  children: showWeatherOptions,
  defaultKey: 'Show',
})
