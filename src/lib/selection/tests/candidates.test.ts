import { describe, it, expect } from 'vitest'
import { candidateCountForIntensity } from '../candidates'

describe('candidateCountForIntensity', () => {
  it.each([
    [1, 1], [2, 1], [3, 1],
    [4, 2], [5, 2], [6, 2],
    [7, 3], [8, 3], [9, 3], [10, 3],
  ])('intensity %i -> %i candidates', (intensity, expected) => {
    expect(candidateCountForIntensity(intensity)).toBe(expected)
  })
})
