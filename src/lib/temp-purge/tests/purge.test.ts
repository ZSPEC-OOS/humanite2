import { describe, it, expect } from 'vitest'
import { decidePurge, PURGE_COLLECTIONS } from '../purge'

describe('temporary purge', () => {
  it('allows count, and delete only for the fixed collections', () => {
    expect(decidePurge({ action: 'count' })).toEqual({ ok: true, action: 'count' })
    expect(decidePurge({ action: 'delete', collection: PURGE_COLLECTIONS[0] })).toMatchObject({ ok: true, action: 'delete' })
    expect(decidePurge({ action: 'delete', collection: 'users' })).toMatchObject({ ok: false, status: 400 })
    expect(decidePurge({ action: 'delete' })).toMatchObject({ ok: false, status: 400 })
    expect(decidePurge({ action: 'explode' })).toMatchObject({ ok: false, status: 400 })
  })
})
