import { useEffect, useRef, useState, useCallback } from 'react';
import Lenis from 'lenis';
import { motion } from '../lib/motion';

// Lenis drives native window scroll, so framer-motion's useScroll and
// whileInView keep working; we also publish scroll progress for the WebGL scene.
export function useSmoothScroll(ids) {
  const lenisRef = useRef(null);
  const [active, setActive] = useState(ids[0]);
  const activeRef = useRef(ids[0]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lenis = new Lenis({ autoRaf: true, lerp: reduce ? 1 : 0.09, wheelMultiplier: 0.9 });
    lenisRef.current = lenis;

    const onScroll = ({ scroll, limit, velocity }) => {
      const vh = window.innerHeight;
      motion.scroll = scroll;
      motion.hero = Math.min(1, scroll / (vh * 0.9));
      motion.page = limit > 0 ? scroll / limit : 0;
      motion.velocity = velocity;
      document.documentElement.style.setProperty('--tb-shade', String(Math.min(1, scroll / 200)));

      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= vh * 0.4) current = id;
      }
      if (current !== activeRef.current) { activeRef.current = current; setActive(current); }
    };
    lenis.on('scroll', onScroll);
    onScroll({ scroll: window.scrollY, limit: lenis.limit, velocity: 0 });

    const onPointer = (e) => {
      motion.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      motion.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onPointer);
    return () => { window.removeEventListener('pointermove', onPointer); lenis.destroy(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    lenisRef.current?.scrollTo(id === 'home' ? 0 : el, { offset: -12, duration: 1.4 });
  }, []);

  return { active, scrollTo };
}
