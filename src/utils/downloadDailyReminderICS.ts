// src/utils/downloadDailyReminderICS.ts
/**
 * 生成并下载每日提醒的 ICS 文件
 * @param hour 小时 (0–23)
 * @param minute 分钟 (0–59)
 * @param title 事件标题
 * @param description 事件说明
 */
export function downloadDailyReminderICS(
  hour = 22,
  minute = 27,
  title = '那年今日',
  description = '来看看那年今日卡片吧～',
) {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const now = new Date()
  const startDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(hour)}${pad(minute)}00`

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CloudNote//LocalReminder//CN',
    'BEGIN:VEVENT',
    'UID:cloudnote-localreminder',
    `DTSTAMP:${startDate}Z`,
    `DTSTART:${startDate}Z`,
    'RRULE:FREQ=DAILY', // 每天重复
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'CloudNoteDailyReminder.ics'
  a.click()
  URL.revokeObjectURL(a.href)
}
