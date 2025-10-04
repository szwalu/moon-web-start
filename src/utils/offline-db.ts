// src/utils/offline-db.ts
// 统一管理 IndexedDB + 离线写入 + 待同步队列（Outbox）

// ---------- Types ----------
export interface LocalNote {
  id: string
  content: string
  created_at: string
  updated_at: string
  is_pinned?: boolean
  weather?: string | null
  user_id?: string
  dirty?: boolean
  localOnly?: boolean
}

export interface OutboxItem {
  key?: number
  op: 'insert' | 'update' | 'delete' | 'pin'
  note_id: string
  payload: any
  ts: number
  retries?: number
}

export interface ServerOps {
  insert: (payload: any) => Promise<any>
  update: (id: string, patch: any) => Promise<any>
  remove: (id: string) => Promise<any>
  pin: (id: string, is_pinned: boolean) => Promise<any>
}

// ---------- DB constants ----------
const DB_NAME = 'woabc-notes'
const STORES = {
  notes: 'notes',
  meta: 'meta',
  outbox: 'outbox',
} as const

// ---------- Open / Upgrade ----------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onerror = () => reject(req.error)
    req.onblocked = () => console.warn('[idb] open blocked')

    req.onsuccess = () => {
      const db = req.result
      const needOutbox = !db.objectStoreNames.contains(STORES.outbox)
      const needNotes = !db.objectStoreNames.contains(STORES.notes)
      const needMeta = !db.objectStoreNames.contains(STORES.meta)

      if (!needOutbox && !needNotes && !needMeta) {
        resolve(db)
        return
      }

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
          const os = udb.createObjectStore(STORES.outbox, {
            keyPath: 'key',
            autoIncrement: true,
          })
          os.createIndex('note_id', 'note_id', { unique: false })
          os.createIndex('ts', 'ts', { unique: false })
        }
      }
      up.onsuccess = () => resolve(up.result)
    }
  })
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

// ---------- Online helpers ----------
export function isOnline(): boolean {
  try {
    return typeof navigator !== 'undefined' ? navigator.onLine : true
  }
  catch {
    return true
  }
}

export function onOnlineOnce(cb: () => void) {
  if (typeof window === 'undefined')
    return
  const handler = () => {
    window.removeEventListener('online', handler)
    cb()
  }
  window.addEventListener('online', handler)
}

// ---------- Snapshot API ----------
export async function saveNotesSnapshot(list: LocalNote[]) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.notes)

    // 读出现有本地条目，避免覆盖脏记录
    const existing: LocalNote[] = await new Promise((resolve, reject) => {
      const r = store.getAll()
      r.onsuccess = () => resolve((r.result || []) as LocalNote[])
      r.onerror = () => reject(r.error)
    })

    const map = new Map<string, LocalNote>()
    for (const n of existing) map.set(String(n.id), n)

    for (const srv of list) {
      const id = String(srv.id)
      const cur = map.get(id)
      if (cur && (cur.dirty || cur.localOnly))
        continue
      map.set(id, { ...srv, dirty: !!srv.dirty, localOnly: !!srv.localOnly })
    }

    await clearStore(store)
    for (const n of map.values()) store.put(n)
  })
}

export async function readNotesSnapshot(): Promise<LocalNote[]> {
  return withTx(['notes'], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.notes)
    return getAll(store) as Promise<LocalNote[]>
  })
}

export async function putNoteLocal(
  note: LocalNote,
  opts?: { dirty?: boolean; localOnly?: boolean },
) {
  const toSave = {
    ...note,
    dirty: opts?.dirty ?? true,
    localOnly: opts?.localOnly ?? false,
  }
  await withTx(['notes'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.notes).put(toSave)
  })
  return toSave
}

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
      const r = st.get(id)
      r.onsuccess = () => resolve(r.result || undefined)
      r.onerror = () => reject(r.error)
    })
    if (cur)
      st.put({ ...cur, ...patch, dirty: false, localOnly: false })
  })
}

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

