// src/utils/offline-db.ts
// 统一管理 IndexedDB + 离线写入 + 待同步队列（Outbox）

export interface LocalNote {
  id: string
  content: string
  created_at: string
  updated_at: string
  is_pinned?: boolean
  weather?: string | null
  // 离线写入标记
  dirty?: boolean
  localOnly?: boolean
  user_id?: string
}

export interface OutboxItem {
  key?: number // 自增主键
  op: 'insert' | 'update' | 'delete' | 'pin'
  note_id: string
  payload: any // 各操作携带的最小变更
  ts: number // 入队时间，升序执行
  retries?: number
}

// ------------------------------------------------------
// IndexedDB 打开与升级
// ------------------------------------------------------
const DB_NAME = 'woabc-notes'
const STORES = {
  notes: 'notes',
  meta: 'meta',
  outbox: 'outbox',
} as const

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 1) 不带版本打开（不会触发降级错误）
    const req = indexedDB.open(DB_NAME)
    req.onerror = () => reject(req.error)
    req.onblocked = () => console.warn('[idb] open blocked')

    req.onsuccess = () => {
      const db = req.result
      const needCreateOutbox = !db.objectStoreNames.contains(STORES.outbox)
      const needCreateNotes = !db.objectStoreNames.contains(STORES.notes)
      const needCreateMeta = !db.objectStoreNames.contains(STORES.meta)

      if (!needCreateOutbox && !needCreateNotes && !needCreateMeta) {
        resolve(db)
        return
      }

      // 2) 需要升级：关闭旧连接，用“当前版本+1”重开并在 onupgradeneeded 里建表
      const nextVersion = db.version + 1
      db.close()

      const up = indexedDB.open(DB_NAME, nextVersion)
      up.onerror = () => reject(up.error)
      up.onblocked = () => console.warn('[idb] upgrade blocked')

      up.onupgradeneeded = () => {
        const udb = up.result
        if (!udb.objectStoreNames.contains(STORES.notes))
          udb.createObjectStore(STORES.notes, { keyPath: 'id' })

        if (!udb.objectStoreNames.contains(STORES.meta))
          udb.createObjectStore(STORES.meta, { keyPath: 'key' })

        if (!udb.objectStoreNames.contains(STORES.outbox)) {
          const os = udb.createObjectStore(STORES.outbox, { keyPath: 'key', autoIncrement: true })
          os.createIndex('note_id', 'note_id', { unique: false })
          os.createIndex('ts', 'ts', { unique: false })
        }
      }
      up.onsuccess = () => resolve(up.result)
    }
  })
}

/** 是否在线（SSR/老浏览器兜底为 true） */
export function isOnline(): boolean {
  try {
    return typeof navigator !== 'undefined' ? navigator.onLine : true
  }
  catch {
    return true
  }
}

/** （一次性）当恢复联网时触发 */
export function onOnlineOnce(cb: () => void) {
  if (typeof window === 'undefined')
    return
  const handler = () => {
    window.removeEventListener('online', handler)
    cb()
  }
  window.addEventListener('online', handler)
}

function withTx<T>(
  stores: (keyof typeof STORES)[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDB().then((db) => {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores.map(s => STORES[s]), mode)
      tx.oncomplete = () => db.close()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      Promise.resolve(fn(tx)).then(resolve).catch(reject)
    })
  })
}

// ------------------------------------------------------
// 方案一：快照 API（保留）
// ------------------------------------------------------
export async function saveNotesSnapshot(list: LocalNote[]) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.notes)
    // 简化：清空再写（冷启动离线能还原“当前可见列表”）
    await clearStore(store)
    for (const n of list) {
      const safe = { ...n, dirty: !!n.dirty, localOnly: !!n.localOnly }
      store.put(safe)
    }
  })
}

export async function readNotesSnapshot(): Promise<LocalNote[]> {
  return withTx(['notes'], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.notes)
    return getAll(store) as Promise<LocalNote[]>
  })
}

// 本地 upsert 单条 note，默认打上 dirty 标记
export async function putNoteLocal(note: LocalNote, opts?: { dirty?: boolean; localOnly?: boolean }) {
  const dirty = opts?.dirty ?? true
  const localOnly = opts?.localOnly ?? false
  const toSave = { ...note, dirty, localOnly }
  await withTx(['notes'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.notes).put(toSave)
  })
  return toSave
}

// 成功上行后，去掉 dirty/localOnly（并可选补丁）
export async function markNoteSynced(id: string, patch?: Partial<LocalNote>) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.notes)
    const getReq = store.get(id)
    await new Promise<void>((resolve, reject) => {
      getReq.onsuccess = () => resolve()
      getReq.onerror = () => reject(getReq.error)
    })
    const cur = (getReq.result || {}) as LocalNote
    const next: LocalNote = { ...cur, ...patch, dirty: false, localOnly: false }
    store.put(next)
  })
}

// ------------------------------------------------------
// 方案二：Outbox 队列 API + 冲洗
// ------------------------------------------------------

