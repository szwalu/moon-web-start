<script setup lang="ts">
/* eslint-disable style/max-statements-per-line, curly */
import { computed, defineAsyncComponent, defineComponent, h, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import {
  Bell,
  Calendar,
  CheckSquare,
  Download,
  HelpCircle,
  MapPin,
  MessageSquare,
  Palette,
  Settings,
  Shuffle,
  Trash2,
  Type,
  User as UserIcon,
} from 'lucide-vue-next'

import { NButton, NCard, NModal, NSelect, NSpace, NSwitch, NText, useMessage } from 'naive-ui'
import { useSettingStore } from '@/stores/setting'

// 引入 SiteStore 获取书签数据用于上传
import { useSiteStore } from '@/stores/site'

import StatsDetail from '@/components/StatsDetail.vue'
import { supabase } from '@/utils/supabaseClient'

import { requestFcmToken } from '@/utils/firebase'
import * as S from '@/utils/settings'
import { toggleTheme } from '@/composables/theme'
import { getText } from '@/utils'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  user: {
    type: Object as () => User | null,
    required: true,
  },
  totalNotes: {
    type: Number,
    default: 0,
  },
  tagCount: {
    type: Number,
    default: 0,
  },
  tagMenuOptions: {
    type: Array as () => any[],
    default: () => [],
  },
})

const emit = defineEmits(['close', 'menuClick'])

const Feedback = defineAsyncComponent(() => import('@/components/Feedback.vue'))
const settingStore = useSettingStore()
const siteStore = useSiteStore()
const { t } = useI18n()
const message = useMessage()
const showFeedback = ref(false)

const headerStyle = computed(() => {
  const currentKey = settingStore.settings.theme
  const themeItem = S.theme.children.find(item => item.key === currentKey)
  const colors = themeItem?.value || { primaryC: '#6366f1', primaryLightC: '#818cf8' }
  return {
    '--header-bg-start': colors.primaryC,
    '--header-bg-end': colors.primaryLightC,
  }
})

function onAvatarClick() {
  handleItemClick('account')
}

// ===========================================================================
// 🔥 主题设置逻辑 (包含本地持久化 + 服务器同步)
// ===========================================================================
const showThemeModal = ref(false)

const themeOptions = computed(() => {
  return S.theme.children.map(item => ({
    label: getText(item.name),
    value: item.key,
    color: item.value?.bgC || '#ddd',
  }))
})

function renderThemeLabel(option: { label: string; value: string; color: string }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
    h('div', {
      style: {
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        backgroundColor: option.color,
        border: '1px solid rgba(0,0,0,0.1)',
      },
    }),
    h('span', option.label),
  ])
}

async function handleThemeChange(val: string) {
  // 1. 获取纯净数据副本
  const currentSettingsRaw = toRaw(settingStore.settings)

  // 2. 构造最新设置对象
  const nextSettings = JSON.parse(JSON.stringify(currentSettingsRaw))
  nextSettings.theme = val

  // 3. 更新 Pinia Store
  settingStore.setSettings(nextSettings)

  // 4. 应用样式
  toggleTheme(val)

  // 5. 本地持久化 (LocalStorage settings & cache)
  localStorage.setItem('settings', JSON.stringify(nextSettings))
  try {
    const cacheRaw = localStorage.getItem('cache')
    if (cacheRaw) {
      const cacheData = JSON.parse(cacheRaw)
      cacheData.settings = { ...(cacheData.settings || {}), ...nextSettings }
      localStorage.setItem('cache', JSON.stringify(cacheData))
    }
  }
  catch (e) {}

  // 6. 同步到服务器 (Supabase)
  if (props.user) {
    try {
      const contentToSave = {
        data: siteStore.customData, // 带上书签数据
        settings: nextSettings, // 带上最新设置
      }

      const { error } = await supabase.from('profiles').upsert({
        id: props.user.id,
        content: JSON.stringify(contentToSave),
        updated_at: new Date().toISOString(),
      })

      if (error)
        console.error('Theme sync failed:', error)
    }
    catch (e) {
      console.error('Error saving theme:', e)
    }
  }
}

