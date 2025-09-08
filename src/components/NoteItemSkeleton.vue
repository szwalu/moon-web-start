<template>
  <div class="skeleton-container">
    <div class="skeleton-line header" />
    <div class="skeleton-line content short" />
    <div class="skeleton-line content" />
    <div class="skeleton-line content long" />
  </div>
</template>

<style scoped>
.skeleton-container {
  padding: 1rem 0.5rem;
  border-bottom: 1px solid #e0e0e0;
}
.dark .skeleton-container {
  border-bottom: 1px solid #333;
}

.skeleton-line {
  background: #e0e0e0;
  border-radius: 4px;
  margin-bottom: 0.75rem;
  animation: shimmer 1.5s infinite linear;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
}

.dark .skeleton-line {
  background: linear-gradient(90deg, #2d2d2d 25%, #3c3c3c 50%, #2d2d2d 75%);
  background-size: 200% 100%;
}

.skeleton-line.header {
  height: 12px;
  width: 40%;
}

.skeleton-line.content {
  height: 16px;
  width: 100%;
}

.skeleton-line.short {
  width: 60%;
}

.skeleton-line.long {
  width: 80%;
  margin-bottom: 0;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
