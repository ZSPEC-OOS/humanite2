import { describe, it, expect } from 'vitest'
import { decidePurge, PURGE_COLLECTIONS } from '../purge'

const TOKEN = 'a-long-enough-secret'
describe('temporary purge gate', () => {
  it('is off (404) when the token is unset or too short', () => {
    expect(decidePurge({ token: 'x', action: 'count' }, undefined)).toMatchObject({ ok: false, status: 404 })
    expect(decidePurge({ token: 'short', action: 'count' }, 'short')).toMatchObject({ ok: false, status: 404 })
  })
  it('rejects a wrong or missing token', () => {
    expect(decidePurge({ token: 'nope', action: 'count' }, TOKEN)).toMatchObject({ ok: false, status: 401 })
    expect(decidePurge({ token: undefined, action: 'count' }, TOKEN)).toMatchObject({ ok: false, status: 401 })
  })
  it('allows count, and delete only for the fixed collections', () => {
    expect(decidePurge({ token: TOKEN, action: 'count' }, TOKEN)).toEqual({ ok: true, action: 'count' })
    expect(decidePurge({ token: TOKEN, action: 'delete', collection: PURGE_COLLECTIONS[0] }, TOKEN)).toMatchObject({ ok: true, action: 'delete' })
    expect(decidePurge({ token: TOKEN, action: 'delete', collection: 'users' }, TOKEN)).toMatchObject({ ok: false, status: 400 })
    expect(decidePurge({ token: TOKEN, action: 'delete' }, TOKEN)).toMatchObject({ ok: false, status: 400 })
    expect(decidePurge({ token: TOKEN, action: 'explode' }, TOKEN)).toMatchObject({ ok: false, status: 400 })
  })
})
