import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const explicit = useRef(false);
  useEffect(() => {
    try { explicit.current = ['light', 'dark'].includes(localStorage.getItem('still-theme') ?? ''); } catch { /* Session-only preference. */ }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => { if (!explicit.current) setTheme(media.matches ? 'dark' : 'light'); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return <button class="button button-quiet theme-toggle" aria-label={label} title={label} onClick={() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    explicit.current = true;
    setTheme(next);
    try { localStorage.setItem('still-theme', next); } catch { /* Editing works even without storage. */ }
  }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></> : <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />}
    </svg>
  </button>;
}