function openThemeModal() {
  showThemeModal.value = true
}

// ===========================================================================
// 🔥 通知提醒逻辑
// ===========================================================================
const notificationEnabled = ref(localStorage.getItem('isDailyReminderOn') === 'true')
const notificationLoading = ref(false)

async function handleNotificationToggle(value: boolean) {
  notificationLoading.value = true

  if (value) {
    const token = await requestFcmToken()
    if (token) {
      if (props.user) {
        const { error } = await supabase
          .from('users')
          .update({ fcm_token: token })
          .eq('id', props.user.id)

        if (!error) {
          notificationEnabled.value = true
          localStorage.setItem('isDailyReminderOn', 'true')
          message.success(t('settings.notification_enabled') || '每日提醒已开启')
        }
        else {
          console.error('保存 Token 失败:', error)
          message.error('开启失败，请稍后重试')
          notificationEnabled.value = false
        }
      }
    }
    else {
      notificationEnabled.value = false
      message.warning(
        t('settings.notification_permission_denied') || '无法开启：请检查浏览器通知权限',
      )
    }
  }
  else {
    if (props.user) {
      await supabase
        .from('users')
        .update({ fcm_token: null })
        .eq('id', props.user.id)
    }
    notificationEnabled.value = false
    localStorage.setItem('isDailyReminderOn', 'false')
    message.success(t('settings.notification_cancel') || '提醒已关闭')
  }

  notificationLoading.value = false
}

// ===========================================================================
// 🔥 城市设置相关逻辑
// ===========================================================================
const showCityModal = ref(false)
const cityOptions = ref<{ label: string; value: string; lat: number; lon: number }[]>([])
const loadingCity = ref(false)
const selectedCityKey = ref<string | null>(null)

async function autoSuggestCurrentCity() {
  loadingCity.value = true
  let cityName = ''
  let lat = 0
  let lon = 0
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      // eslint-disable-next-line prefer-promise-reject-errors
      if (!navigator.geolocation) {
        reject('No Geo')
        return
      }
      const id = setTimeout(() => reject('Geo Timeout'), 5000)

      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(id)
          resolve(p)
        },
        (e) => {
          clearTimeout(id)
          reject(e)
        },
        { maximumAge: 60000, timeout: 5000, enableHighAccuracy: false },
      )
    })
    lat = pos.coords.latitude
    lon = pos.coords.longitude
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = await res.json()
        cityName = data.address?.city || data.address?.town || data.address?.village || data.address?.county || ''
      }
    }
    catch {}
  }
  catch {}

  if (!cityName) {
    try {
      const ipRes = await fetch('https://ipapi.co/json/')
      if (ipRes.ok) {
        const ipData = await ipRes.json()
        cityName = ipData.city || ''
        if (!lat || !lon) {
          lat = ipData.latitude || 0
          lon = ipData.longitude || 0
        }
      }
    }
    catch {}
  }

  if (cityName && lat && lon) {
    const valObj = { name: cityName, lat, lon }
    const valStr = JSON.stringify(valObj)
    const labelTag = (lat === 0) ? 'IP' : '自动'
    cityOptions.value = [{
      label: `📍 ${cityName} (${labelTag})`,
      value: valStr,
      lat,
      lon,
    }]
    selectedCityKey.value = valStr
    handleUpdateCity(valStr)
  }
  loadingCity.value = false
}

function openCityModal() {
  const current = settingStore.manualLocation
  if (current) {
    const valStr = JSON.stringify(current)
    selectedCityKey.value = valStr
    cityOptions.value = [{
      label: current.name,
      value: valStr,
      lat: current.lat,
      lon: current.lon,
    }]
  }
  else {
    selectedCityKey.value = null
    cityOptions.value = []
    autoSuggestCurrentCity()
  }
  showCityModal.value = true
}

