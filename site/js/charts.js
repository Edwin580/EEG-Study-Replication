// Small SVG drawing helpers. Colours come from CSS classes so that light and
// dark mode both work without redrawing.

const NS = "http://www.w3.org/2000/svg";

export function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

export function scale(d0, d1, r0, r1) {
  const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
  return f;
}

export function linePath(xs, ys, x, y) {
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`;
  return d;
}

export function bandPath(xs, lo, hi, x, y) {
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(hi[i]).toFixed(1)}`;
  for (let i = xs.length - 1; i >= 0; i--) d += `L${x(xs[i]).toFixed(1)},${y(lo[i]).toFixed(1)}`;
  return d + "Z";
}

/** Fresh SVG sized to the container's current width. */
export function svgFor(container, height, label) {
  container.replaceChildren();
  const width = Math.max(240, Math.floor(container.clientWidth));
  const svg = el("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label,
  }, container);
  return { svg, width, height };
}

/** Redraw on container resize. */
export function responsive(container, draw) {
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(container.clientWidth);
    if (w !== last) { last = w; draw(); }
  });
  ro.observe(container);
  return draw;
}

export function ticks(d0, d1, step) {
  const out = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
