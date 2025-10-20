import { Capacitor } from '@capacitor/core'

export async function scheduleDailyReminder(opts) {
  if (!Capacitor.isNativePlatform())
    return

  try {
    // 通过字符串拼接，防止 Vite 静态解析
    const pkg = '@capacitor/local-notifications'
    const { LocalNotifications } = await import(/* @vite-ignore */ pkg)

    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted')
      return

    await LocalNotifications.cancel({ notifications: [{ id: opts.id }] })
    await LocalNotifications.schedule({
      notifications: [
        {
          id: opts.id,
          title: opts.title,
          body: opts.body,
          schedule: {
            repeats: true,
            every: 'day',
            on: { hour: opts.hour, minute: opts.minute },
          },
        },
      ],
    })
  }
  catch (err) {
    console.error('[localNotify] schedule failed', err)
  }
}

export async function cancelDailyReminder(id) {
  if (!Capacitor.isNativePlatform())
    return

  try {
    const pkg = '@capacitor/local-notifications'
    const { LocalNotifications } = await import(/* @vite-ignore */ pkg)
    await LocalNotifications.cancel({ notifications: [{ id }] })
  }
  catch (err) {
    console.error('[localNotify] cancel failed', err)
  }
}