async function handleSearchCity(query: string) {
  if (!query)
    return
  loadingCity.value = true
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=zh&format=json`
    const res = await fetch(url)
    const data = await res.json()
    if (data.results) {
      cityOptions.value = data.results.map((item: any) => {
        const label = `${item.name} ${item.admin1 ? `(${item.admin1})` : ''}`
        const valueObj = { name: item.name, lat: item.latitude, lon: item.longitude }
        const valueObjStr = JSON.stringify(valueObj)
        return { label, value: valueObjStr, ...valueObj }
      })
    }
  }
  catch (e) {
    console.warn('搜索失败', e)
  }
  finally {
    loadingCity.value = false
  }
}

function handleUpdateCity(val: string | null) {
  selectedCityKey.value = val
  if (!val) {
    settingStore.setManualLocation(null)
  }
  else {
    const loc = JSON.parse(val)
    settingStore.setManualLocation(loc)
  }
}

// ===========================================================================
// 🔥 递归渲染组件 (严格修复多语句问题)
// ===========================================================================
const RecursiveMenu = defineComponent({
  props: ['items'],
  emits: ['itemClick'],
  setup(props, { emit }) {
    const resolve = (val: any) => (typeof val === 'function' ? val() : val)

    const renderNode = (item: any): any => {
      if (item.type === 'render') {
        return h('div', {
          key: item.key,
          class: 'render-node',
          onClick: () => {
            if (item.key !== 'tag-search' && item.key !== 'pinned-header')
              emit('itemClick')
          },
        }, [resolve(item.render)])
      }

      if (item.type === 'group') {
        const groupProps = item.props || {}
        return h('div', { key: item.key, class: 'group-node' }, [
          h('div', {
            class: 'group-label',
            onClick: (e: MouseEvent) => {
              if (groupProps.onClick)
                groupProps.onClick(e)
              emit('itemClick')
            },
          }, [resolve(item.label)]),
          h('div', { class: 'group-children' }, item.children.map(renderNode)),
        ])
      }

      const originalProps = item.props || {}
      return h('div', {
        key: item.key,
        class: 'menu-node hover-effect',
        ...originalProps,
        onClick: (e: MouseEvent) => {
          if (originalProps.onClick)
            originalProps.onClick(e)
          emit('itemClick')
        },
      }, [resolve(item.label)])
    }

    return () => {
      if (!props.items || props.items.length === 0)
        return null
      return h('div', { class: 'tag-menu-root' }, props.items.map(renderNode))
    }
  },
})

// // --- 统计数据逻辑 ---
const journalingDays = ref(0)
const displayTotalNotes = ref(props.totalNotes)

watch(() => [props.totalNotes, props.user?.id], ([newCount, userId]) => {
  if (typeof newCount === 'number' && newCount > 0) {
    displayTotalNotes.value = newCount
    if (userId)
      localStorage.setItem(`total_notes_cache_${userId}`, String(newCount))
  }
  else if (newCount === 0 && userId) {
    const cached = localStorage.getItem(`total_notes_cache_${userId}`)
    if (cached)
      displayTotalNotes.value = Number(cached)
    else
      displayTotalNotes.value = 0
  }
}, { immediate: true })

const userName = computed(() => {
  const meta = props.user?.user_metadata
  if (meta?.full_name)
    return meta.full_name
  if (meta?.name)
    return meta.name
  if (meta?.display_name)
    return meta.display_name
  return props.user?.email?.split('@')[0] || t('auth.default_nickname')
})

const userSignature = computed(() => {
  return props.user?.user_metadata?.signature || t('auth.default_signature')
})

const userAvatar = ref<string | null>(null)

watch(() => props.user, (u) => {
  const remoteUrl = u?.user_metadata?.avatar_url
  if (!u || !remoteUrl || remoteUrl === 'null' || remoteUrl.trim() === '') {
    userAvatar.value = null
    return
  }
  const cacheKey = `avatar_cache_${u.id}`
  const cachedBase64 = localStorage.getItem(cacheKey)
  if (cachedBase64) {
    userAvatar.value = cachedBase64
    if (remoteUrl !== cachedBase64) {
      const img = new Image()
      img.src = remoteUrl
      img.onload = () => { userAvatar.value = remoteUrl }
    }
  }
  else { userAvatar.value = remoteUrl }
}, { immediate: true })

function toDateKeyStrFromISO(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`
}

