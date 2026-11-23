import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerGame } from './registry.js';
import type { AnyGamePlugin } from './types.js';

/**
 * 自动发现 src/games/<id>/index.ts（编译后是 dist/games/<id>/index.js）。
 *
 * 新增游戏只需要新建目录并导出 plugin，不用改服务端入口。
 * 开发时 tsx 直接跑 .ts，生产构建后跑 .js，所以按当前文件扩展名选择。
 */
export async function registerDiscoveredGames(): Promise<string[]> {
  const here = import.meta.url;
  const dir = new URL('.', here);
  const ext = here.endsWith('.ts') ? '.ts' : '.js';
  const entries = await readdir(fileURLToPath(dir), { withFileTypes: true });
  const ids: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const spec = new URL(`${entry.name}/index${ext}`, dir).href;
    let mod: { plugin?: AnyGamePlugin; default?: AnyGamePlugin };
    try {
      mod = (await import(/* @vite-ignore */ spec)) as typeof mod;
    } catch (err) {
      throw new Error(`failed to load game module ${entry.name}: ${String(err)}`);
    }
    const plugin = mod.plugin ?? mod.default;
    if (!plugin) throw new Error(`game module ${entry.name} does not export plugin`);
    registerGame(plugin);
    ids.push(plugin.meta.id);
  }

  if (ids.length === 0) throw new Error('no game modules found');
  return ids;
}
