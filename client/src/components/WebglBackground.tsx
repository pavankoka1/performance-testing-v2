"use client";

import { useLayoutEffect, useRef } from "react";

type Props = {
  /** When false, component renders nothing (e.g. recording / processing). */
  active: boolean;
};

const VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * “Perf timeline” motif: sin(k·x − ω·t) traveling left → right, with damping:
 * spatial falloff in x + smooth amplitude modulation in time. Grid, playhead, histogram.
 */
const FRAG = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
out vec4 fragColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 uv = frag / res;
  float aspect = res.x / res.y;
  vec2 p = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);

  float t = u_time;
  float scroll = t * 0.24;
  float x = p.x * 3.9;
  float px = x + scroll;

  vec3 base = vec3(0.03, 0.028, 0.052);

  vec2 gq = p * vec2(10.0, 7.5) + vec2(scroll * 0.45, 0.0);
  vec2 gf = fract(gq);
  float grid = 0.0;
  grid += smoothstep(0.038, 0.02, min(gf.x, 1.0 - gf.x)) * 0.17;
  grid += smoothstep(0.038, 0.02, min(gf.y, 1.0 - gf.y)) * 0.13;
  vec2 gq2 = p * vec2(21.0, 16.0) + vec2(scroll * 0.2, scroll * 0.08);
  vec2 gf2 = fract(gq2);
  float g2x = smoothstep(0.022, 0.01, min(gf2.x, 1.0 - gf2.x));
  float g2y = smoothstep(0.022, 0.01, min(gf2.y, 1.0 - gf2.y));
  float grid2 = max(g2x, g2y) * 0.07;
  vec3 gridCol = vec3(0.32, 0.26, 0.48) * grid + vec3(0.24, 0.2, 0.38) * grid2;

  float k = 5.4;
  float omega = 1.95;
  float phase = k * x - omega * t;
  float amp0 = 0.22;
  float spatialDamp = exp(-0.055 * x * x);
  float timeDamp = 0.48 + 0.52 * cos(t * 1.02);
  float envelope = spatialDamp * mix(0.38, 1.0, timeDamp);
  float wy1 = 0.3 + amp0 * envelope * sin(phase);
  float wy2 = -0.3 + amp0 * envelope * sin(phase);

  float tr1 = smoothstep(0.019, 0.0, abs(p.y - wy1));
  float tr2 = smoothstep(0.019, 0.0, abs(p.y - wy2));
  float gl1 = smoothstep(0.05, 0.0, abs(p.y - wy1));
  float gl2 = smoothstep(0.05, 0.0, abs(p.y - wy2));

  vec3 cTeal = vec3(0.2, 0.78, 0.62);
  vec3 cAmber = vec3(0.95, 0.62, 0.28);

  vec3 col = base + gridCol;
  col += tr1 * cTeal * 0.48;
  col += tr2 * cAmber * 0.48;
  col += gl1 * cTeal * 0.1;
  col += gl2 * cAmber * 0.1;

  float colIdx = floor((p.x + aspect) * 16.0 + scroll * 2.2);
  float barH = hash21(vec2(colIdx, 19.0)) * 0.2 + 0.035;
  float barBase = -0.94;
  float cx = fract((p.x + aspect) * 16.0 + scroll * 2.2);
  float barMask = smoothstep(0.0, 0.1, cx) * smoothstep(1.0, 0.9, cx);
  float inBar = step(barBase, p.y) * step(p.y, barBase + barH) * barMask;
  float hot = step(0.84, hash21(vec2(colIdx, 99.0)));
  vec3 barCol = mix(cAmber * 0.65, cTeal * 0.72, hash21(vec2(colIdx, 3.0)));
  col += inBar * barCol * (0.48 + hot * 0.22);

  float phx = fract(t * 0.065) * 2.0 * aspect - aspect;
  float play = smoothstep(0.014, 0.0, abs(p.x - phx));
  float playGlow = smoothstep(0.07, 0.0, abs(p.x - phx));
  float playPulse = 0.82 + 0.18 * sin(t * 1.2);
  col += play * vec3(0.82, 0.78, 1.0) * (0.36 * playPulse);
  col += playGlow * vec3(0.45, 0.38, 0.65) * 0.08;

  float dist = length(p);
  float maxR = length(vec2(aspect, 1.0));
  float rim = smoothstep(0.26, 0.92, dist);
  rim *= 1.0 - smoothstep(maxR * 0.82, maxR * 1.02, dist);
  rim = pow(clamp(rim, 0.0, 1.0), 0.88);

  float activity = tr1 + tr2 + (grid + grid2) * 0.45 + play * 0.45 + inBar;
  float baseAlpha = 0.26 + 0.14 * clamp(activity, 0.0, 1.0);
  float dull = 0.8;
  vec3 outRgb = col * rim * dull;
  float alpha = baseAlpha * rim * dull;
  fragColor = vec4(outRgb, alpha);
}
`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[WebglBackground] shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string
): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[WebglBackground] program:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * GPU-driven WebGL2 fullscreen shader (no Canvas2D). Unmount when `active` is false
 * so the GPU loop stops during PerfTrace sessions.
 */
export default function WebglBackground({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!active) {
      return;
    }

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "default",
    });
    if (!gl) {
      console.warn("[WebglBackground] WebGL2 not available.");
      return;
    }

    const reduced =
      typeof globalThis.window !== "undefined" &&
      globalThis.window.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches;

    const prog = createProgram(gl, VERT, FRAG);
    if (!prog) {
      console.warn("[WebglBackground] Shader program failed to link.");
      return;
    }

    const posLoc = gl.getAttribLocation(prog, "a_position");
    if (posLoc < 0) {
      console.warn("[WebglBackground] Missing vertex attribute a_position.");
      gl.deleteProgram(prog);
      return;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");

    let raf = 0;
    let start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (t: number) => {
      const timeSec = (t - start) / 1000;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uTime, reduced ? 0.0 : timeSec);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    resize();
    window.addEventListener("resize", resize);

    const loop = (t: number) => {
      if (document.hidden) {
        raf = requestAnimationFrame(loop);
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
      style={{
        opacity: active ? 1 : 0,
        visibility: active ? "visible" : "hidden",
      }}
      aria-hidden
    />
  );
}
