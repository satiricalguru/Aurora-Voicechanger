import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1];

// Heading lines slide up out of a mask the first time they scroll into view.
export function RevealLines({ lines, as: Tag = 'h2', className, delay = 0 }) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span className="reveal-line" key={i}>
          <motion.span
            initial={{ y: '105%' }}
            whileInView={{ y: '0%' }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 1.0, ease, delay: delay + i * 0.08 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

export function FadeUp({ children, delay = 0, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-8% 0px' }}
      transition={{ duration: 0.9, ease, delay }}
    >
      {children}
    </motion.div>
  );
}

export const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
};
export const staggerChild = {
  hidden: { opacity: 0, y: 28, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.8, ease } },
};
