import { useCallback, useEffect, useState } from 'react'
import { getApiErrorMessage } from '@/api/client'
import { listItems } from '@/api/items'
import { listTags } from '@/api/tags'
import type { TagRead } from '@/types/api'

export type BackendStatus =
  | 'checking'
  | 'online'
  | 'degraded'
  | 'offline'

interface BackendHealthState {
  status: BackendStatus
  latencyMs: number | null
  itemTotal: number | null
  tagCount: number | null
  tags: TagRead[]
  itemsError: string | null
  tagsError: string | null
  checkedAt: string | null
}

const initialState: BackendHealthState = {
  status: 'checking',
  latencyMs: null,
  itemTotal: null,
  tagCount: null,
  tags: [],
  itemsError: null,
  tagsError: null,
  checkedAt: null,
}

export function useBackendHealth() {
  const [state, setState] = useState<BackendHealthState>(initialState)
  const [requestId, setRequestId] = useState(0)

  useEffect(() => {
    let active = true
    const startedAt = performance.now()

    void Promise.allSettled([
      listItems({ limit: 1 }),
      listTags(),
    ]).then(([itemsResult, tagsResult]) => {
      if (!active) return

      const itemsOk = itemsResult.status === 'fulfilled'
      const tagsOk = tagsResult.status === 'fulfilled'
      const fulfilledCount = Number(itemsOk) + Number(tagsOk)

      setState({
        status:
          fulfilledCount === 2
            ? 'online'
            : fulfilledCount === 1
              ? 'degraded'
              : 'offline',
        latencyMs: Math.round(performance.now() - startedAt),
        itemTotal: itemsOk ? itemsResult.value.total : null,
        tagCount: tagsOk ? tagsResult.value.length : null,
        tags: tagsOk ? tagsResult.value : [],
        itemsError: itemsOk
          ? null
          : getApiErrorMessage(itemsResult.reason),
        tagsError: tagsOk ? null : getApiErrorMessage(tagsResult.reason),
        checkedAt: new Date().toISOString(),
      })
    })

    return () => {
      active = false
    }
  }, [requestId])

  const refresh = useCallback(() => {
    setState((previous) => ({
      ...previous,
      status: 'checking',
      itemsError: null,
      tagsError: null,
    }))
    setRequestId((current) => current + 1)
  }, [])

  return { ...state, refresh }
}