async function fetchAllDates(userId: string) {
  const PAGE_SIZE = 1000
  const allDates: string[] = []
  let page = 0
  let hasMore = true
  while (hasMore) {
    const { data, error } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', userId)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error)
      throw error

    if (data && data.length > 0) {
      data.forEach((n: any) => {
        allDates.push(n.created_at)
      })

      if (data.length < PAGE_SIZE)
        hasMore = false
      else
        page++
    }
    else {
      hasMore = false
    }
  }
  return allDates
}

async function fetchStats() {
  if (!props.user)
    return

  const CACHE_KEY = `journal_days_count_${props.user.id}`
  const cachedCount = localStorage.getItem(CACHE_KEY)

  if (cachedCount)
    journalingDays.value = Number(cachedCount)

  try {
    const dates = await fetchAllDates(props.user.id)
    const uniqueDays = new Set(dates.map(iso => toDateKeyStrFromISO(iso))).size
    journalingDays.value = uniqueDays
    localStorage.setItem(CACHE_KEY, String(uniqueDays))
  }
  catch (e) {
    console.error('Fetch sidebar stats error:', e)
  }
}

watch(() => props.show, (val) => {
  if (val)
    fetchStats()
})

const settingsExpanded = ref(false)

function handleItemClick(key: string) {
  if (key === 'settings-group') {
    settingsExpanded.value = !settingsExpanded.value
    return
  }
  if (key === 'defaultCity') {
    openCityModal()
    return
  }
  if (key === 'themeSetting') {
    openThemeModal()
    return
  }
  if (key === 'feedback') {
    showFeedback.value = true
    // emit('close')
    return
  }
  emit('menuClick', key)

  if (['help', 'trash', 'settings', 'export', 'account'].includes(key)) {
    return
  }
  emit('close')
}

const showStatsDetail = ref(false)

const statsData = computed(() => ({
  days: journalingDays.value,
  notes: props.totalNotes,
  words: 0,
  media: 0,
}))

onMounted(() => {
  settingStore.loadManualLocation?.()
})
</script>

