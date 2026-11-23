import type { GameUiPlugin } from './types';

type ModuleWithPlugin = { plugin: GameUiPlugin };

const modules = import.meta.glob<ModuleWithPlugin>('./*/index.tsx', { eager: true });

/** 自动发现 games/<id>/index.tsx；新增游戏不需要改这里。 */
export const gamePlugins: GameUiPlugin[] = Object.values(modules)
  .map((mod) => mod.plugin)
  .filter((plugin): plugin is GameUiPlugin => Boolean(plugin))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

const byId = new Map(gamePlugins.map((plugin) => [plugin.meta.id, plugin]));

export function getGameUi(gameId: string | null | undefined): GameUiPlugin | null {
  return gameId ? (byId.get(gameId) ?? null) : null;
}

export function listGameUis(): GameUiPlugin[] {
  return gamePlugins;
}
