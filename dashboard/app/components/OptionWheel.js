"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";

export default function OptionWheel({
  items = [],
  defaultSelected = 0,
  onChange,
  textColor = "var(--text-muted)",
  activeColor = "var(--text-primary)",
  fontSize = 0.95,
  spacing = 2.6,
  curve = 0.4,
  tilt = 4,
  blur = 0,
  fade = 0.35,
  minOpacity = 0.25,
  smoothing = 180,
  className = "",
}) {
  const rootRef = useRef(null);
  const itemRefs = useRef([]);
  const posRef = useRef(defaultSelected);
  const targetRef = useRef(defaultSelected);
  const rafRef = useRef(null);
  const lastRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const selectedRef = useRef(defaultSelected);
  const [selectedIndex, setSelectedIndex] = useState(defaultSelected);

  onChangeRef.current = onChange;

  const runFrame = useCallback((now) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    const target = targetRef.current;
    const cur = posRef.current;
    let next = cur + (target - cur) * k;
    const settled = Math.abs(target - next) < 0.001;
    if (settled) next = target;
    posRef.current = next;

    const els = itemRefs.current;
    const n = items.length;
    const rowH = fontSize * spacing * 16;
    const tiltRad = (tilt * Math.PI) / 180;
    const R = tiltRad > 0.0005 ? rowH / tiltRad : 0;

    for (let i = 0; i < n; i++) {
      const el = els[i];
      if (!el) continue;
      const d = i - next;
      const dist = Math.abs(d);
      let x = 0;
      let y = d * rowH;
      let rot = 0;
      if (R > 0) {
        const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad));
        y = R * Math.sin(ang);
        x = -R * (1 - Math.cos(ang)) * curve;
        rot = (ang * 180) / Math.PI;
      }
      el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`;
      el.style.opacity = String(Math.max(minOpacity, 1 - dist * fade));
      if (blur > 0) {
        el.style.filter = dist > 0.1 ? `blur(${(dist * blur).toFixed(2)}px)` : "none";
      }
    }

    rafRef.current = settled ? null : requestAnimationFrame(runFrame);
  }, [items.length, fontSize, spacing, smoothing, curve, tilt, blur, fade, minOpacity]);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
    }
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const applyTarget = useCallback(
    (value, snap) => {
      let v = Math.min(Math.max(value, 0), Math.max(items.length - 1, 0));
      if (snap) v = Math.round(v);
      targetRef.current = v;
      const idx = Math.min(Math.max(Math.round(v), 0), items.length - 1);
      if (idx !== selectedRef.current) {
        selectedRef.current = idx;
        setSelectedIndex(idx);
        onChangeRef.current?.(idx, items[idx]);
      }
      startLoop();
    },
    [items, startLoop]
  );

  const handleItemClick = (index) => {
    selectedRef.current = index;
    setSelectedIndex(index);
    applyTarget(index, true);
    onChangeRef.current?.(index, items[index]);
  };

  useEffect(() => {
    applyTarget(defaultSelected, true);
  }, [defaultSelected, applyTarget]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label="Documentation section navigation"
      className={`relative h-full w-full select-none overflow-hidden outline-none ${className}`}
      style={{ minHeight: "300px", position: "relative" }}
    >
      {items.map((label, index) => {
        const isSelected = selectedIndex === index;
        return (
          <div
            key={`${label}-${index}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="option"
            aria-selected={isSelected}
            onClick={() => handleItemClick(index)}
            style={{
              position: "absolute",
              top: "50%",
              left: "0px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: `${fontSize}rem`,
              fontWeight: isSelected ? 600 : 400,
              color: isSelected ? activeColor : textColor,
              transition: "color 150ms ease, background 150ms ease",
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              background: isSelected ? "var(--bg-surface)" : "transparent",
              border: isSelected ? "1px solid var(--border-default)" : "1px solid transparent",
              boxShadow: isSelected ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
