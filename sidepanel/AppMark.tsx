import React, { useEffect, useRef, useState } from 'react';

const H_PATH = 'M30 18C35.5 18 40 22.5 40 28L40 59C48 48 57 42 70 42C90 42 104 56 104 76L104 96C104 102 100 106 94 106C88 106 84 102 84 96L84 77C84 67 78 62 69 62C52 62 40 75 40 91L40 96C40 102 36 106 30 106C24 106 20 102 20 96L20 28C20 22.5 24.5 18 30 18Z';
const POO_PATH = 'M64 24C73 24 80 30 80 39C80 47 77 53 72 57C86 59 94 68 94 79C94 82 93 84 92 86C104 89 112 96 112 106C112 116 105 122 96 124C91 126 84 126 80 126C74 126 69 126 64 126C59 126 54 126 48 126C44 126 37 126 32 124C23 122 16 116 16 106C16 96 24 89 36 86C35 84 34 82 34 79C34 68 42 59 56 57C51 53 48 47 48 39C48 30 55 24 64 24Z';
const SMILE_H = [21, 110, 43, 123, 85, 123, 107, 110];
const SMILE_POO = [43, 99, 53, 108, 75, 108, 85, 99];
const DOT = [98, 25] as const;
const FLIGHT = [
  [0, ...DOT], [280, 110, 7], [650, 89, -5], [1040, 57, -9],
  [1390, 27, 6], [1740, 44, 12], [2050, 70, -4], [2360, ...DOT],
];

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeIn = (value: number) => clamp(value) ** 3;
const easeOut = (value: number) => 1 - (1 - clamp(value)) ** 3;

const sampleFlight = (time: number): [number, number] => {
  for (let index = 1; index < FLIGHT.length; index += 1) {
    if (time > FLIGHT[index][0]) continue;
    const a = FLIGHT[index - 1];
    const b = FLIGHT[index];
    const before = FLIGHT[Math.max(0, index - 2)];
    const after = FLIGHT[Math.min(FLIGHT.length - 1, index + 1)];
    const span = b[0] - a[0];
    const t = clamp((time - a[0]) / span);
    const t2 = t * t;
    const t3 = t2 * t;
    return [1, 2].map((axis) => {
      const startVelocity = index === 1 ? 0 : (b[axis] - before[axis]) / (b[0] - before[0]);
      const endVelocity = index === FLIGHT.length - 1
        ? 0
        : (after[axis] - a[axis]) / (after[0] - a[0]);
      return (2 * t3 - 3 * t2 + 1) * a[axis]
        + (t3 - 2 * t2 + t) * span * startVelocity
        + (-2 * t3 + 3 * t2) * b[axis]
        + (t3 - t2) * span * endVelocity;
    }) as [number, number];
  }
  return [DOT[0], DOT[1]];
};

