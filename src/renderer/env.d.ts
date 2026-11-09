import type { PetApi } from '../preload/index'

declare global {
  interface Window {
    api: PetApi
  }
}

export {}
