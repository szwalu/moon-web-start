<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NModal, NScrollbar } from 'naive-ui'
import { useDark } from '@vueuse/core'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', val: boolean): void }>()

const isDark = useDark()
type Lang = 'zh' | 'en'
const currentLang = ref<Lang>('en')

onMounted(() => {
  const navLang = navigator.language || (navigator as any).userLanguage
  if (navLang.startsWith('zh')) {
    currentLang.value = 'zh'
  } else {
    currentLang.value = 'en'
  }
})

const handleClose = () => {
  emit('update:show', false)
}

const content = {
  zh: {
    title: '星云笔记隐私政策',
    updateDate: '更新日期：2026 年 2 月 15 日',
    effectiveDate: '生效日期：2026 年 2 月 15 日',
    intro: '“星云笔记”（以下简称“我们”）深知个人信息对您的重要性。我们致力于保护您的隐私，并在提供服务的过程中，尽量遵循“最小必要”原则收集信息。',
    sections: [
      {
        title: '一、 我们收集的信息及用途',
        items: [
          '**注册信息：** 当您注册账号时，需提供手机号码或电子邮箱。这是为了识别您的身份、找回密码及保障账号安全。',
          '**内容数据：** 订阅VIP会员在笔记中记录的文字、图片、附件等。这些数据存储在我们的服务器上，以便您在不同设备间同步。未经您的明确许可，我们的人员不会查看您的笔记内容。',
          '**技术日志：** 为优化性能，我们会自动收集设备信息（如设备型号、操作系统、唯一设备标识符）、IP 地址、操作日志（如闪退记录、搜索词）。',
          '**支付信息：** 若您购买 VIP 会员，我们会收集您的交易记录以核对订单，但不会存储您的银行卡敏感信息。'
        ]
      },
      {
        title: '二、 我们如何使用 Cookies',
        items: [
          '我们使用 Cookies 来记住您的登录状态，避免您频繁输入密码。您可以根据浏览器设置拒绝 Cookies，但这可能导致部分功能无法正常使用。'
        ]
      },
      {
        title: '三、 信息的分享、转让与披露',
        items: [
          '我们承诺不会向任何第三方出售您的个人信息。仅在以下情况可能分享：',
          '**法律要求：** 根据法律法规、法院命令或政府机关的强制性要求。',
          '**合并收购：** 若发生合并、收购或资产转让，您的信息将作为资产的一部分进行转移，我们将要求新持有人继续履行隐私承诺。',
          // 👇 修复点：给 URL 加上了 word-break: break-all 样式，防止拉伸上一行
          '**第三方 SDK（高德地图）：** 为了向您提供“默认城市定位”、“自动获取天气”及“位置搜索”功能，我们需要接入高德开放平台定位 SDK（由高德软件有限公司提供）。该 SDK 可能会收集您的设备信息（如 IP 地址、设备标识符、操作系统版本）、位置信息（经纬度）及网络状态。您可以访问 <span style="word-break: break-all; color: #6366f1;">https://lbs.amap.com/pages/privacy/</span> 了解其隐私政策。'
        ]
      },
      {
        title: '四、 数据存储与安全保护',
        items: [
          '**存储地点：** 我们在中华人民共和国境内收集的信息将存储于中国境内。',
          '**安全措施：** 我们使用加密技术（如 SSL/TLS）、去标识化处理等手段保护数据安全。',
          '**保留期限：** 我们仅在提供服务所必需的期限内保留您的信息。如果您注销账户，我们将根据法律要求对数据进行删除或匿名化处理。'
        ]
      },
      {
        title: '五、 您的权利',
        items: [
          '您对自己的个人信息拥有充分的控制权：',
          '**访问与更正：** 您可以在应用设置中查看并修改个人资料。',
          '**导出：** 我们提供数据导出功能，您可以获取自己的笔记副本。',
          '**删除：** 您可以随时删除单条笔记或申请注销账号。',
          '**撤回授权：** 您可以通过手机系统设置关闭摄像头、相册等权限。'
        ]
      },
      {
        title: '六、 隐私政策的修订',
        items: [
          '我们可能会适时修改本政策。重大变更时，我们会通过站内信或弹窗通知您。若您继续使用“星云笔记”，即表示您同意接受修订后的政策。'
        ]
      },
      {
        title: '七、 联系我们',
        items: [
          '如果您对隐私保护有任何疑问、意见或投诉，请联系我们：',
          '邮箱：**ming@woabc.com**'
        ]
      }
    ]
  },
  en: {
    title: 'Nebula Notes Privacy Policy',
    updateDate: 'Updated: Feb 15, 2026',
    effectiveDate: 'Effective: Feb 15, 2026',
    intro: 'At Nebula Notes ("We"), we recognize the importance of your personal information. We are committed to protecting your privacy and collecting information under the principle of "minimum necessity".',
    sections: [
      {
        title: '1. Information We Collect & Usage',
        items: [
          '**Registration:** When you register, we collect your phone number or email to identify you, assist in password recovery, and ensure account security.',
          '**Content Data:** For VIP members, text, images, and attachments recorded in notes are stored on our servers for multi-device sync. We do not access your content without explicit permission.',
          '**Technical Logs:** To optimize performance, we collect device info (model, OS, unique ID), IP address, and operation logs (crashes, search terms).',
          '**Payment Info:** If you purchase VIP, we collect transaction records to verify orders, but we do not store sensitive bank card information.'
        ]
      },
      {
        title: '2. How We Use Cookies',
        items: [
          'We use Cookies to remember your login status and preferences. You can disable Cookies via browser settings, but some features may not function properly.'
        ]
      },
      {
        title: '3. Sharing, Transfer & Disclosure',
        items: [
          'We promise not to sell your personal information to third parties. Sharing only occurs under these conditions:',
          '**Legal Requirements:** Compliance with laws, court orders, or mandatory government requests.',
          '**Mergers & Acquisitions:** In the event of a merger or asset transfer, your info will be moved as part of the assets, and we will require the new holder to honor this privacy commitment.',
          '**Third-Party SDK (AMap/Gaode):** To provide "Default City Location", "Auto Weather", and "Location Search" features, we integrate the AMap Location SDK provided by AutoNavi Software Co., Ltd. This SDK may collect your device information (e.g., IP address, Device ID, OS version), location data (latitude/longitude), and network status. Please refer to their privacy policy at https://lbs.amap.com/pages/privacy/.'
        ]
      },
      {
        title: '4. Data Storage & Security',
        items: [
          '**Location:** Information collected within the PRC will be stored on servers located in China.',
          '**Security:** We use encryption (e.g., SSL/TLS) and de-identification to protect your data.',
          '**Retention:** We retain info only as long as necessary for the service. Upon account deletion, data will be deleted or anonymized according to legal requirements.'
        ]
      },
      {
        title: '5. Your Rights',
        items: [
          'You have full control over your personal information:',
          '**Access & Correct:** View and modify your profile in app settings.',
          '**Export:** Use the data export feature to get a copy of your notes.',
          '**Delete:** Delete individual notes or apply for account cancellation at any time.',
          '**Revoke Permissions:** Disable camera or album access via your device system settings.'
        ]
      },
      {
        title: '6. Amendments',
        items: [
          'We may update this policy periodically. Significant changes will be notified via in-app messages or pop-ups. Continued use implies acceptance of the revised policy.'
        ]
      },
      {
        title: '7. Contact Us',
        items: [
          'If you have questions, comments, or complaints regarding privacy, please contact us:',
          'Email: **ming@woabc.com**'
        ]
      }
    ]
  }
}

