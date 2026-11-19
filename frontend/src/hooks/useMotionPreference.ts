import { useEffect, useState } from 'react';

export function useMotionPreference() {
  const [preference, setPreference] = useState(() => {
    try { return localStorage.getItem('classmate-motion') === 'off' ? 'off' : 'on'; } catch { return 'on'; }
  });
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) { return; }
    const update = () => setSystemReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { try { localStorage.setItem('classmate-motion', preference); } catch { /* Motion still works when storage is unavailable. */ } }, [preference]);
  return { enabled: !systemReduced && preference !== 'off', systemReduced, toggle: () => setPreference((value) => value === 'off' ? 'on' : 'off') };
}
