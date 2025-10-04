// src/utils/db.ts

const DB_NAME = 'woabc-notes'
const DB_VERSION = 3 // ⬅ 提升版本号触发升级
const STORE_NOTES = 'notes'

function openNotesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result

      // 如果已存在，检查 keyPath；不是 'id' 就删除重建
      if (db.objectStoreNames.contains(STORE_NOTES)) {
        const tx = req.transaction!
        const existing = tx.objectStore(STORE_NOTES)
        const kp = existing.keyPath as string | string[] | null

        const needsRecreate
          = kp !== 'id' // kp 可能是 null（out-of-line），也可能是别的
        if (needsRecreate) {
          db.deleteObjectStore(STORE_NOTES)
          db.createObjectStore(STORE_NOTES, { keyPath: 'id' })
        }
      }
      else {
        db.createObjectStore(STORE_NOTES, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 覆盖式保存当前可见列表为离线快照 */
export async function saveNotesSnapshot(list: any[]): Promise<void> {
  if (!Array.isArray(list))
    return
  const db = await openNotesDB()
  try {
    const tx = db.transaction(STORE_NOTES, 'readwrite')
    const store = tx.objectStore(STORE_NOTES)

    // 覆盖式：清空再写入
    await new Promise<void>((res, rej) => {
      const r = store.clear()
      r.onsuccess = () => res()
      r.onerror = () => rej(r.error)
    })

    const slim = (n: any) => ({
      id: n.id,
      content: n.content,
      created_at: n.created_at,
      updated_at: n.updated_at,
      is_pinned: !!n.is_pinned,
      weather: n.weather ?? null,
    })

    for (const n of list) {
      await new Promise<void>((res, rej) => {
        const r = store.put(slim(n)) // ✅ 有 keyPath: 'id'，不传第二参
        r.onsuccess = () => res()
        r.onerror = () => rej(r.error)
      })
    }

    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error)
    })
  }
  finally {
    db.close()
  }
}

export async function loadNotesSnapshot(): Promise<any[]> {
  const db = await openNotesDB()
  try {
    const tx = db.transaction(STORE_NOTES, 'readonly')
    const store = tx.objectStore(STORE_NOTES)
    const all = await new Promise<any[]>((res, rej) => {
      const r = store.getAll()
      r.onsuccess = () => res(r.result || [])
      r.onerror = () => rej(r.error)
    })
    return all
  }
  finally {
    db.close()
  }
}