const activeContent = computed(() => content[currentLang.value])

const parseBold = (text: string) => {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
}
</script>

<template>
  <NModal
    :show="props.show"
    :mask-closable="true"
    :auto-focus="false"
    :z-index="5020"
    @update:show="val => emit('update:show', val)"
  >
    <div class="modal-wrapper" :class="{ 'is-dark': isDark }">
      <header class="modal-header">
        <h2 class="title">{{ activeContent.title }}</h2>
        <button class="close-btn" @click="handleClose">&times;</button>
      </header>

      <NScrollbar class="modal-body" style="flex: 1 1 auto; min-height: 0; overflow: hidden;">
        <div class="content-padding">
          <div class="meta-info">
            <p>{{ activeContent.updateDate }}</p>
            <p>{{ activeContent.effectiveDate }}</p>
          </div>

          <div class="intro-box">
            <p>{{ activeContent.intro }}</p>
          </div>

          <section v-for="(section, index) in activeContent.sections" :key="index" class="section-block">
            <h3>{{ section.title }}</h3>
            <ul>
              <li v-for="(item, i) in section.items" :key="i" v-html="parseBold(item)"></li>
            </ul>
          </section>

          <div class="end-copyright">
            © 2026 Nebula Notes. All rights reserved.
          </div>
        </div>
      </NScrollbar>
    </div>
  </NModal>
</template>

<style scoped>
.modal-wrapper {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: #ffffff;
  color: #333;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ✅ 核心修改：加大头部 padding-top */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  
  /* ⚡️ 关键：离刘海更远一点 */
  padding-top: calc(env(safe-area-inset-top) + 20px); 
  
  border-bottom: 1px solid rgba(0,0,0,.06);
  flex: 0 0 auto;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  color: #666;
  width: 40px;
  text-align: right;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* 滚动内容区 */
.content-padding {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
  /* ✅ 因为删除了页脚，增加底部留白 */
  padding-bottom: max(40px, env(safe-area-inset-bottom));
}

.meta-info {
  text-align: center;
  font-size: 12px;
  color: #888;
  margin-bottom: 20px;
}
.meta-info p { margin: 2px 0; }

.intro-box {
  background-color: #f0f7ff;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 24px;
  color: #2c5282;
  font-size: 14px;
  border-left: 4px solid #4299e1;
}

h3 {
  font-size: 16px;
  margin: 20px 0 10px;
  font-weight: 700;
  color: #000;
}

ul {
  padding-left: 16px;
  margin: 0;
}

li {
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #444;
  text-align: justify;
}

li :deep(strong) { color: #000; }

.end-copyright {
  margin-top: 40px;
  text-align: center;
  font-size: 12px;
  color: #bbb;
}

/* Dark Mode */
.modal-wrapper.is-dark {
  background: #101014;
  color: #e0e0e0;
}

.modal-wrapper.is-dark .modal-header {
  border-bottom-color: rgba(255,255,255,.08);
}

.modal-wrapper.is-dark .title { color: #fff; }
.modal-wrapper.is-dark .close-btn { color: rgba(255,255,255,0.6); }

.modal-wrapper.is-dark .meta-info { color: #888; }

.modal-wrapper.is-dark .intro-box {
  background-color: rgba(66, 153, 225, 0.15);
  color: #90cdf4;
  border-left-color: #4299e1;
}

.modal-wrapper.is-dark h3 { color: #fff; }

.modal-wrapper.is-dark li { color: #ccc; }
.modal-wrapper.is-dark li :deep(strong) { color: #fff; }
</style>