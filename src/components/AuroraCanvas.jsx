import { useEffect, useRef } from 'react';
import { AuroraScene } from '../gl/AuroraScene';

export default function AuroraCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    let scene;
    try { scene = new AuroraScene(ref.current); }
    catch (e) { console.warn('WebGL unavailable, using static background', e); }
    return () => scene?.dispose();
  }, []);
  return <canvas ref={ref} className="gl-canvas" aria-hidden="true" />;
}
