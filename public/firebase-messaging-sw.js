/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyD2zZwiaZb-yZ31fLRwjbNBq_inTnCVFd0",
  authDomain: "notes-1f4be.firebaseapp.com",
  projectId: "notes-1f4be",
  storageBucket: "notes-1f4be.firebasestorage.app",
  messagingSenderId: "188960347026",
  appId: "1:188960347026:web:73b59a3182c2a6260fa74b",
  measurementId: "G-P71PZ4KJJW"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 后台消息处理
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  // 🔥 核心功能：如果有 badge_count，就设置红点
  if (payload.data && payload.data.badge_count) {
    const count = parseInt(payload.data.badge_count, 10);
    // 只有支持的浏览器/PWA 才会执行
    if ('setAppBadge' in navigator && !isNaN(count)) {
      navigator.setAppBadge(count).catch(function(error) {
        console.error('[SW] 设置角标失败:', error);
      });
    }
  }
});