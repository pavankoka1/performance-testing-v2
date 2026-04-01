import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect } from "react";

export function EyeWidget() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 220, damping: 28 });
  const sy = useSpring(my, { stiffness: 220, damping: 28 });

  useEffect(() => {
    const max = 12;
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight * 0.32;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      mx.set((dx / len) * max);
      my.set((dy / len) * max);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [mx, my]);

  return (
    <div className="eye-widget" aria-hidden>
      <div className="eye-shell">
        <motion.div className="eye-pupil-wrap" style={{ x: sx, y: sy }}>
          <div className="eye-pupil-outer" />
          <div className="eye-pupil-inner" />
        </motion.div>
      </div>
      <span className="eye-label">always watching render cost</span>
    </div>
  );
}
