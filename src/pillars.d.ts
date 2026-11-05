// Los pilares que no publican tipos: SOLO lo que usa Eco, con la forma de su código.
// (Archivo de declaraciones globales, sin import/export arriba: si no, `declare module`
// sería un aumento y no una declaración.)

// @dotrino/content-client 0.3.1 no publica tipos.
declare module '@dotrino/content-client' {
  export interface ContentRef { owner: string, cid: string, key: string | null }
  export interface ContentClient {
    owner: string
    put (data: Uint8Array | ArrayBuffer | string, opts?: {
      mime?: string
      encrypt?: boolean
      acl?: 'public' | 'private'
      ttlMs?: number
      meta?: object
    }): Promise<ContentRef & { size: number, existed: boolean }>
    get (ref: { owner?: string, cid: string, key?: string | null } | string): Promise<Uint8Array>
    pin (cid: string, pinned?: boolean): Promise<unknown>
    remove (cid: string): Promise<unknown>
    setThumbnail (cid: string, thumbnailCid: string): Promise<unknown>
  }
  export function buildUrl (ref: { owner: string, cid: string, key?: string | null }, appUrl?: string): string
  export function parseRef (input: string): ContentRef | null
}

declare module '@dotrino/content-client/session' {
  import type { ContentClient } from '@dotrino/content-client'
  export function nodeSession (getIdentity: () => Promise<unknown>, opts?: { onError?: (e: Error) => void }): {
    node (): Promise<ContentClient | null>
    retry (): Promise<ContentClient | null>
    hasNode (): boolean
    lastError (): string | null
  }
}

declare module '@dotrino/content-client/public' {
  export function fetchPublic (opts: {
    client: unknown
    owner: string
    cid: string
    head?: boolean
    full?: boolean
    timeoutMs?: number
  }): Promise<{ cid: string, mime: string, size: number, url: string | null, bytes: Uint8Array<ArrayBuffer> | null }>
}