<template>
  <Teleport to="body">
    <div class="sidebar-wrapper-root">
      <Transition name="slide-sidebar">
        <div v-if="show" class="sidebar-container">
          <div class="sidebar-header-card" :style="headerStyle">
            <div class="header-user-container">
              <div class="user-info-row" @click="onAvatarClick">
                <div class="avatar-circle">
                  <img
                    v-if="userAvatar"
                    :src="userAvatar"
                    alt="Avatar"
                    @error="userAvatar = null"
                  >
                  <div v-else class="avatar-placeholder">
                    {{ userName.charAt(0).toUpperCase() }}
                  </div>
                </div>

                <div class="user-text-col">
                  <div class="user-name-line">
                    <div class="user-name">
                      {{ userName }}
                    </div>
                    <div v-if="props.user?.email === 'vip'" class="user-badge">
                      高级
                    </div>
                  </div>
                  <div class="user-signature">
                    {{ userSignature }}
                  </div>
                </div>
              </div>

              <div class="header-settings-btn" @click="handleItemClick('settings-group')">
                <Settings :size="22" />
              </div>
            </div>

            <div
              class="stats-grid"
              style="cursor: pointer;"
              @click="showStatsDetail = true"
            >
              <div class="stat-item">
                <div class="stat-num">{{ displayTotalNotes }}</div>
                <div class="stat-label">{{ t('notes.notes_bj') || '笔记' }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-num">{{ tagCount }}</div>
                <div class="stat-label">{{ t('notes.search_filter_tag') || '标签' }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-num">{{ journalingDays }}</div>
                <div class="stat-label">{{ t('notes.days') || '天数' }}</div>
              </div>
            </div>
          </div>

          <div class="menu-list">
            <div v-if="settingsExpanded" class="submenu settings-panel">
              <div class="menu-section-label" style="padding-left: 20px;">{{ t('settings.title') || '设置选项' }}</div>

              <div class="sub menu-item" @click="handleItemClick('settings')">
                <Type :size="18" /><span>{{ t('settings.font_title') }}</span>
              </div>

              <div class="menu-item sub" @click="handleItemClick('themeSetting')">
                <Palette :size="18" /><span>{{ t('settings.theme_title') || '主题设置' }}</span>
              </div>

              <div class="menu-item sub" @click="handleItemClick('export')">
                <Download :size="18" /><span>{{ t('notes.export_all') }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('account')">
                <UserIcon :size="18" /><span>{{ t('auth.account_title') }}</span>
              </div>

              <div class="menu-item sub" style="justify-content: space-between; cursor: default;" @click.stop>
                <div style="display: flex; align-items: center; gap: 16px;">
                  <Bell :size="18" />
                  <span>{{ t('settings.daily_reminder') || '每日提醒' }}</span>
                </div>
                <div style="margin-right: -4px;" @click.stop>
                  <NSwitch
                    v-model:value="notificationEnabled"
                    :loading="notificationLoading"
                    size="small"
                    @update:value="handleNotificationToggle"
                  />
                </div>
              </div>

              <div class="menu-item sub" @click="handleItemClick('defaultCity')">
                <MapPin :size="18" />
                <span>{{ t('settings.default_city') || '默认城市' }}</span>
              </div>

              <div class="divider" style="margin: 4px 24px 12px 24px;" />
            </div>

            <div class="menu-item" @click="handleItemClick('calendar')">
              <Calendar :size="20" /><span>{{ t('auth.Calendar') }}</span>
            </div>

            <div class="menu-item" @click="handleItemClick('toggleSelection')">
              <CheckSquare :size="20" /><span>{{ t('notes.select_notes') }}</span>
            </div>

            <div class="menu-item" @click="handleItemClick('randomRoam')">
              <Shuffle :size="20" /><span>{{ t('notes.random_roam.title') || '随机漫游' }}</span>
            </div>

            <div class="divider" />

            <div class="tag-menu-container">
              <RecursiveMenu :items="tagMenuOptions" @item-click="emit('close')" />
            </div>

            <div class="divider" style="margin-top: 10px;" />

            <div class="menu-item" @click="handleItemClick('help')">
              <HelpCircle :size="20" /><span>{{ t('notes.help_title') || '使用帮助' }}</span>
            </div>
            <div class="menu-item" @click="handleItemClick('feedback')">
              <MessageSquare :size="20" /><span>{{ t('notes.feedback_title') || '反馈建议' }}</span>
            </div>

            <div class="menu-item" @click="handleItemClick('trash')">
              <Trash2 :size="20" /><span>{{ t('auth.trash') }}</span>
            </div>

            <div style="height: 40px;" />
          </div>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="show" class="sidebar-overlay" @click="emit('close')" />
      </Transition>

      <Transition name="fade">
        <Feedback
          v-if="showFeedback"
          :modal-mode="true"
          :theme-color="headerStyle['--header-bg-start']"
          @close="showFeedback = false"
        />
      </Transition>

      <Transition name="fade">
        <StatsDetail
          v-if="showStatsDetail"
          :stats="statsData"
          :theme-color="headerStyle['--header-bg-start']"
          @close="showStatsDetail = false"
        />
      </Transition>

      <NModal v-model:show="showCityModal">
        <NCard
          style="width: 90%; max-width: 400px;"
          :title="t('settings.default_city')"
          :bordered="false"
          size="huge"
          role="dialog"
          aria-modal="true"
          closable
          @close="showCityModal = false"
        >
          <NSpace vertical>
            <NText depth="3" style="font-size: 13px;">
              {{ t('settings.city_desc') }}
            </NText>

            <NSelect
              v-model:value="selectedCityKey"
              filterable
              remote
              clearable
              :placeholder="t('settings.city_placeholder')"
              :options="cityOptions"
              :loading="loadingCity"
              @search="handleSearchCity"
              @update:value="handleUpdateCity"
            >
              <template #empty>
                {{ t('settings.city_empty') }}
              </template>
            </NSelect>

            <div style="font-size: 12px; color: #666;">
              {{ selectedCityKey ? t('settings.city_locked') : t('settings.city_unlocked') }}
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
              <NButton
                type="primary"
                :color="headerStyle['--header-bg-start']"
                @click="showCityModal = false"
              >
                {{ t('button.confirm') || 'OK' }}
              </NButton>
            </div>
          </NSpace>
        </NCard>
      </NModal>

      <NModal v-model:show="showThemeModal">
        <NCard
          style="width: 90%; max-width: 400px;"
          :title="t('settings.theme_title') || '主题设置'"
          :bordered="false"
          size="huge"
          role="dialog"
          aria-modal="true"
          closable
          @close="showThemeModal = false"
        >
          <NSpace vertical>
            <NSelect
              :value="settingStore.settings.theme"
              :options="themeOptions"
              :render-label="renderThemeLabel"
              :placeholder="t('settings.theme_placeholder') || '选择主题'"
              @update:value="handleThemeChange"
            />

            <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
              <NButton
                type="primary"
                :color="headerStyle['--header-bg-start']" @click="showThemeModal = false"
              >
                {{ t('button.confirm') || 'OK' }}
              </NButton>
            </div>
          </NSpace>
        </NCard>
      </NModal>
    </div>
  </Teleport>
</template>

<style scoped>
/* ⚠️ 请确保你的 CSS 包含以下关键部分，
   特别是 .header-user-container 和 .header-settings-btn
*/

.header-user-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  margin-bottom: 24px;
}

.user-info-row {
  display: flex; align-items: center; gap: 12px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  border-radius: 8px;
  margin-left: -8px; padding: 8px;
  flex: 0 1 auto; /* 缩小点击区域 */
  margin-right: auto;
}
.user-info-row:hover { background: rgba(255, 255, 255, 0.1); }
.user-info-row:active { opacity: 0.8; transform: scale(0.98); }

.header-settings-btn {
  position: relative;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.8);
  transition: all 0.2s;

  /* ✅ 这里控制左移的距离 */
  margin-right: 12px;
}
.header-settings-btn:hover {
  color: white;
  background-color: rgba(255, 255, 255, 0.15);
  transform: rotate(90deg);
}

.submenu.settings-panel {
  background: var(--sb-submenu-bg);
  box-shadow: inset 0 2px 6px rgba(0,0,0,0.03);
  padding-bottom: 8px;
}
</style>

<style scoped>
/* ===========================================================================
   🎨 主题变量定义
   =========================================================================== */
.sidebar-container {
  /* --- 默认浅色模式变量 --- */
  --sb-bg: white;
  --sb-text: #333;
  --sb-text-sub: #999;
  --sb-hover: rgba(0,0,0,0.03);
  --sb-submenu-bg: #fafafa;
  --sb-divider: #f0f0f0;
  --sb-shadow: rgba(0,0,0,0.1);
}

@media (prefers-color-scheme: dark) {
  .sidebar-container {
    --sb-bg: #1e1e1e;
    --sb-text: #e0e0e0;
    --sb-text-sub: #bbb;
    --sb-hover: rgba(255,255,255,0.06);
    --sb-submenu-bg: #151515;
    --sb-divider: #333;
    --sb-shadow: rgba(0,0,0,0.4);
  }
}

:global(.dark) .sidebar-container {
  --sb-bg: #1e1e1e;
  --sb-text: #e0e0e0;
  --sb-text-sub: #bbb;
  --sb-hover: rgba(255,255,255,0.06);
  --sb-submenu-bg: #151515;
  --sb-divider: #333;
  --sb-shadow: rgba(0,0,0,0.4);
}

/* ===========================================================================
   📐 布局与样式
   =========================================================================== */

/* Sidebar 容器 */
.sidebar-container {
  position: fixed;
  top: 0; left: 0; width: 310px; height: 100dvh;
  z-index: 3500;
  display: flex; flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;

  background: var(--sb-bg);
  color: var(--sb-text);
  box-shadow: 4px 0 15px var(--sb-shadow);
  transition: background-color 0.3s, color 0.3s;

  /* 🔥 核心修改：设置侧边栏的基础字号为全局 UI 字号 */
  font-size: var(--ui-font, 14px);
}
.sidebar-container::-webkit-scrollbar { display: none; }

.sidebar-header-card {
  /* 🔥 [修改] 使用 CSS 变量替换原来的固定颜色 */
  /* 原代码: background: linear-gradient(to bottom, #6366f1 0%, #818cf8 100%); */
  background: linear-gradient(to bottom, var(--header-bg-start) 0%, var(--header-bg-end) 100%);

  padding-top: calc(2rem + env(safe-area-inset-top));
  padding-right: 1.5rem;
  padding-bottom: 1.5rem;
  padding-left: 1.5rem;
  color: white;
  position: relative;
  flex-shrink: 0;

  /* 建议添加一个过渡效果，这样切换主题时颜色会平滑渐变 */
  transition: background 0.3s ease;
}

/* 用户信息行 */
.user-info-row {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 24px; margin-top: 10px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  border-radius: 8px;
  margin-left: -8px; padding: 8px;
}
.user-info-row:hover { background: rgba(255, 255, 255, 0.1); }
.user-info-row:active { opacity: 0.8; transform: scale(0.98); }

.avatar-circle { width: 54px; height: 54px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.8); overflow: hidden; background: rgba(255,255,255,0.2); }
.avatar-circle img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; color: white; }

