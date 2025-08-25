// src/router/index.ts

import { createRouter, createWebHistory } from 'vue-router'
import routes from 'virtual:generated-pages'

import { supabase } from '@/utils/supabaseClient'

// 确保引入 supabase 客户端

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// 添加全局路由守卫 (这是解决问题的关键)
router.beforeEach(async (to, from, next) => {
  const { data: { session } } = await supabase.auth.getSession()

  // 定义不需要登录即可访问的公共页面路径
  const publicPaths = ['/auth', '/update-password']

  // 检查目标路径是否是公共路径
  const isPublicPath = publicPaths.includes(to.path)

  // 如果用户未登录，且访问的不是公共页面，则强制跳转到 /auth 页面
  if (!session && !isPublicPath)
    next('/auth')

  // 如果用户已登录，但又想访问 /auth 页面，则直接让他去主页
  else if (session && to.path === '/auth')
    next('/')

  // 其他所有情况（已登录访问非auth页，或未登录访问公共页），都直接放行
  else
    next()
})

export default router
