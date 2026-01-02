<script setup lang="ts">
import { NButton, NModal, NScrollbar } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
</script>

<template>
  <NModal
    :show="props.show"
    :mask-closable="true"
    :auto-focus="false"
    :z-index="5020"
    @update:show="val => { if (!val) emit('close') }"
  >
    <div class="help-wrapper" role="dialog" aria-modal="true" :aria-label="t('notes.HelpDialog.aria_label')">
      <header class="help-header">
        <h2 class="title">{{ t('notes.HelpDialog.title') }}</h2>
        <button class="icon-btn" :aria-label="t('notes.HelpDialog.close')" @click="emit('close')">✕</button>
      </header>

      <NScrollbar class="help-body" style="flex: 1 1 auto; min-height: 0; overflow: hidden;">
        <section>
          <h3>{{ t('notes.HelpDialog.s1_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s1_i1') }}</li>
            <li>
              {{ t('notes.HelpDialog.s1_i2_before') }}
              <strong>{{ t('notes.HelpDialog.s1_i2_em') }}</strong>
              {{ t('notes.HelpDialog.s1_i2_after') }}
            </li>
            <li>
              {{ t('notes.HelpDialog.s1_i3_before') }}
              <code>20,000</code>
              {{ t('notes.HelpDialog.s1_i3_after') }}
            </li>
            <li>{{ t('notes.HelpDialog.s1_i4') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s2_title') }}</h3>
          <ul>
            <li>
              <strong>{{ t('notes.HelpDialog.s2_i1_label') }}</strong>{{ t('notes.HelpDialog.s2_i1_tail') }}
            </li>
            <li>
              <strong>{{ t('notes.HelpDialog.s2_i2_label') }}</strong>{{ t('notes.HelpDialog.s2_i2_tail') }}
            </li>
            <li>
              {{ t('notes.HelpDialog.s2_i3_before') }}
              <code>- [ ]</code>
              {{ t('notes.HelpDialog.s2_i3_mid') }}
              <code>- [x]</code>
              {{ t('notes.HelpDialog.s2_i3_after') }}
            </li>
            <li>
              {{ t('notes.HelpDialog.s2_i4_before') }}
              <strong>{{ t('notes.HelpDialog.s2_i4_em') }}</strong>
              {{ t('notes.HelpDialog.s2_i4_after') }}
            </li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s3_title') }}</h3>
          <ul>
            <li><strong>{{ t('notes.HelpDialog.s3_i1_label') }}</strong>{{ t('notes.HelpDialog.s3_i1_1') }}</li>
            <li>{{ t('notes.HelpDialog.s3_i1_2') }}</li>
            <li>{{ t('notes.HelpDialog.s3_i1_3') }}</li>

            <li>
              <strong>{{ t('notes.HelpDialog.s3_i2_label') }}</strong>{{ t('notes.HelpDialog.s3_i2_before') }}
              <code>{{ t('notes.HelpDialog.s3_i2_example') }}</code>
            </li>

            <li>{{ t('notes.HelpDialog.s3_i3') }}</li>
            <li>{{ t('notes.HelpDialog.s3_i4') }}</li>
            <li>{{ t('notes.HelpDialog.s3_i5') }}</li>
            <li>{{ t('notes.HelpDialog.s3_i6') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s4_title') }}</h3>
          <ul>
            <li>
              {{ t('notes.HelpDialog.s4_i1_before') }}
              <span aria-hidden="true">🔍</span>
              {{ t('notes.HelpDialog.s4_i1_after') }}
            </li>
            <li>{{ t('notes.HelpDialog.s4_i2') }}</li>
            <li>{{ t('notes.HelpDialog.s4_i3') }}</li>
            <li>{{ t('notes.HelpDialog.s4_i4') }}</li>
            <li>{{ t('notes.HelpDialog.s4_i5') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s5_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s5_i1') }}</li>
            <li>{{ t('notes.HelpDialog.s5_i2') }}</li>
            <li>{{ t('notes.HelpDialog.s5_i3') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s6_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s6_i1') }}</li>
            <li>
              {{ t('notes.HelpDialog.s6_i2_before') }}
              <strong>{{ t('notes.HelpDialog.copy') }}</strong>
              {{ t('notes.HelpDialog.s6_i2_and2') }}
              <strong>{{ t('notes.editor.toolbar.add_tag') }}</strong>
              {{ t('notes.HelpDialog.s6_i2_and') }}
              <strong>{{ t('notes.HelpDialog.delete') }}</strong>
              {{ t('notes.HelpDialog.s6_i2_after') }}
            </li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s7_title') }}</h3>
          <ul>
            <li><strong>{{ t('notes.HelpDialog.pin') }}</strong>{{ t('notes.HelpDialog.s7_i1_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.copy') }}</strong>{{ t('notes.HelpDialog.s7_i2_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.delete') }}</strong>{{ t('notes.HelpDialog.s7_i3_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.set_date') }}</strong>{{ t('notes.HelpDialog.s7_i4_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.share') }}</strong>{{ t('notes.HelpDialog.s7_i5_tail') }}</li>
            <li><strong>{{ t('notes.favorite') }}</strong>{{ t('notes.HelpDialog.s7_i6_tail') }}</li>
            <li>{{ t('notes.HelpDialog.s7_i7_tail') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s8_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s8_i1') }}</li>
            <li>{{ t('notes.HelpDialog.s8_i2') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s9_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s9_i1_tail') }}</li>
            <li>{{ t('notes.HelpDialog.s9_i2_tail') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s10_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s10_i1') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i2') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i3') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i4') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i5') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i6') }}</li>
            <li>{{ t('notes.HelpDialog.s10_i7') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s11_title') }}</h3>
          <ul>
            <li><strong>{{ t('notes.HelpDialog.offline_ready') }}</strong>{{ t('notes.HelpDialog.s11_i1_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.cold_restore') }}</strong>{{ t('notes.HelpDialog.s11_i2_tail') }}</li>
            <li><strong>{{ t('notes.HelpDialog.silent_prefetch') }}</strong>{{ t('notes.HelpDialog.s11_i3_tail') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s12_title') }}</h3>
          <ul>
            <li><strong>{{ t('notes.HelpDialog.trash') }}</strong>{{ t('notes.HelpDialog.s12_i1_tail') }}</li>
            <li>{{ t('notes.HelpDialog.s12_i2') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.s13_title') }}</h3>
          <ul>
            <li>{{ t('notes.HelpDialog.s13_i1') }}</li>
            <li>{{ t('notes.HelpDialog.s13_i2') }}</li>
          </ul>
        </section>

        <section>
          <h3>{{ t('notes.HelpDialog.faq_title') }}</h3>

          <details>
            <summary>{{ t('notes.HelpDialog.faq_1_q') }}</summary>
            <p>{{ t('notes.HelpDialog.faq_1_a1_prefix') }} https://www.woabc.com/auth {{ t('notes.HelpDialog.faq_1_a1_suffix') }}</p>
            <p>{{ t('notes.HelpDialog.faq_1_a2') }}</p>
            <p>
              {{ t('notes.HelpDialog.faq_1_a3_prefix') }}
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: -4px; margin: 0 2px;">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              {{ t('notes.HelpDialog.faq_1_a3_suffix') }}
            </p>
          </details>

          <details>
            <summary>{{ t('notes.HelpDialog.faq_2_q') }}</summary>
            <p>{{ t('notes.HelpDialog.faq_2_a1') }}</p>
          </details>

          <details>
            <summary>{{ t('notes.HelpDialog.faq_3_q') }}</summary>
            <p>{{ t('notes.HelpDialog.faq_3_a1') }}</p>
          </details>

          <details>
            <summary>{{ t('notes.HelpDialog.faq_4_q') }}</summary>
            <p>{{ t('notes.HelpDialog.faq_4_a1') }}</p>
          </details>

          <details>
            <summary>{{ t('notes.HelpDialog.faq_5_q') }}</summary>
            <p>{{ t('notes.HelpDialog.faq_5_a1') }}</p>
            <p>{{ t('notes.HelpDialog.faq_5_a2') }}</p>
          </details>
        </section>
      </NScrollbar>

      <footer class="help-footer">
        <NButton tertiary @click="emit('close')">{{ t('notes.HelpDialog.got_it') }}</NButton>
      </footer>
    </div>
  </NModal>
</template>

<style scoped>
.help-wrapper {
  width: min(720px, 96vw);
  /* 关键：确定高度，Flex 才能把剩余空间分给中间滚动区 */
  height: min(84vh, 820px);
  background: var(--card-bg, #fff);
  color: var(--card-fg, #111);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:host, .dark .help-wrapper {
  --card-bg: #1e1e1e;
  --card-fg: #e5e7eb;
}
.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0,0,0,.06);
  /* 头部不参与挤压 */
  flex: 0 0 auto;
}
.dark .help-header { border-bottom-color: rgba(255,255,255,.08); }
.title { margin: 0; font-size: 18px !important; font-weight: 600; }
.icon-btn {
  border: none; background: transparent; font-size: 18px; cursor: pointer;
  color: inherit; opacity: .8;
}
.icon-btn:hover { opacity: 1; }

/* 关键：中间滚动区要能收缩，占满剩余空间 */
.help-body {
  flex: 1 1 auto;
  min-height: 0;         /* 允许收缩，否则不会出现滚动 */
  overflow: hidden;      /* 滚动由 NScrollbar 接管 */
}

/* 调整正文左右留白（穿透到 NScrollbar 的内容层） */
:deep(.help-body .n-scrollbar-content) {
  padding: 12px 28px 16px;   /* 上 12，左右 28，下 16 */
  line-height: 1.6;
}

/* 让标题和页脚与正文左缘对齐 */
.help-header,
.help-footer {
  padding-left: 28px;
  padding-right: 28px;
}

/* 页脚固定高度，不参与挤压 */
.help-footer {
  padding: 10px 16px 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid rgba(0,0,0,.06);
  flex: 0 0 auto;
}
.dark .help-footer { border-top-color: rgba(255,255,255,.08); }

/* 小屏稍微收紧一点左右内边距 */
@media (max-width: 480px) {
  :deep(.help-body .n-scrollbar-content) { padding-left: 20px; padding-right: 20px; }
  .help-header, .help-footer { padding-left: 20px; padding-right: 20px; }
}

.help-body h3 { margin: 14px 0 8px; font-size: 15.5px; }
.help-body ul { margin: 0 0 8px 1.2em; padding: 0; }
.help-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .92em; padding: 0 4px; border-radius: 4px;
  background: rgba(125,125,125,.12);
}
.help-body details {
  margin: 6px 0; padding: 8px 10px; border-radius: 8px;
  background: rgba(99,102,241,.08);
}
.dark .help-body details { background: rgba(165,180,252,.12); }
</style>
