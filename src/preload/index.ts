import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Solo estos canales pueden usarse desde las páginas.
const SEND = [
  'pet:hit',
  'pet:click',
  'pet:dblclick',
  'pet:dragStart',
  'pet:dragEnd',
  'pet:contextmenu',
  'chat:send',
  'chat:close',
  'chat:resize'
] as const
const ON = ['pet:anim', 'chat:update', 'chat:focus', 'settings:refresh'] as const
const INVOKE = [
  'config:get',
  'config:save',
  'ai:listModels',
  'ai:test',
  'memory:list',
  'memory:delete',
  'memory:clear',
  'reminders:list',
  'reminders:delete'
] as const

type SendCh = (typeof SEND)[number]
type OnCh = (typeof ON)[number]
type InvokeCh = (typeof INVOKE)[number]

const api = {
  send(channel: SendCh, ...args: unknown[]): void {
    if ((SEND as readonly string[]).includes(channel)) ipcRenderer.send(channel, ...args)
  },
  on(channel: OnCh, cb: (...args: any[]) => void): () => void {
    if (!(ON as readonly string[]).includes(channel)) return () => {}
    const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  invoke<T = unknown>(channel: InvokeCh, ...args: unknown[]): Promise<T> {
    if (!(INVOKE as readonly string[]).includes(channel)) return Promise.reject(new Error('canal no permitido'))
    return ipcRenderer.invoke(channel, ...args) as Promise<T>
  }
}

export type PetApi = typeof api

contextBridge.exposeInMainWorld('api', api)
