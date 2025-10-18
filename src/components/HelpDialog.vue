<!-- src/components/HelpDialog.vue -->
<script setup lang="ts">
import { NButton, NModal, NScrollbar } from 'naive-ui'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <NModal
    :show="props.show"
    :mask-closable="true"
    :auto-focus="false"
    :z-index="5020"
    @update:show="val => { if (!val) emit('close') }"
  >
    <div class="help-wrapper" role="dialog" aria-modal="true" aria-label="帮助与使用说明">
      <header class="help-header">
        <h2 class="title">云笔记 · 使用说明</h2>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <NScrollbar
        class="help-body"
        style="flex: 1 1 auto; min-height: 0; overflow: hidden;"
      >
        <section>
          <h3>1) 快速开始</h3>
          <ul>
            <li>已登录直接进入主页；未登录会显示登录组件。</li>
            <li>主页顶部输入框用于<strong>新建笔记</strong>，保存后即出现在列表。</li>
            <li>列表按「置顶优先 + 创建时间倒序」排列；单条最大约 <code>20,000</code> 字。</li>
            <li>输入框草稿自动本地保存，刷新也不会丢；正式保存后自动清理草稿。</li>
          </ul>
        </section>

        <section>
          <h3>2) 新建 / 编辑 / 勾选任务</h3>
          <ul>
            <li><strong>新建</strong>：输入 → 保存。</li>
            <li><strong>编辑</strong>：在列表或日历进入笔记后修改并保存，界面即时更新。</li>
            <li><strong>任务勾选</strong>：形如 <code>- [ ]</code> / <code>- [x]</code> 的条目可直接点击切换完成状态。</li>
          </ul>
        </section>

        <section>
          <h3>3) 标签与筛选</h3>
          <ul>
            <li><strong>插入标签</strong>：从菜单选择标签；若输入框为空，会自动填入如 <code>#生活/购物</code> 并聚焦。</li>
            <li><strong>筛选笔记</strong>：点击菜单中的标签即可筛选；支持「无标签」筛选。</li>
            <li><strong>互斥规则</strong>：搜索与标签筛选互斥；切换时自动清理对方状态。</li>
            <li>清除筛选：横幅右侧「×」。</li>
          </ul>
        </section>

        <section>
          <h3>4) 搜索</h3>
          <ul>
            <li>点击右上角 <span aria-hidden="true">🔍</span> 打开搜索栏，输入关键字后执行。</li>
            <li>横幅展示「搜索结果」与匹配数量，支持直接导出当前结果。</li>
            <li>清除搜索：点「取消」或清空关键字。</li>
          </ul>
        </section>

        <section>
          <h3>5) 那年今日</h3>
          <ul>
            <li>在未输入、未搜索、未筛选、未选择时显示「那年今日」横幅。</li>
            <li>点击可进入/退出视图，仅显示历史同日的笔记；与搜索/标签互斥。</li>
          </ul>
        </section>

        <section>
          <h3>6) 选择模式（批量）</h3>
          <ul>
            <li>在主菜单选择「选择笔记」进入；顶部显示批量操作条。</li>
            <li>支持批量<strong>复制</strong>与<strong>删除</strong>；完成后点击「完成」退出。</li>
          </ul>
        </section>

        <section>
          <h3>7) 置顶 / 复制 / 删除</h3>
          <ul>
            <li><strong>置顶</strong>：列表项操作中切换（离线也生效，稍后自动同步）。</li>
            <li><strong>复制</strong>：将该条内容复制到剪贴板。</li>
            <li><strong>删除</strong>：支持单条与批量；相关标签/日历/搜索缓存会自动失效以保持一致。</li>
          </ul>
        </section>

        <section>
          <h3>8) 日历视图</h3>
          <ul>
            <li>在主菜单点击「日历」进入，按日期查看/创建/编辑/复制/置顶/删除。</li>
            <li>从日历编辑保存后，主页会自动定位到该条（必要时自动分页加载直至找到）。</li>
          </ul>
        </section>

        <section>
          <h3>9) 导出</h3>
          <ul>
            <li><strong>导出当前列表</strong>：处于搜索结果或标签筛选时，点击横幅里的「导出」。</li>
            <li><strong>批量导出</strong>：主菜单点「导出全部」，选择日期范围后导出为 TXT；单次最多 <strong>1500</strong> 条。</li>
          </ul>
        </section>

        <section>
          <h3>10) 登录与设置</h3>
          <ul>
            <li>主菜单可打开「账户」查看账号信息与统计。</li>
            <li>在「设置」里可调整字体等偏好。</li>
          </ul>
        </section>

        <section>
          <h3>11) 离线与缓存</h3>
          <ul>
            <li><strong>离线可用</strong>：新建/编辑/置顶/删除在离线时即时更新界面与本地快照，上线后自动同步到服务器。</li>
            <li><strong>错误提示节流</strong>：离线下拉加载仅提示一次错误并暂停，避免弹窗轰炸。</li>
            <li><strong>冷启动还原</strong>：若存在本地缓存/快照，将优先恢复。</li>
            <li><strong>静默预取</strong>：主页会在首屏后静默预取多页并写入缓存；24 小时内仅预取一次。</li>
          </ul>
        </section>

        <section>
          <h3>12) 回收站</h3>
          <ul>
            <li>在主菜单打开「回收站」。可恢复（即时插回并排序）或清空（刷新数据与缓存）。</li>
          </ul>
        </section>

        <section>
          <h3>常见问题</h3>
          <details>
            <summary>为什么搜索/标签/那年今日会互相“顶掉”？</summary>
            <p>为避免多重过滤叠加导致困惑与性能开销，采取互斥策略：始终只保留一个视图。</p>
          </details>
          <details>
            <summary>离线时的编辑/删除会丢吗？</summary>
            <p>不会，离线操作会写入本地快照与同步队列，联网后自动提交到服务器。</p>
          </details>
          <details>
            <summary>导出上限 1500 条不够怎么办？</summary>
            <p>请分时间段多次导出，例如按月/季度拆分。</p>
          </details>
          <details>
            <summary>刷新后未保存的文本为什么还在？</summary>
            <p>主页输入框启用了本地草稿；正式保存后草稿自动清理。</p>
          </details>
        </section>
      </NScrollbar>

      <footer class="help-footer">
        <NButton tertiary @click="emit('close')">知道了</NButton>
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
.title { margin: 0; font-size: 18px; font-weight: 600; }
.icon-btn {
  border: none; background: transparent; font-size: 18px; cursor: pointer;
  color: inherit; opacity: .8;
}
.icon-btn:hover { opacity: 1; }

/* 关键：中间滚动区要能收缩，占满剩余空间 */
.help-body {
  flex: 1 1 auto;
  min-height: 0;        /* 允许收缩，否则不会出现滚动 */
  overflow: hidden;     /* 滚动由 NScrollbar 接管 */
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
