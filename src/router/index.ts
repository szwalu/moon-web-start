import { createRouter, createWebHistory } from 'vue-router'

// 引入自动生成的路由数组
import generatedRoutes from 'virtual:generated-pages'

// 引入你新建的 iframe 组件 (请确保文件路径正确，和你创建的位置一致)
import LinksView from '@/components/LinksView.vue'

// ✅ 1. 定义额外的手动路由
const customRoutes = [
  {
    path: '/links',
    name: 'Links',
    component: LinksView,
    meta: {
      // 如果你的 App 需要某些页面不检查登录，可以在这里加 meta
      // requiresAuth: false
    },
  },
]

// ✅ 2. 合并路由：自动生成的 + 手动的
// 使用扩展运算符 (...) 把两个数组拼在一起
const routes = [...generatedRoutes, ...customRoutes]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes, // 使用合并后的路由数组
})

// 【核心修改】添加全局路由守卫 (保持你原有的逻辑不变)
router.beforeEach((to, from, next) => {
  // 1. 判断是否处于 Capacitor 环境（打包后的 App）
  const isCapacitor = window.Capacitor !== undefined

  // 2. 如果是 App 环境，且目标路径是首页 '/'
  if (isCapacitor && to.path === '/') {
    // 强制跳转到 /auth
    next('/auth')
  }
  else {
    // 其他情况直接放行
    next()
  }
})

export default router
