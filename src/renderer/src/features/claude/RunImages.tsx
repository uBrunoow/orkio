import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ipcCall } from '../../lib/ipc'
import type { RunImageRef } from './run-transcript'

type Loaded = { state: 'loading' } | { state: 'ok'; url: string } | { state: 'missing' }

/** Lê os bytes pelo IPC e mostra por `blob:` (revogado ao sair da tela). */
function useRunImage(ref: RunImageRef): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  useEffect(() => {
    let url: string | null = null
    let alive = true
    void ipcCall(() => window.orkio.claude.runImage(ref.runId, ref.n), null).then((img) => {
      if (!alive) return
      if (!img) return setLoaded({ state: 'missing' })
      url = URL.createObjectURL(new Blob([new Uint8Array(img.data)], { type: img.mime }))
      setLoaded({ state: 'ok', url })
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [ref.runId, ref.n])
  return loaded
}

function Thumb({ image, label }: { image: RunImageRef; label: string }): React.JSX.Element {
  const loaded = useRunImage(image)
  const [open, setOpen] = useState(false)
  if (loaded.state !== 'ok') {
    return (
      <div className="flex h-24 w-32 items-center justify-center rounded-md border border-border bg-muted px-2 text-center text-2xs text-subtle-foreground">
        {loaded.state === 'loading' ? 'Carregando…' : 'Imagem indisponível'}
      </div>
    )
  }
  return (
    <>
      <button
        type="button"
        data-testid="run-image"
        aria-label={`Abrir ${label}`}
        onClick={() => setOpen(true)}
        className="h-24 max-w-48 overflow-hidden rounded-md border border-border bg-muted outline-none hover:border-ring focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <img src={loaded.url} alt={label} className="h-full w-auto object-contain" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] gap-3 sm:max-w-[min(90vw,1200px)]">
          <DialogTitle className="text-sm">{label}</DialogTitle>
          <img
            src={loaded.url}
            alt={label}
            className="max-h-[78vh] w-full rounded-md object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Miniaturas das imagens das ferramentas (print do navegador, imagem lida); clique abre grande. */
export function RunImages({
  images
}: {
  images?: readonly RunImageRef[] | undefined
}): React.JSX.Element | null {
  if (!images || images.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2" aria-label="Imagens">
      {images.map((img, i) => (
        <Thumb
          key={`${img.runId}:${img.n}`}
          image={img}
          label={images.length > 1 ? `Imagem ${i + 1} de ${images.length}` : 'Imagem'}
        />
      ))}
    </div>
  )
}
