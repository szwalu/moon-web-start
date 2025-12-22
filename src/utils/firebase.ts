/* eslint-disable */
// src/utils/firebase.ts
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, type Messaging } from "firebase/messaging";

// 🔴 请替换为你自己的 Firebase 配置信息
const firebaseConfig = {
  apiKey: "AIzaSyD2zZwiaZb-yZ31fLRwjbNBq_inTnCVFd0",
  authDomain: "notes-1f4be.firebaseapp.com",
  projectId: "notes-1f4be",
  storageBucket: "notes-1f4be.firebasestorage.app",
  messagingSenderId: "188960347026",
  appId: "1:188960347026:web:73b59a3182c2a6260fa74b",
  measurementId: "G-P71PZ4KJJW"
};

// 定义 VAPID Key 常量，方便管理和调试
const VAPID_KEY = "BFZ76_drTJYlGWqs3fTI7LZBkhjDSfbl2yeBOs7Od9uHWmHE6CEkHwQHk-Wx0S0VmbtX0pJhsV_6UUkeirLRNec";

const app = initializeApp(firebaseConfig);
let messaging: Messaging | null = null;

// 在浏览器环境才初始化 Messaging (避免 SSR 报错)
if (typeof window !== "undefined") {
  messaging = getMessaging(app);
}

// 获取 FCM Token 的公用方法
export const requestFcmToken = async () => {
  if (!messaging) {
    console.warn("Messaging functionality is not available (maybe not in browser context).");
    return null;
  }
  
  try {
    // 1. 请求系统通知权限
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted.');
      return null;
    }

    // 2. 获取 Token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY
    });

    return token;
  } catch (error: any) {
    // 打印更详细的错误信息
    console.error('An error occurred while retrieving token:', error);
    if (error.code === 'messaging/invalid-vapid-key') {
      console.error('❌ VAPID Key 无效！请检查 Firebase 控制台是否重新生成了 Key。');
    }
    return null;
  }
};