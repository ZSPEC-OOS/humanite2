declare module 'diff' {
  interface Change {
    value: string
    added?: boolean
    removed?: boolean
    count?: number
  }
  export function diffWords(oldStr: string, newStr: string): Change[]
  export function diffChars(oldStr: string, newStr: string): Change[]
  export function diffLines(oldStr: string, newStr: string): Change[]
}