/* 🔥 修改：用户名大小使用 calc 计算 */
.user-name {
  font-size: calc(var(--ui-font, 14px) * 1.4); /* 原 20px */
  font-weight: 600;
  letter-spacing: 0.5px;
}

.user-badge { background: rgba(255,255,255,0.3); font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }

/* 🔥 修改：签名文字大小 */
.user-signature {
  font-size: calc(var(--ui-font, 14px) * 0.85); /* 原 12px */
  opacity: 0.85; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px;
}

/* ... 原有的 CSS ... */

.stats-grid {
  display: flex;
  justify-content: space-between;
  /* [新增] 增加一点内边距和圆角，让点击反馈更好看 */
  padding: 8px 0;
  border-radius: 8px;
  transition: background-color 0.2s;
}

/* [新增] 悬停高亮效果 */
.stats-grid:hover {
  background-color: rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

/* ... 原有的 CSS ... */
.stat-item { display: flex; flex-direction: column; align-items: center; flex: 1; }

/* 🔥 修改：统计数字大小 */
.stat-num {
  font-size: calc(var(--ui-font, 14px) * 1.4); /* 原 20px */
  font-weight: 700; margin-bottom: 4px;
  color: #ffffff;
  font-family: inherit;
}

/* 🔥 修改：统计标签大小 */
.stat-label {
  font-size: calc(var(--ui-font, 14px) * 0.85); /* 原 12px */
  opacity: 0.9;
}

/* 菜单列表区域 */
.menu-list {
  padding: 10px 0 10px 0 !important;
  flex: 1;
}

/* 菜单项 */
.menu-item {
  display: flex; align-items: center;
  padding: 6px 20px;
  cursor: pointer;
  transition: background 0.1s;

  /* 🔥 修改：主菜单字号跟随系统设置 */
  font-size: var(--ui-font, 15px);

  gap: 16px;
  position: relative;
  min-height: 36px;
  color: var(--sb-text);
}
.menu-item:hover {
  background: var(--sb-hover);
}
.menu-item.has-arrow { justify-content: space-between; }
.item-left { display: flex; align-items: center; gap: 16px; }

.caret { transition: transform 0.2s; color: var(--sb-text-sub); }
.caret.rotated { transform: rotate(90deg); }

/* 子菜单 */
.submenu {
  background: var(--sb-submenu-bg);
  overflow: hidden;
}

.menu-item.sub {
  padding-left: 56px;

  /* 🔥 修改：子菜单字号稍微小一点 */
  font-size: calc(var(--ui-font, 14px) * 0.93); /* 原 14px */

  padding-top: 6px;
  padding-bottom: 6px;
}

/* 分割线 */
.divider {
  height: 1px;
  background: var(--sb-divider);
  margin: 8px 24px;
}

.menu-section-label {
  padding: 12px 24px 4px 24px;
  /* 🔥 修改 */
  font-size: calc(var(--ui-font, 14px) * 0.85);
  color: var(--sb-text-sub);
  font-weight: 500;
}

.sidebar-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 3499;
  backdrop-filter: blur(2px);
}

