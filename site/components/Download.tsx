'use client'

import { useEffect, useState } from 'react'
import type { Dictionary } from '@/i18n/pt-BR'
import {
  detectPlatform,
  suggestDownload,
  type ClientPlatform,
  type DownloadFile,
  type DownloadKind,
  type LatestRelease
} from '@/lib/releases'
import styles from '@/app/home.module.css'

type UAData = {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
}

const ORDER: DownloadKind[] = ['mac-arm64', 'mac-x64', 'windows', 'linux-appimage', 'linux-deb']

function size(bytes: number): string {
  return bytes > 0 ? ` · ${(bytes / 1024 / 1024).toFixed(0)} MB` : ''
}

/**
 * Botão de download com o arquivo sugerido para este computador. Sem JavaScript (ou antes de
 * detectar), mostra todos os arquivos; sem release, leva à página de releases.
 */
export function Download({
  t,
  release,
  releasesUrl,
  variant = 'full'
}: {
  t: Dictionary
  release: LatestRelease | null
  releasesUrl: string | null
  variant?: 'full' | 'hero'
}) {
  const [platform, setPlatform] = useState<ClientPlatform | null>(null)

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: UAData }
    const ua = nav.userAgentData
    const base = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      uaDataPlatform: ua?.platform
    }
    let active = true
    // Arquitetura só nos navegadores Chromium (Client Hints); nos outros fica desconhecida.
    const run = async (): Promise<void> => {
      let architecture: string | undefined
      try {
        architecture = (await ua?.getHighEntropyValues?.(['architecture']))?.architecture
      } catch {
        architecture = undefined
      }
      if (active) setPlatform(detectPlatform({ ...base, architecture }))
    }
    void run()
    return () => {
      active = false
    }
  }, [])

  const files = ORDER.map((k) => release?.files[k]).filter((f): f is DownloadFile => !!f)
  const suggested = platform && release ? suggestDownload(platform, release.files) : null

  if (!release || files.length === 0) {
    return (
      <div className={styles.downloadBox}>
        {variant === 'hero' ? (
          <a className={styles.primary} href="#download">
            {t.download.title}
          </a>
        ) : releasesUrl ? (
          <a className={styles.primary} href={releasesUrl}>
            {t.download.all}
          </a>
        ) : (
          <span className={styles.primaryDisabled}>{t.download.title}</span>
        )}
        {variant === 'full' && (
          <p className={styles.note}>{releasesUrl ? t.download.unavailable : t.download.soon}</p>
        )}
      </div>
    )
  }

  const label = (f: DownloadFile) => t.download.labels[f.kind]
  return (
    <div className={styles.downloadBox}>
      {suggested ? (
        <a className={styles.primary} href={suggested.url} data-testid="download-suggested">
          {t.download.suggested} {label(suggested)}
        </a>
      ) : (
        <a className={styles.primary} href="#download">
          {t.download.title}
        </a>
      )}
      <p className={styles.note}>
        {t.download.version} {release.version}
        {platform?.os === 'linux' && !release.files['linux-appimage'] && !release.files['linux-deb']
          ? ` · ${t.download.linux}`
          : ''}
      </p>
      {variant === 'full' && (
        <>
          <ul className={styles.fileList} aria-label={t.download.others}>
            {files
              .filter((f) => f !== suggested)
              .map((f) => (
                <li key={f.kind}>
                  <a href={f.url}>
                    {label(f)}
                    <span className={styles.fileMeta}>
                      {f.name}
                      {size(f.size)}
                    </span>
                  </a>
                </li>
              ))}
          </ul>
          {platform?.os === 'linux' ? (
            <p className={styles.note}>{t.download.linuxNote}</p>
          ) : (
            platform?.os !== 'windows' && <p className={styles.note}>{t.download.macNote}</p>
          )}
          <a className={styles.textLink} href={release.url}>
            {t.download.all}
          </a>
        </>
      )}
    </div>
  )
}
