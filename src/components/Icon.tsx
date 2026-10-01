type Name = 'image' | 'arrow' | 'sun' | 'download' | 'reset' | 'check' | 'plus' | 'close';

export function Icon({ name, size = 20 }: { name: Name; size?: number }) {
  const paths: Record<Name, string> = {
    image: 'M4 4h16v16H4z M4 16l5-6 7 10 M14 17l3-4 3 4 M16 8h.01',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    sun: 'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    download: 'M12 3v12 M7 10l5 5 5-5 M5 16v4h14v-4',
    reset: 'M4 10a8 8 0 1 1 1 7 M4 4v6h6',
    check: 'm5 12 4 4L19 6',
    plus: 'M12 5v14 M5 12h14',
    close: 'm6 6 12 12 M6 18 18 6',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
