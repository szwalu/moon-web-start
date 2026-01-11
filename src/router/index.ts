import { createRouter, createWebHistory } from 'vue-router'
import routes from 'virtual:generated-pages'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// 【核心修改】添加全局路由守卫
router.beforeEach((to, from, next) => {
  // 1. 判断是否处于 Capacitor 环境（打包后的 App）
  // window.Capacitor 只有在 Capacitor 打包的 App 中才存在，
  // 普通浏览器或 PWA 模式下是 undefined。
  const isCapacitor = window.Capacitor !== undefined

  // 2. 如果是 App 环境，且目标路径是首页 '/'
  if (isCapacitor && to.path === '/') {
    // 强制跳转到 /auth
    next('/auth')
  }
  else {
    // 其他情况（包括 PWA 模式、非首页访问）直接放行
    next()
  }
})

export default router
