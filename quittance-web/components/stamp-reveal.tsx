'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * StampReveal — text "inked onto" the surface like a receipt being printed.
 */
export function StampReveal({
  text,
  delay = 0,
  charDelay = 28,
  className = '',
  as: Tag = 'span',
}: {
  text: string;
  delay?: number;
  charDelay?: number;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<'pristine' | 'printing' | 'done'>(
    'pristine',
  );
  const started = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const total = delay + text.length * charDelay + 300;
          setTimeout(() => setState('printing'), delay);
          setTimeout(() => setState('done'), delay + total);
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [text, delay, charDelay]);

  const chars = text.split('');
  const totalMs = chars.length * charDelay;

  const Cmp = Tag as unknown as React.ComponentType<
    React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }
  >;

  return (
    <Cmp
      ref={containerRef}
      className={`relative ${className}`}
      aria-label={text}
    >
      {/* Print-head: thin marigold line sweeping left → right */}
      {state === 'printing' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-seal"
          style={{
            left: 0,
            animation: `print-head-sweep ${totalMs + 60}ms linear ${delay}ms both`,
          }}
        />
      )}

      {chars.map((ch, i) => {
        const isSpace = ch === ' ';
        const charRevealDelay = delay + i * charDelay;

        if (isSpace) {
          return (
            <span key={i} className="inline-block">
              &nbsp;
            </span>
          );
        }

        return (
          <span
            key={i}
            aria-hidden
            className="relative inline-block"
            style={{ verticalAlign: 'bottom' }}
          >
            {/* The stamp block — visible until revealed */}
            {state !== 'done' && (
              <span
                className="absolute inset-0 inline-block"
                style={{
                  backgroundColor: 'var(--seal)',
                  borderRadius: '1px',
                  opacity: state === 'pristine' ? 0.72 : 0,
                  transform:
                    state === 'pristine' ? 'scaleY(0.88)' : 'scaleY(0)',
                  transition:
                    state === 'printing'
                      ? `opacity 160ms ${charRevealDelay}ms ease-out, transform 160ms ${charRevealDelay}ms ease-out`
                      : 'none',
                }}
              />
            )}
            {/* The actual character */}
            <span
              style={{
                color: state === 'pristine' ? 'transparent' : 'inherit',
                opacity: state === 'printing' ? undefined : undefined,
                transition:
                  state === 'printing'
                    ? `color 60ms ${charRevealDelay + 80}ms linear`
                    : 'none',
              }}
            >
              {ch}
            </span>
          </span>
        );
      })}
    </Cmp>
  );
}
