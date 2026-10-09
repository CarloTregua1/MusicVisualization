import { Player } from './player'

const KEY = '__audioToMathPlayer'

/**
 * The app's single Player. Kept on globalThis so it survives hot module
 * reloads: React Fast Refresh keeps the loaded track in state, so a fresh
 * Player (with no buffer, and yet another AudioContext) would leave the
 * play button silently doing nothing.
 */
export function getPlayer(): Player {
  const g = globalThis as unknown as Record<string, Player | undefined>
  return (g[KEY] ??= new Player())
}