export async function removeNoteLocal(id: string) {
  await withTx(['notes'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.notes).delete(id)
  })
}

// ---------- Outbox ----------
export async function queueMutation(item: Omit<OutboxItem, 'ts' | 'key' | 'retries'>) {
  const rec: OutboxItem = { ...item, ts: Date.now(), retries: 0 }
  await withTx(['outbox'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.outbox).add(rec)
  })
}

export async function readOutbox(): Promise<OutboxItem[]> {
  return withTx(['outbox'], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.outbox)
    const items = await getAll(store) as OutboxItem[]
    return items.sort((a, b) => a.ts - b.ts)
  })
}

export async function deleteOutboxItem(key: number) {
  await withTx(['outbox'], 'readwrite', async (tx) => {
    tx.objectStore(STORES.outbox).delete(key)
  })
}

export async function deleteOutboxByNoteId(noteId: string) {
  await withTx(['outbox'], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.outbox)
    const all = await getAll(store) as OutboxItem[]
    for (const it of all) {
      if (String(it.note_id) === String(noteId) && typeof it.key === 'number')
        store.delete(it.key)
    }
  })
}

export async function queuePendingNote(note: LocalNote) {
  await putNoteLocal(note, { dirty: true, localOnly: true })
  const { id, content, created_at, updated_at, is_pinned = false, weather = null, user_id } = note
  await queueMutation({
    op: 'insert',
    note_id: id,
    payload: { id, content, created_at, updated_at, is_pinned, weather, user_id },
  })
}

// ---------- Flush + Auto ----------
export async function flushOutbox(server: ServerOps) {
  const items = await readOutbox()
  if (!items.length)
    return

  for (const it of items) {
    try {
      switch (it.op) {
        case 'insert': {
          const created = await server.insert({ ...it.payload })
          const patch = created
            ? {
                created_at: created.created_at,
                updated_at: created.updated_at,
                is_pinned: created.is_pinned,
                weather: created.weather ?? null,
                user_id: created.user_id ?? it.payload?.user_id,
              }
            : {}
          await markNoteSynced(it.note_id, patch)
          break
        }
        case 'update': {
          await server.update(it.note_id, { ...it.payload })
          await markNoteClean(it.note_id, { ...it.payload })
          break
        }
        case 'delete': {
          try {
            await server.remove(it.note_id)
          }
          catch {
            // 服务器没有也无所谓，保持本地一致性
          }
          await removeNoteLocal(it.note_id)
          break
        }
        case 'pin': {
          const isPinned = !!it.payload?.is_pinned
          await server.pin(it.note_id, isPinned)
          await markNoteClean(it.note_id, { is_pinned: isPinned })
          break
        }
        default:
          break
      }
      if (typeof it.key === 'number')
        await deleteOutboxItem(it.key)
    }
    catch (e) {
      console.warn('[outbox] sync failed, stop this round:', it, e)
      break
    }
  }
}

export function setupOnlineAutoFlush(server: ServerOps, opts?: { onSynced?: () => void }) {
  let inFlight = false

  const tryFlush = async () => {
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

  tryFlush()

  if (typeof window !== 'undefined')
    window.addEventListener('online', tryFlush)
}

// ---------- IDB helpers ----------
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

// ---------- UID cache helper ----------
export function getCachedUid(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('last_uid')
      return v || null
    }
  }
  catch {}
  return null
}

// 统计 outbox 数量（调试面板/角标用）
export async function countOutbox(): Promise<number> {
  return withTx(['outbox'], 'readonly', async (tx) => {
    const store = tx.objectStore(STORES.outbox)
    return await new Promise<number>((resolve, reject) => {
      const r = store.count()
      r.onsuccess = () => resolve(r.result || 0)
      r.onerror = () => reject(r.error)
    })
  })
}

// 读取最近 N 条 outbox（调试面板用）
export async function readOutboxTail(n = 20): Promise<OutboxItem[]> {
  const all = await readOutbox()
  return all.slice(-n)
}
