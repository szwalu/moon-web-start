// server.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import webpush from 'web-push'
import cors from 'cors'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(cors({
  origin: 'http://localhost:1888',
}))

app.use(express.json())

const publicVapidKey = 'BBiSxungGb4HJ5KBt4bTJ01_UiSqjJ9afGW7PiVBr3lx8K4jCASqdNdDLwTHxw6ORoWrxAu9sUGo671dfTfnWJQ'
const privateVapidKey = 'riKgHf-f6WzACkNytRwyGlCRcQbnMlvQzW3gcn4QV04'

webpush.setVapidDetails('mailto:test@example.com', publicVapidKey, privateVapidKey)

let subscription = null

app.post('/subscribe', (req, res) => {
  subscription = req.body
  res.status(201).json({})
})

app.post('/send-notification', (req, res) => {
  if (subscription) {
    const payload = JSON.stringify({ title: 'PWA 推送通知！', body: '这条消息来自你的服务器！' })

    webpush.sendNotification(subscription, payload)
      .then(() => res.status(200).json({ success: true }))
    // --- 修改点: 将 err 改为 _err ---
      .catch((_err) => {
        res.sendStatus(500)
      })
  }
  else {
    res.status(404).json({ error: '没有找到订阅信息' })
  }
})

app.use(express.static(path.join(__dirname, '')))

const port = 3000
app.listen(port)
