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
// 方案一：快照 API（保留 + 修复“覆盖脏条目”的问题）
export async function saveNotesSnapshot(list: LocalNote[]) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.notes)

    // 1) 先读出现有本地条目
    const existing: LocalNote[] = await new Promise((resolve, reject) => {
      const r = store.getAll()
      r.onsuccess = () => resolve((r.result || []) as LocalNote[])
      r.onerror = () => reject(r.error)
    })

    // 2) 用 id 做 map
    const map = new Map<string, LocalNote>()
    for (const n of existing) map.set(String(n.id), n)

    // 3) 把“在线列表”写进去；但不覆盖本地的 dirty/localOnly 记录
    for (const srv of list) {
      const id = String(srv.id)
      const cur = map.get(id)
      if (cur && (cur.dirty || cur.localOnly)) {
        // 本地有脏版本，优先保留本地（避免丢失离线编辑/新建）
        continue
      }
      map.set(id, { ...srv, dirty: !!srv.dirty, localOnly: !!srv.localOnly })
    }

    // 4) 清空后用“合并结果”重写（不会丢本地脏条，因为 map 里保留了）
    await clearStore(store)
    for (const n of map.values())
      store.put(n)
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

// ---- 本地 Note 便捷方法（被 flush 时使用）----
export async function getNoteLocal(id: string): Promise<LocalNote | undefined> {
  return withTx(['notes'], 'readonly', async (tx) => {
    return new Promise<LocalNote | undefined>((resolve, reject) => {
      const req = tx.objectStore(STORES.notes).get(id)
      req.onsuccess = () => resolve(req.result || undefined)
      req.onerror = () => reject(req.error)
    })
  })
}

export async function markNoteClean(id: string, patch?: Partial<LocalNote>) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    const st = tx.objectStore(STORES.notes)

    const cur = await new Promise<LocalNote | undefined>((resolve, reject) => {
      const req = st.get(id)
      req.onsuccess = () => resolve(req.result || undefined)
      req.onerror = () => reject(req.error)
    })

    if (cur)
      st.put({ ...cur, ...patch, dirty: false, localOnly: false })
  })
}

export async function removeNoteLocal(id: string) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.notes).delete(id)
  })
}

// ------------------------------------------------------
// 冲洗 outbox（按入队顺序），单条失败会保留在队列中（为保持有序，遇错即停止，本次不继续）
// ------------------------------------------------------
export async function flushOutbox(server: ServerOps, opts?: { onEachSuccess?: (item: OutboxItem) => void }) {
  const items = await readOutbox()
  if (!items.length)
    return

  for (const it of items) {
    try {
      switch (it.op) {
        // ---- offline-db.ts: flushOutbox 内 ----
        case 'insert': {
          // ★ 兜底：insert 前强制补 user_id，避免 RLS 拒绝
          const payload = { ...it.payload }
          try {
            // 动态导入避免循环依赖
            const mod = await import('@/composables/useSync')
            const uid = await mod.getUidSoft?.()
            if (uid && !payload.user_id)
              payload.user_id = uid
          }
          catch {
            // ignore
          }

          const created = await server.insert(payload)

          // 将要写回本地的补丁（多行构造，避免 multiline-ternary 报错）
          const syncedPatch = created
            ? {
                created_at: created.created_at,
                updated_at: created.updated_at,
                is_pinned: created.is_pinned,
                weather: created.weather ?? null,
                user_id: created.user_id ?? payload.user_id,
              }
            : {}

          await markNoteSynced(it.note_id, syncedPatch)
          break
        }
        case 'update': {
          await server.update(it.note_id, it.payload)
          await markNoteClean(it.note_id, { ...it.payload })
          break
        }
        case 'delete': {
          await server.remove(it.note_id)
          await removeNoteLocal(it.note_id)
          break
        }
        case 'pin': {
          await server.pin(it.note_id, !!it.payload?.is_pinned)
          await markNoteClean(it.note_id, { is_pinned: !!it.payload?.is_pinned })
          break
        }
        default:
          console.warn('[offline] unknown op:', it.op)
      }

      // 移出 outbox
      if (typeof it.key === 'number')
        await deleteOutboxItem(it.key)

      opts?.onEachSuccess?.(it)
    }
    catch (e) {
      // 为保持顺序一致性，遇到出错先停止；等待下次 online 再重试
      console.warn('[offline] flush item failed, stop this round:', it, e)
      break
    }
  }

  // 可选：刷新一次快照
  try {
    const snapshot = await readNotesSnapshot()
    await saveNotesSnapshot(snapshot)
  }
  catch {}
}

// ------------------------------------------------------
// 上线后自动冲洗（含冷启动若已在线也会尝试一次；带并发保护）
// ------------------------------------------------------
export function setupOnlineAutoFlush(server: ServerOps, opts?: { onSynced?: () => void }) {
  let inFlight = false

  const doFlush = async () => {
    if (!isOnline() || inFlight)
      return
    inFlight = true
    try {
      await flushOutbox(server)
      opts?.onSynced?.()
    }
    finally {
      inFlight = false
    }
  }

  // 启动时先尝试一次
  doFlush()

  // 监听上线
  if (typeof window !== 'undefined')
    window.addEventListener('online', doFlush)
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
