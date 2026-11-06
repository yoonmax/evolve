// A small promise layer over IndexedDB. If storage is unavailable (private browsing, a
// blocked origin) callers get a clear StorageUnavailable error rather than a hang.
export const DB_NAME = 'evolve'
export const DB_VERSION = 1

export class StorageUnavailable extends Error {
  constructor(message = 'Saving is not available in this browser window.') {
    super(message)
    this.name = 'StorageUnavailable'
  }
}

let connection = null

export function openDatabase(factory = globalThis.indexedDB) {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    if (!factory) {
      reject(new StorageUnavailable())
      return
    }
    let request
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch {
      reject(new StorageUnavailable())
      return
    }
    request.onupgradeneeded = (event) => migrate(request.result, event.oldVersion)
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
    request.onerror = () => reject(new StorageUnavailable(request.error?.message))
    request.onblocked = () => reject(new StorageUnavailable('Another evolve tab is blocking the database. Close it and try again.'))
  }).catch((error) => {
    connection = null
    throw error
  })
  return connection
}

/** Schema migrations are additive and run in order. */
export function migrate(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('creatures', { keyPath: 'id' })
    db.createObjectStore('experiments', { keyPath: 'id' })
    db.createObjectStore('generations', { keyPath: ['experimentId', 'generation'] })
    db.createObjectStore('kv', { keyPath: 'key' })
  }
}

export function resetConnection() {
  connection = null
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(friendlyError(tx.error))
    tx.onabort = () => reject(friendlyError(tx.error))
  })
}

function friendlyError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('Browser storage is full. Delete saved experiments in settings to make room.')
  return error ?? new Error('The browser could not save this.')
}

export async function dbGet(store, key) {
  const db = await openDatabase()
  return wrap(db.transaction(store).objectStore(store).get(key))
}

export async function dbGetAll(store, range) {
  const db = await openDatabase()
  return wrap(db.transaction(store).objectStore(store).getAll(range))
}

export async function dbPut(store, value) {
  const db = await openDatabase()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  return completed(tx)
}

export async function dbDelete(store, key) {
  const db = await openDatabase()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  return completed(tx)
}

export async function dbClear(stores = ['creatures', 'experiments', 'generations', 'kv']) {
  const db = await openDatabase()
  const tx = db.transaction(stores, 'readwrite')
  for (const store of stores) tx.objectStore(store).clear()
  return completed(tx)
}

export async function storageUsage() {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  return { usage, quota }
}