// 基础入队
export async function queueMutation(item: Omit<OutboxItem, 'ts' | 'key' | 'retries'>) {
  const rec: OutboxItem = { ...item, ts: Date.now(), retries: 0 }
  await withTx(['outbox'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.outbox).add(rec)
  })
}

// 兼容 auth.vue：离线“新建”专用便捷封装
export async function queuePendingNote(note: LocalNote) {
  // 先把本地 note 标记脏 + localOnly
  await putNoteLocal(note, { dirty: true, localOnly: true })
  // 入 outbox，payload 使用最小需要字段（服务端 insert 用）
  const { id, content, created_at, updated_at, is_pinned = false, weather = null, user_id } = note
  await queueMutation({
    op: 'insert',
    note_id: id,
    payload: { id, content, created_at, updated_at, is_pinned, weather, user_id },
  })
}

// 兼容 auth.vue：离线“删除旧笔记”专用便捷封装
export async function queuePendingDelete(note_id: string) {
  // 1) 本地 notes 表直接删除（离线立即生效）
  await withTx(['notes'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.notes).delete(note_id)
  })

  // 2) 入队 outbox 的 delete 操作（上线后由 flushOutbox -> serverOps.remove 同步到服务端）
  await queueMutation({
    op: 'delete',
    note_id,
    payload: {}, // 删除不需要额外信息
  })
}

// 兼容 auth.vue：离线“编辑旧笔记”专用便捷封装
export async function queuePendingUpdate(note_id: string, patch: Partial<LocalNote>) {
  // 1) 本地 notes 表更新：合并已有记录，打上 dirty 标记（localOnly = false）
  await withTx(['notes'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.notes)

    const current: LocalNote | undefined = await new Promise((resolve, reject) => {
      const req = store.get(note_id)
      req.onsuccess = () => resolve(req.result as LocalNote | undefined)
      req.onerror = () => reject(req.error)
    })

    const base: LocalNote = current || {
      id: note_id,
      content: '',
      created_at: patch.created_at || new Date().toISOString(),
      updated_at: patch.updated_at || new Date().toISOString(),
      is_pinned: false,
      weather: null,
      user_id: patch.user_id,
    }

    const next: LocalNote = {
      ...base,
      ...patch,
      dirty: true,
      localOnly: false,
    }

    store.put(next)
  })

  // 2) 入队 outbox，等在线 flush 时执行 serverOps.update(id, patch)
  await queueMutation({
    op: 'update',
    note_id,
    payload: { ...patch },
  })
}

// 读取 / 删除 outbox
export async function readOutbox(): Promise<OutboxItem[]> {
  return withTx(['outbox'], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.outbox)
    const items = await getAll(store) as OutboxItem[]
    return items.sort((a, b) => (a.ts - b.ts))
  })
}
export async function deleteOutboxItem(key: number) {
  await withTx(['outbox'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.outbox).delete(key)
  })
}

// 服务端操作接口（用 supabase 的地方在业务层实现并传进来）
export interface ServerOps {
  insert: (payload: any) => Promise<any> // payload: { id, content, ... }
  update: (id: string, patch: any) => Promise<any> // 最小变更
  remove: (id: string) => Promise<any>
  pin: (id: string, is_pinned: boolean) => Promise<any>
}

// 冲洗 outbox（按入队顺序），单条失败会保留在队列中
export async function flushOutbox(server: ServerOps) {
  const items = await readOutbox()
  if (!items.length)
    return

  for (const it of items) {
    try {
      switch (it.op) {
        case 'insert': {
          await server.insert({ ...it.payload })
          // 标记本地已同步
          await markNoteSynced(it.note_id)
          break
        }
        case 'update': {
          await server.update(it.note_id, { ...it.payload })
          await markNoteSynced(it.note_id, { ...it.payload })
          break
        }
        case 'delete': {
          await server.remove(it.note_id)
          // 本地也删掉（从快照里移除）
          await withTx(['notes'], 'readwrite', async (tx) => {
            tx.objectStore(STORES.notes).delete(it.note_id)
          })
          break
        }
        case 'pin': {
          const isPinned = !!(it.payload?.is_pinned)
          await server.pin(it.note_id, isPinned)
          await markNoteSynced(it.note_id, { is_pinned: isPinned })
          break
        }
      }
      if (typeof it.key === 'number')
        await deleteOutboxItem(it.key)
    }
    catch (e) {
      // 单条失败：保留在队列，等待下次 online
      console.warn('[outbox] sync failed:', it, e)
    }
  }
}

// 自动监听 online 并冲洗（若已在线会先冲洗一次）
export function setupOnlineAutoFlush(server: ServerOps) {
  if (isOnline()) {
    // 立即尝试一次
    flushOutbox(server).catch(err => console.warn('[outbox] initial flush failed', err))
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      flushOutbox(server).catch(err => console.warn('[outbox] online flush failed', err))
    })
  }
}

// ------------------------------------------------------
// 工具函数
// ------------------------------------------------------
function getAll(store: IDBObjectStore): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}
function clearStore(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
