import { dirname } from 'node:path'

/** Executa um comando sem shell e devolve a saída de erro (onde o `codesign -dv` escreve). */
export type ExecStderr = (
  command: string,
  args: string[]
) => Promise<{ code: number; stderr: string }>

/**
 * O bundle do Orkio tem assinatura Developer ID? Sem ela (ad-hoc ou nenhuma), o Squirrel.Mac
 * recusa a atualização e o Orkio cai no download manual do DMG.
 *
 * `exePath` = `app.getPath('exe')` (…/Orkio.app/Contents/MacOS/Orkio). `buildFlag` vem do build
 * (`MAIN_VITE_MAC_SIGNED=1` quando o CI tinha certificado) e só decide se o `codesign` não rodar.
 */
export async function isMacAppSigned(
  exec: ExecStderr,
  exePath: string,
  buildFlag: boolean
): Promise<boolean> {
  const bundle = dirname(dirname(dirname(exePath)))
  let result: { code: number; stderr: string }
  try {
    result = await exec('codesign', ['-dv', '--verbose=2', bundle])
  } catch {
    return buildFlag
  }
  return parseCodesign(result.code, result.stderr)
}

export function parseCodesign(code: number, stderr: string): boolean {
  if (code !== 0) return false
  if (/Signature=adhoc/i.test(stderr)) return false
  const team = /^TeamIdentifier=(.+)$/m.exec(stderr)?.[1]?.trim()
  return !!team && team.toLowerCase() !== 'not set'
}
