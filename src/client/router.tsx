import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  for (const listener of listeners) listener();
  window.scrollTo(0, 0);
}

export interface Location {
  path: string;
  query: URLSearchParams;
}

const current = (): Location => ({
  path: location.pathname.replace(/\/+$/, '') || '/',
  query: new URLSearchParams(location.search),
});

export function useLocation(): Location {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const update = () => setValue(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return value;
}

interface LinkProps {
  to: string;
  class?: string;
  current?: boolean;
  children: ComponentChildren;
}

/** An ordinary link that swaps the view without reloading the page. */
export function Link({ to, class: className, current: isCurrent, children }: LinkProps) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} class={className} aria-current={isCurrent ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  );
}
