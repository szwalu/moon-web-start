// 文件：api/hello.ts
export default function handler(req, res) {
  res.status(200).json({ message: 'API 正常工作' })
}
