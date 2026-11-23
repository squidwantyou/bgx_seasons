import type { GameCatalog } from '@bgx/protocol';
import { AppError } from '../errors.js';
import type { AnyGamePlugin } from './types.js';

const plugins = new Map<string, AnyGamePlugin>();

/** 游戏模块自行调用；空目录不会注册。重复 id 直接报错，避免静默覆盖。 */
export function registerGame(plugin: AnyGamePlugin): void {
  const id = plugin.meta.id;
  if (!id) throw new Error('game plugin meta.id is required');
  if (plugins.has(id)) throw new Error(`duplicate game id: ${id}`);
  plugins.set(id, plugin);
}

export function getGame(gameId: string): AnyGamePlugin {
  const plugin = plugins.get(gameId);
  if (!plugin) {
    throw new AppError('game_not_found', `没有这个游戏：${gameId}`, 404);
  }
  return plugin;
}

export function listGames(): GameCatalog[] {
  return [...plugins.values()].map((plugin) => plugin.meta);
}

export function registeredGameIds(): string[] {
  return [...plugins.keys()];
}
