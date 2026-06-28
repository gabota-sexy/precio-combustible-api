import { useEffect, useRef } from 'react';
import { trackScrollMilestone } from '../utils/analytics';

/**
 * Fires scroll milestone events at 25%, 50%, 75% and 90% of page scroll depth.
 * Each milestone fires only once per page load.
 */
export function useScrollTracking(pagina: string) {
  const fired = useRef(new Set<number>());

  useEffect(() => {
    fired.current.clear();
    const milestones = [25, 50, 75, 90];

    const onScroll = () => {
      const scrollTop    = window.scrollY;
      const docHeight    = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = Math.round((scrollTop / docHeight) * 100);

      for (const m of milestones) {
        if (pct >= m && !fired.current.has(m)) {
          fired.current.add(m);
          trackScrollMilestone(m, pagina);
        }
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pagina]);
}