export const AppMark: React.FC<{ accessibleLabel: string }> = ({ accessibleLabel }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number>(0);
  const timeoutRef = useRef<number>(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!isAnimating || !svg) return undefined;

    const body = svg.querySelector<SVGPathElement>('.app-mark-body');
    const poo = svg.querySelector<SVGPathElement>('.app-mark-poo');
    const letters = svg.querySelector<SVGGElement>('.app-mark-letters');
    const smile = svg.querySelector<SVGPathElement>('.app-mark-smile');
    const fly = svg.querySelector<SVGGElement>('.app-mark-fly');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!body || !poo || !letters || !smile || !fly) return undefined;

    const render = (time: number, reduced = false) => {
      const entry = reduced ? Number(time < 720) : easeOut((time - 260) / 820);
      const hSink = reduced ? entry : easeIn((time - 350) / 680);
      const hReturn = reduced ? 0 : easeOut((time - 1980) / 380);
      const pooRise = reduced ? entry : easeOut((time - 490) / 650);
      const pooSink = reduced ? 0 : easeIn((time - 1740) / 450);
      const pooFade = reduced ? 0 : easeIn((time - 1780) / 330);
      const hOpacity = reduced ? 1 - entry : Math.max(1 - hSink, hReturn);
      const pooOpacity = reduced ? entry : easeOut((time - 490) / 650) * (1 - pooFade);
      const smileIn = reduced ? entry : easeOut((time - 300) / 880);
      const smileOut = reduced ? 0 : easeIn((time - 1720) / 450);
      const smileProgress = smileIn * (1 - smileOut);
      const [x, y] = reduced ? DOT : sampleFlight(time);
      const [, nextY] = reduced ? DOT : sampleFlight(Math.min(time + 12, 2360));
      const tilt = reduced ? 0 : Math.max(-10, Math.min(10, (nextY - y) * 6));
      const bodyScale = 1 - .04 * hSink + .04 * hReturn + .012 * Math.sin(Math.PI * hReturn);
      const bodyY = 10 * hSink * (1 - hReturn) + 10 * (1 - hReturn) * hReturn;
      const impact = reduced ? 0 : .03 * Math.sin(Math.PI * clamp((time - 900) / 300));
      const pooScaleX = 1 + impact - .08 * pooSink;
      const pooScaleY = .96 + .04 * pooRise - .015 * impact - .09 * pooSink;
      const pooY = 18 * (1 - pooRise) + 16 * pooSink;
      const smileValues = SMILE_H.map((value, index) => (
        value + (SMILE_POO[index] - value) * smileProgress
      ));

      body.setAttribute('transform', `translate(0 ${bodyY.toFixed(2)}) scale(1 ${bodyScale.toFixed(3)})`);
      body.style.opacity = String(hOpacity);
      poo.setAttribute('transform', `translate(${(64 * (1 - pooScaleX)).toFixed(2)} ${pooY.toFixed(2)}) scale(${pooScaleX.toFixed(3)} ${pooScaleY.toFixed(3)})`);
      poo.style.opacity = String(pooOpacity);
      letters.style.opacity = String(pooOpacity * easeOut((time - 820) / 350));
      smile.setAttribute('d', `M${smileValues[0].toFixed(1)} ${smileValues[1].toFixed(1)}C${smileValues.slice(2).map((value) => value.toFixed(1)).join(' ')}`);
      fly.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${tilt.toFixed(2)})`);
      buttonRef.current?.classList.toggle('is-flying', !reduced && time > 80 && time < 2280);
    };

    const start = performance.now();
    if (reducedMotion) {
      render(0, true);
      timeoutRef.current = window.setTimeout(() => {
        render(1000, true);
        setIsAnimating(false);
      }, 720);
    } else {
      const tick = (now: number) => {
        const elapsed = Math.min(now - start, 2360);
        render(elapsed);
        if (elapsed < 2360) frameRef.current = requestAnimationFrame(tick);
        else setIsAnimating(false);
      };
      frameRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(timeoutRef.current);
    };
  }, [isAnimating]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="brand-mark"
      aria-label={accessibleLabel}
      aria-pressed={isAnimating}
      disabled={isAnimating}
      onClick={() => setIsAnimating(true)}
    >
      <svg ref={svgRef} className="app-mark" viewBox="0 0 128 128" aria-hidden="true">
        <path className="app-mark-body" d={H_PATH} />
        <path className="app-mark-poo" d={POO_PATH} opacity="0" transform="translate(0 126) scale(1 0)" />
        <g className="app-mark-letters" opacity="0" fill="none" stroke="var(--bg)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M43 76v20m0-12c4-4 9-4 12-1 2 2 2 4 2 7v6" />
          <path d="M71 76v20m0-12c4-4 9-4 12-1 2 2 2 4 2 7v6" />
        </g>
        <path className="app-mark-smile" d="M21 110C43 123 85 123 107 110" />
        <g className="app-mark-fly" transform={`translate(${DOT.join(' ')})`}>
          <g className="app-mark-wings">
            <ellipse className="app-mark-left-wing" cx="-5" cy="-5" rx="5" ry="3" />
            <ellipse className="app-mark-right-wing" cx="5" cy="-5" rx="5" ry="3" />
          </g>
          <circle className="app-mark-fly-body" r="7" />
          <circle className="app-mark-fly-eye" cx="2.5" cy="-1.5" r="1.2" />
        </g>
      </svg>
    </button>
  );
};