/* 动画 */
.slide-sidebar-enter-active, .slide-sidebar-leave-active { transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1); }
.slide-sidebar-enter-from, .slide-sidebar-leave-to { transform: translateX(-100%); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 标签菜单布局修正 */
.tag-menu-container {
  padding-left: 35px;
  padding-right: 0;
  overflow: visible;
}

/* 递归组件样式透传 (:deep) */
:deep(.render-node) {
  position: relative;
  margin-left: -35px !important;
  width: calc(100% + 35px) !important;
}
:deep(.menu-node), :deep(.group-node) {
  position: relative;
  color: var(--sb-text);
  /* 🔥 新增：确保标签列表继承字号，或者明确设置 */
  font-size: var(--ui-font, 14px);
}
:deep(.hover-effect) {
  cursor: pointer;
  min-height: 36px;
  display: flex;
  align-items: center;
}
:deep(.hover-effect:hover) {
  background-color: var(--sb-hover);
}
:deep(.group-label) {
  pointer-events: none;
  color: var(--sb-text);
}

/* ===========================================================================
   ✨✨✨ 新增和修改的 Header 样式 ✨✨✨
   =========================================================================== */

/* ✨ 新增：头部用户区域容器
  作用：使用 flex 布局来控制左侧用户信息和右侧设置按钮的位置关系
*/
.header-user-container {
  display: flex;
  /* 两端对齐：左侧是信息，右侧是按钮，中间留空 */
  justify-content: space-between;
  /* ✅ 核心：垂直居中对齐，实现图标与头像对齐 */
  align-items: center;
  /* 将原本 user-info-row 上的上下边距移到这里，保持整体间距 */
  margin-top: 10px;
  margin-bottom: 24px;
}

/* 修改：用户信息行
*/
.user-info-row {
  display: flex; align-items: center; gap: 12px;
  /* ❌ 删除：原来的 margin-bottom 和 margin-top 已移到父级容器 */
  /* margin-bottom: 24px; margin-top: 10px; */

  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  border-radius: 8px;
  /* 保留负 margin 和 padding，用于维持 hover 时的背景范围，但不影响布局 */
  margin-left: -8px; padding: 8px;

  /* ✅ 核心：限制宽度，只占用内容所需的空间，从而缩小点击区域 */
  flex: 0 1 auto;
}
/* hover 和 active 样式保持不变 */
.user-info-row:hover { background: rgba(255, 255, 255, 0.1); }
.user-info-row:active { opacity: 0.8; transform: scale(0.98); }

/* 修改：右上角设置按钮样式
*/
.header-settings-btn {
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s;

  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 10px;
}

.header-settings-btn:hover {
  color: white;
  background-color: rgba(255, 255, 255, 0.15);
  transform: rotate(90deg);
}

/* ✨ 新增：专门针对设置面板的缩进调整 */
.submenu.settings-panel .menu-item.sub {
  /* 原来是 56px，现在改为 20px，与上方的“设置选项”标题对齐 */
  padding-left: 20px;
}

/* 如果你觉得“每日提醒”那个特殊的开关行也需要对齐，加上这个 */
.submenu.settings-panel .menu-item.sub[style*="justify-content: space-between"] {
   padding-left: 20px;
}
</style>

<style>
body > .v-binder-follower-container,
body > .v-binder-follower-content,
body > .n-dropdown-menu,
body > .n-popover,
body > .n-modal-mask,
body > .n-modal-container,
body > .n-dialog-container,
body > .n-dialog-mask {
  z-index: 10000 !important;
}
</style>
