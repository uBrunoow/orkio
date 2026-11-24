/** macOS? (atalhos com ⌘, textos "Cmd"). Uma regra só: o user agent do Chromium. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
}
