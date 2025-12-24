<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@supabase/supabase-js'
import {
  Bell,
  Calendar,
  CheckSquare,
  ChevronRight,
  Download,
  HelpCircle,
  MapPin,
  MessageSquare,
  Settings,
  Shuffle,
  Trash2,
  Type,
  User as UserIcon, // 🔥 [新增] 引入 Bell 图标
  // Key, // 🔥 [删除] 移除 Key 图标
} from 'lucide-vue-next'

// 🔥 [修改] 引入 NSwitch 和 useMessage
import { NButton, NCard, NModal, NSelect, NSpace, NSwitch, NText, useMessage } from 'naive-ui'
import { useSettingStore } from '@/stores/setting'

import StatsDetail from '@/components/StatsDetail.vue'
import { supabase } from '@/utils/supabaseClient'

// 🔥 [新增] 引入 Firebase 工具
import { requestFcmToken } from '@/utils/firebase'

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
const { t } = useI18n()
const message = useMessage() // 🔥 [新增] 初始化消息提示
const showFeedback = ref(false)

function onAvatarClick() {
  handleItemClick('account')
}

// ===========================================================================
// 🔥 [新增] 通知提醒逻辑
// ===========================================================================
const notificationEnabled = ref(localStorage.getItem('isDailyReminderOn') === 'true')
const notificationLoading = ref(false)

// 切换开关时的逻辑
async function handleNotificationToggle(value: boolean) {
  notificationLoading.value = true

  if (value) {
    // 🟢 开启逻辑
    const token = await requestFcmToken()

    if (token) {
      if (props.user) {
        // 🔥 【修改点】这里把 'profiles' 改为 'users'
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
        t('settings.notification_permission_denied')
  || '无法开启：请检查浏览器通知权限',
      )
    }
  }
  else {
    // 🔴 关闭逻辑
    if (props.user) {
      // 🔥 【修改点】这里把 'profiles' 改为 'users'
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

// 检查当前状态 (回显)
async function checkNotificationStatus() {
  if (!props.user)
    return

  // 🔥 【修改点】这里把 'profiles' 改为 'users'
  const { data } = await supabase
    .from('users')
    .select('fcm_token')
    .eq('id', props.user.id)
    .single()

  if (data?.fcm_token)
    notificationEnabled.value = true
}

// ===========================================================================
// 🔥 城市设置相关逻辑
// ===========================================================================
const showCityModal = ref(false)
const cityOptions = ref<{ label: string; value: string; lat: number; lon: number }[]>([])
const loadingCity = ref(false)
const selectedCityKey = ref<string | null>(null)

// 辅助函数：获取当前位置并填入搜索框
async function autoSuggestCurrentCity() {
  loadingCity.value = true

  let cityName = ''
  let lat = 0
  let lon = 0

  // ---------------------------------------------------------
  // 阶段 1: 尝试 GPS 硬件定位
  // ---------------------------------------------------------
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      // eslint-disable-next-line prefer-promise-reject-errors
      if (!navigator.geolocation)
        return reject('No Geo')

      // Android 优化: 5秒超时
      // eslint-disable-next-line prefer-promise-reject-errors
      const id = setTimeout(() => reject('Geo Timeout'), 5000)

      navigator.geolocation.getCurrentPosition(
        (p) => {
          // ✅ 修复：拆成多行
          clearTimeout(id)
          resolve(p)
        },
        (e) => {
          // ✅ 修复：拆成多行
          clearTimeout(id)
          reject(e)
        },
        { maximumAge: 60000, timeout: 5000, enableHighAccuracy: false },
      )
    })

    // GPS 成功拿到坐标
    lat = pos.coords.latitude
    lon = pos.coords.longitude

    // 拿着坐标去问 Nominatim
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2秒请求超时

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = await res.json()
        cityName = data.address?.city || data.address?.town || data.address?.village || data.address?.county || ''
      }
    }
    catch {
      // Nominatim 挂了，但我们有坐标，先留空
    }
  }
  catch {
    // ⚠️ GPS 彻底失败 (Android HTTP环境大概率走这里)
  }

  // ---------------------------------------------------------
  // 阶段 2: 如果 GPS 没拿到城市名，强制使用 IP 定位兜底
  // ---------------------------------------------------------
  if (!cityName) {
    try {
      // 使用 ipapi.co
      const ipRes = await fetch('https://ipapi.co/json/')
      if (ipRes.ok) {
        const ipData = await ipRes.json()
        cityName = ipData.city || ''
        // 如果之前 GPS 失败导致经纬度是 0，顺便补上
        if (!lat || !lon) {
          lat = ipData.latitude || 0
          lon = ipData.longitude || 0
        }
      }
    }
    catch {
      // IP 也失败
    }
  }

  // ---------------------------------------------------------
  // 阶段 3: 填入结果
  // ---------------------------------------------------------
  if (cityName && lat && lon) {
    const valObj = { name: cityName, lat, lon }
    const valStr = JSON.stringify(valObj)

    // 标记来源
    const labelTag = (lat === 0) ? 'IP' : '自动'

    cityOptions.value = [{
      label: `📍 ${cityName} (${labelTag})`,
      value: valStr,
      lat,
      lon,
    }]
    selectedCityKey.value = valStr

    // 自动保存
    handleUpdateCity(valStr)
  }

  loadingCity.value = false
}

