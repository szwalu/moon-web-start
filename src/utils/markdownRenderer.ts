// src/utils/markdownRenderer.ts

import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import linkAttrs from 'markdown-it-link-attributes'

// 1. 初始化单例
const md = new MarkdownIt({
  html: false, // 安全性：禁用 HTML 标签，防止 XSS
  linkify: true,
  breaks: true,
})

// 2. 注册插件
md.use(taskLists, { enabled: true, label: true })
  .use(mark)
  .use(ins)
  .use(linkAttrs, {
    attrs: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  })

// 3. 辅助函数：判断音频
function isAudio(url: string) {
  return /\.(mp3|wav|m4a|ogg|aac|flac|webm)(\?|$)/i.test(url)
}

// 4. 自定义 Image 渲染规则 (保留了原本的下载链接逻辑)
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')

  const style = token.attrGet('style')
  token.attrSet('style', `${style ? `${style}; ` : ''}max-width:100%;height:auto;`)

  const imgHtml = self.renderToken(tokens, idx, options)
  const src = token.attrGet('src') || ''
  const alt = token.content || ''

  const prev = tokens[idx - 1]?.type
  const next = tokens[idx + 1]?.type

  // 如果图片本身就在链接里，就不再包裹下载链接了
  if (prev === 'link_open' && next === 'link_close')
    return imgHtml

  return `<a href="${src}" download target="_blank" rel="noopener noreferrer" title="${alt}">${imgHtml}</a>`
}

// 5. 自定义 Link 渲染规则 (音频播放器逻辑)
// 获取原始的渲染规则，如果没有则使用默认的
const defaultLinkOpen = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
const defaultLinkClose = md.renderer.rules.link_close || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''

  if (isAudio(href)) {
    // 【关键点】：使用 env 变量来标记状态，而不是全局变量
    // env 是每次调用 render 时独立传入的对象，绝对安全
    env.inAudioLink = true
    return `<audio controls src="${href}" preload="metadata" onclick="event.stopPropagation()" style="display: block; width: 100%; max-width: 240px; height: 32px; margin: 6px auto; border-radius: 9999px; outline: none;"></audio><span style="display:none">`
  }

  return defaultLinkOpen(tokens, idx, options, env, self)
}

md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
  // 【关键点】：读取当前的 env 状态
  if (env.inAudioLink) {
    env.inAudioLink = false
    return '</span>'
  }
  return defaultLinkClose(tokens, idx, options, env, self)
}

// 导出单例
export { md }
