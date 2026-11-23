import { useEffect } from 'react';

export const DEFAULT_PAGE_TITLE = 'BGX · 在线桌游';
export const DEFAULT_PAGE_DESCRIPTION = 'BGX 在线桌游：黑白棋、炸飞机，多人在线对战。';

/**
 * 给当前页面设置 title / meta description；离开页面时恢复默认值。
 * 放在路由组件顶层调用，参数变化时自动更新。
 */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="description"]');
    const prevTitle = document.title;
    const prevDescription = meta?.getAttribute('content') ?? DEFAULT_PAGE_DESCRIPTION;

    document.title = title;
    if (meta) meta.setAttribute('content', description);

    return () => {
      document.title = prevTitle || DEFAULT_PAGE_TITLE;
      if (meta) meta.setAttribute('content', prevDescription);
    };
  }, [title, description]);
}
