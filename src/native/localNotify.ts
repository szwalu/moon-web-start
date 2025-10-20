// src/native/localNotify.ts
// 说明：在“原生壳(通过 Capacitor 打包)”里，安排每天固定时间的系统本地通知。
// 在浏览器/PWA 环境中不会生效，不会影响你现有的 Web 逻辑。

import { Capacitor } from '@capacitor/core'
import {
  LocalNotifications,
  type ScheduleOptions,
} from '@capacitor/local-notifications'

/**
 * 开启每天固定时间提醒（系统级，熄屏/后台也能触发）
 * @param opts.hour    0~23 本地时区小时
 * @param opts.minute  0~59 本地时区分钟
 * @param opts.title   通知标题
 * @param opts.body    通知内容
 * @param opts.id      通知 ID（默认 1001）
 */
export async function scheduleDailyReminder(opts: {
  hour: number
  minute: number
  title: string
  body?: string
  id?: number
}) {
  // 若不是原生环境（比如 PWA/浏览器），直接提示并返回
  if (!Capacitor.isNativePlatform())
    throw new Error('当前为浏览器/PWA 环境，系统级本地通知需在原生 App 内运行')

  const {
    hour,
    minute,
    title,
    body = '',
    id = 1001,
  } = opts

  // 1) 权限（Android 13+ 会弹系统授权框；iOS 也会弹）
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') {
    const req = await LocalNotifications.requestPermissions()
    if (req.display !== 'granted')
      throw new Error('用户未授予通知权限')
  }

  // 2) Android: 创建高优先级频道（iOS 会忽略，安全 no-op）
  try {
    await LocalNotifications.createChannel?.({
      id: 'daily',
      name: 'Daily Reminders',
      description: '每日提醒',
      importance: 4, // 高优先级
      visibility: 1,
      lights: true,
      vibration: true,
    })
  }
  catch {
    // iOS 或老机型没有该 API，忽略
  }

  // 3) 按每天固定时间重复
  const schedule: ScheduleOptions = {
    notifications: [{
      id,
      title,
      body,
      channelId: 'daily', // Android 使用该频道
      schedule: {
        on: { hour, minute }, // 本地时区
        repeats: true,
        allowWhileIdle: true, // Android 省电/待机也触发
      },
      // smallIcon 可留空使用应用默认图标
      // sound 可按需要配置
    }],
  }

  await LocalNotifications.schedule(schedule)
}

/**
 * 关闭每天固定时间提醒
 * @param id 默认 1001（与上面保持一致）
 */
export async function cancelDailyReminder(id = 1001) {
  if (!Capacitor.isNativePlatform())
    return
  await LocalNotifications.cancel({ notifications: [{ id }] })
}
