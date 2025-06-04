<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <AppProvider>
    <AppContainer>
      <RouterView />
    </AppContainer>
  </AppProvider>
</template>

<style>
/* 我们在这里直接修改 body 和 html 的样式，以确保背景能覆盖整个浏览器窗口。
  注意：这里的 <style> 标签没有加 'scoped'，因为我们需要修改的是全局标签，
  而不是只针对这个组件内的元素。
*/
body, html {
  /* 先设置一个非常浅的灰色作为底色 */
  background-color: #dcdcdc;

  /* 用两个线性渐变来画出网格线：一个垂直，一个水平 */
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.06) 1px, transparent 1px);

  /* 定义每个格子的大小是 25px * 25px */
  background-size: 25px 25px;
}
</style>
