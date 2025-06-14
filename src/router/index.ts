import { createRouter, createWebHistory } from 'vue-router'
import routes from 'virtual:generated-pages'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // 【核心修正】：将我们手动添加的路由，与插件自动生成的路由合并在一起
  routes: [
    ...routes, // 这会包含所有根据您 /src/pages 目录自动生成的路由
    {
      path: '/update-password',
      name: 'update-password',
      // 请确保您的 UpdatePassword.vue 文件确实是在 src/pages/ 目录下
      component: () => import('@/pages/UpdatePassword.vue'),
    },
  ],
})

export default router
