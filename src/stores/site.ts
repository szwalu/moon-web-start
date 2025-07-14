import { defineStore } from 'pinia'
import { reqPostData } from '@/api'
import preset from '@/preset.json'
import globalPreset from '@/preset_global.json'
import type { Category, Group, Site, WebsitePreference } from '@/types'
import { deepClone, secretIdStorage } from '@/utils'

function loadData(): Category[] | undefined {
  const data = localStorage.getItem('cache')
  return data ? JSON.parse(data) : undefined
}

export const useSiteStore = defineStore('site', () => {
  const settingStore = useSettingStore()
  const websitePreference = computed(() => settingStore.settings.websitePreference as WebsitePreference)

  const preferredPresetData = computed(() =>
    firstPreferredLanguage.value === 'zh-CN' ? preset.data : globalPreset.data,
  )

  const customData = ref<Category[]>(loadData() || [])
  const isModified = ref(false) // ✅ 新增：记录是否有变动

  watch(
    customData,
    () => {
      const secretId = secretIdStorage.get()
      if (secretId && customData.value.length) {
        reqPostData({
          id: secretId, // ✅ 修正这里的字段名
          data: {
            data: customData.value,
            settings: settingStore.settings,
          },
        })
      }
      cachingData()
    },
    { deep: true },
  )

  const data = computed((): Category[] => {
    if (websitePreference.value === 'ChineseMainland')
      return preset.data
    if (websitePreference.value === 'Global')
      return globalPreset.data
    if (websitePreference.value === 'Auto')
      return preferredPresetData.value

    if (websitePreference.value === 'Customize' && customData.value.length === 0)
      customData.value = deepClone(data.value)

    return customData.value
  })

  const cateIndex = ref(0)
  const groupIndex = ref(0)
  const siteIndex = ref(0)

  const setCateIndex = (i: number) => {
    cateIndex.value = i
  }
  const setGroupIndex = (i: number) => {
    groupIndex.value = i
  }
  const setSiteIndex = (i: number) => {
    siteIndex.value = i
  }

  const cateList = computed(() =>
    data.value.map(cate => ({ id: cate.id, name: cate.name })),
  )
  const currentCateData = computed(() => data.value[cateIndex.value] || { groupList: [] })

  const setModified = (val: boolean) => {
    isModified.value = val
  }

  function addSite(site: Site) {
    customData.value[cateIndex.value].groupList[groupIndex.value].siteList.push(site)
    setModified(true)
  }

  function addGroup(group: Group) {
    customData.value[cateIndex.value].groupList.push(group)
    setModified(true)
  }

  function addCate(cate: Category) {
    customData.value.push(cate)
    setModified(true)
  }

  function updateSite(site: Partial<Site>) {
    Object.assign(
      customData.value[cateIndex.value].groupList[groupIndex.value].siteList[siteIndex.value],
      site,
    )
    setModified(true)
  }

  function updateGroup(group: Partial<Group>) {
    Object.assign(customData.value[cateIndex.value].groupList[groupIndex.value], group)
    setModified(true)
  }

  function updateCate(cate: Partial<Category>) {
    Object.assign(customData.value[cateIndex.value], cate)
    setModified(true)
  }

  function deleteSite() {
    customData.value[cateIndex.value].groupList[groupIndex.value].siteList.splice(siteIndex.value, 1)
    setModified(true)
  }

  function deleteGroup() {
    customData.value[cateIndex.value].groupList.splice(groupIndex.value, 1)
    setModified(true)
  }

  function deleteCate() {
    customData.value.splice(cateIndex.value, 1)
    setModified(true)
  }

  function cachingData() {
    localStorage.setItem('cache', JSON.stringify(customData.value))
  }

  function setData(value: Category[]) {
    customData.value = value
    setModified(false)
  }

  function restoreData() {
    settingStore.setSettings({ websitePreference: 'Auto' })
    setData([])
    localStorage.removeItem('cache')
  }

  function getCurrentSite() {
    return data.value[cateIndex.value].groupList[groupIndex.value].siteList[siteIndex.value]
  }

  return {
    data,
    customData,
    cateIndex,
    cateList,
    currentCateData,
    setCateIndex,
    setGroupIndex,
    setSiteIndex,
    addSite,
    addGroup,
    addCate,
    updateSite,
    updateGroup,
    updateCate,
    deleteSite,
    deleteGroup,
    deleteCate,
    setData,
    restoreData,
    getCurrentSite,
    isModified, // ✅ 暴露
    setModified, // ✅ 暴露
  }
})