// 打开弹窗
function openCityModal() {
  const current = settingStore.manualLocation

  if (current) {
    // 🟢 情况 A：用户以前设置过 -> 执行“回显”逻辑
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
    // ⚪ 情况 B：用户没设置过 -> 保持空白，但尝试自动填充
    selectedCityKey.value = null
    cityOptions.value = []

    // 🔥 触发自动检测 (不会阻塞弹窗打开)
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
        return {
          label,
          value: valueObjStr,
          ...valueObj,
        }
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
// 🔥 递归渲染组件
// ===========================================================================
const RecursiveMenu = defineComponent({
  props: ['items'],
  emits: ['itemClick'],
  setup(props, { emit }) {
    const resolve = (val: any) => (typeof val === 'function' ? val() : val)

    const renderNode = (item: any): any => {
      if (item.type === 'render') {
        return h(
          'div',
          {
            key: item.key,
            class: 'render-node',
            onClick: () => {
              if (item.key !== 'tag-search' && item.key !== 'pinned-header')
                emit('itemClick')
            },
          },
          [resolve(item.render)],
        )
      }

      if (item.type === 'group') {
        const groupProps = item.props || {}
        return h('div', { key: item.key, class: 'group-node' }, [
          h(
            'div',
            {
              class: 'group-label',
              onClick: (e: MouseEvent) => {
                if (groupProps.onClick)
                  groupProps.onClick(e)
                emit('itemClick')
              },
            },
            [resolve(item.label)],
          ),
          h('div', { class: 'group-children' }, item.children.map(renderNode)),
        ])
      }

      const originalProps = item.props || {}
      return h(
        'div',
        {
          key: item.key,
          class: 'menu-node hover-effect',
          ...originalProps,
          onClick: (e: MouseEvent) => {
            if (originalProps.onClick)
              originalProps.onClick(e)
            emit('itemClick')
          },
        },
        [resolve(item.label)],
      )
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
      img.onload = () => {
        userAvatar.value = remoteUrl
      }
    }
  }
  else {
    userAvatar.value = remoteUrl
  }
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
      data.forEach((n: any) => allDates.push(n.created_at))

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

  if (key === 'feedback') {
    showFeedback.value = true
    emit('close')
    return
  }

  emit('menuClick', key)
  if (key !== 'settings-group')
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
  // 🔥 [新增] 组件加载时检查通知开启状态
  checkNotificationStatus()
})
</script>

<template>
  <Teleport to="body">
    <div class="sidebar-wrapper-root">
      <Transition name="slide-sidebar">
        <div v-if="show" class="sidebar-container">
          <div class="sidebar-header-card">
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

            <div
              class="stats-grid"
              style="cursor: pointer;"
              @click="showStatsDetail = true"
            >
              <div class="stat-item">
                <div class="stat-num">
                  {{ totalNotes }}
                </div>
                <div class="stat-label">
                  {{ t('notes.notes_bj') || '笔记' }}
                </div>
              </div>
              <div class="stat-item">
                <div class="stat-num">
                  {{ tagCount }}
                </div>
                <div class="stat-label">
                  {{ t('notes.search_filter_tag') || '标签' }}
                </div>
              </div>
              <div class="stat-item">
                <div class="stat-num">
                  {{ journalingDays }}
                </div>
                <div class="stat-label">
                  {{ t('notes.days') || '天数' }}
                </div>
              </div>
            </div>
          </div>

          <div class="menu-list">
            <div class="menu-item" @click="handleItemClick('calendar')">
              <Calendar :size="20" /><span>{{ t('auth.Calendar') }}</span>
            </div>
            <div class="menu-item" @click="handleItemClick('toggleSelection')">
              <CheckSquare :size="20" /><span>{{ t('notes.select_notes') }}</span>
            </div>
            <div class="menu-item has-arrow" @click="handleItemClick('settings-group')">
              <div class="item-left">
                <Settings :size="20" />
                <span>{{ t('settings.title') || '设置' }}</span>
              </div>
              <ChevronRight :size="18" class="caret" :class="{ rotated: settingsExpanded }" />
            </div>

            <div v-if="settingsExpanded" class="submenu">
              <div class="menu-item sub" @click="handleItemClick('settings')">
                <Type :size="18" /><span>{{ t('settings.font_title') }}</span>
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

              <div class="menu-item sub" @click="handleItemClick('help')">
                <HelpCircle :size="18" /><span>{{ t('notes.help_title') || '使用帮助' }}</span>
              </div>
              <div class="menu-item sub" @click="handleItemClick('feedback')">
                <MessageSquare :size="18" /><span>{{ t('notes.feedback_title') || '反馈建议' }}</span>
              </div>
            </div>

            <div class="menu-item" @click="handleItemClick('randomRoam')">
              <Shuffle :size="20" /><span>{{ t('notes.random_roam.title') || '随机漫游' }}</span>
            </div>
            <div class="menu-item" @click="handleItemClick('trash')">
              <Trash2 :size="20" /><span>{{ t('auth.trash') }}</span>
            </div>

            <div class="divider" />
            <div class="tag-menu-container">
              <RecursiveMenu :items="tagMenuOptions" @item-click="emit('close')" />
            </div>
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
          @close="showFeedback = false"
        />
      </Transition>

      <Transition name="fade">
        <StatsDetail
          v-if="showStatsDetail"
          :stats="statsData"
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
                color="#6366f1"
                @click="showCityModal = false"
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
  background: linear-gradient(to bottom, #6366f1 0%, #818cf8 100%);
  padding-top: calc(2rem + env(safe-area-inset-top));
  padding-right: 1.5rem;
  padding-bottom: 1.5rem;
  padding-left: 1.5rem;
  color: white;
  position: relative;
  flex-shrink: 0;
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
