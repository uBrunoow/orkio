import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger
} from '@/components/ui/menubar'
import { Fragment } from 'react'
import {
  MENUS,
  commandLabel,
  isAvailable,
  menuBlocks,
  type Command,
  type CommandContext
} from './commands'
import { ariaKeys, formatKeys } from './keys'

/**
 * Menus da barra (Sessão, Ir, Janela, Ajuda), montados do registro de comandos: cada item mostra
 * o atalho e fica desabilitado quando não dá para rodar agora.
 */
export function AppMenus({
  commands,
  ctx
}: {
  commands: readonly Command[]
  ctx: CommandContext
}): React.JSX.Element {
  return (
    <Menubar aria-label="Menus do Orkio">
      {MENUS.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger>{menu.label}</MenubarTrigger>
          <MenubarContent>
            {menuBlocks(commands, menu.id, ctx).map((block, i) => (
              <Fragment key={i}>
                {i > 0 && <MenubarSeparator />}
                {block.map((c) => {
                  const Icon = c.icon
                  return (
                    <MenubarItem
                      key={c.id}
                      disabled={!isAvailable(c, ctx)}
                      onSelect={() => c.run(ctx)}
                      {...(c.keys ? { 'aria-keyshortcuts': ariaKeys(c.keys, ctx.isMac) } : {})}
                    >
                      {Icon ? <Icon /> : <span className="size-4" aria-hidden="true" />}
                      <span>{commandLabel(c, ctx)}</span>
                      {c.keys && (
                        <MenubarShortcut aria-hidden="true">
                          {formatKeys(c.keys, ctx.isMac)}
                        </MenubarShortcut>
                      )}
                    </MenubarItem>
                  )
                })}
              </Fragment>
            ))}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  )
}
