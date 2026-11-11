/** The few extension APIs the specs call inside the service worker; keeps the e2e package free of @types/chrome. */
declare namespace chrome {
  namespace runtime {
    function getManifest(): { name: string; version: string }
  }
  namespace storage.local {
    function get(key: string): Promise<Record<string, { token: string } | undefined>>
  }
  namespace tabs {
    interface Tab {
      id?: number
    }
    function query(info: { active?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>
    function sendMessage(tabId: number, message: unknown): Promise<unknown>
  }
}
