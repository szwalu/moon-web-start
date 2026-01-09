import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kunming.notes',
  appName: 'MyNotes',
  webDir: 'dist', // <--- 重点1：确保这里是 dist
  server: {
    androidScheme: 'https',
  },
  // 🔥🔥🔥 重点2：添加这段 plugins 配置 🔥🔥🔥
  plugins: {
    Keyboard: {
      accessoryBarVisible: false, // 这一行去掉白条
      resize: 'body', // 让页面高度随键盘自动适应
    },
  },
}

export default config
