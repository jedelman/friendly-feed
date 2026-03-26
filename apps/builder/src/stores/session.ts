/**
 * Session store — persisted to localStorage.
 * Holds the connected Bluesky user.
 */

import { writable, derived } from 'svelte/store'
import type { User } from '$lib/types'

const STORAGE_KEY = 'ff_session'

function loadSession(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

function createSession() {
  const { subscribe, set, update } = writable<User | null>(loadSession())

  return {
    subscribe,
    login(user: User) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
      set(user)
    },
    logout() {
      localStorage.removeItem(STORAGE_KEY)
      set(null)
    },
    refresh(patch: Partial<User>) {
      update(u => {
        if (!u) return u
        const updated = { ...u, ...patch }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return updated
      })
    },
  }
}

export const session = createSession()
export const isLoggedIn = derived(session, $s => $s !== null)
