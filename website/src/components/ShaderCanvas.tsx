import { useEffect, useRef } from "react";

const VS = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FS = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

float sceneSDF(vec3 p) {
  float t = u_time * 0.3;
  vec3 c1 = vec3(sin(t) * 1.2, cos(t * 0.7) * 1.2, sin(t * 0.5) * 0.5);
  vec3 c2 = vec3(cos(t * 1.1) * 1.0, sin(t * 0.9) * 1.0, cos(t * 0.4) * 0.6);
  vec3 c3 = vec3(sin(t * 0.8 + 1.0) * 1.3, cos(t * 1.2) * 0.8, sin(t) * 0.4);
  float r1 = 0.6 + 0.15 * sin(t * 2.0);
  float r2 = 0.5 + 0.1 * cos(t * 1.5);
  float r3 = 0.55 + 0.12 * sin(t * 2.2);
  float d1 = sdSphere(p - c1, r1);
  float d2 = sdSphere(p - c2, r2);
  float d3 = sdSphere(p - c3, r3);
  float k = 0.4;
  return smin(smin(d1, d2, k), d3, k);
}

vec3 calcNormal(vec3 p) {
  float e = 0.001;
  return normalize(vec3(
    sceneSDF(p + vec3(e, 0, 0)) - sceneSDF(p - vec3(e, 0, 0)),
    sceneSDF(p + vec3(0, e, 0)) - sceneSDF(p - vec3(0, e, 0)),
    sceneSDF(p + vec3(0, 0, e)) - sceneSDF(p - vec3(0, 0, e))
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  vec3 ro = vec3(0, 0, 3.5);
  vec3 rd = normalize(vec3(uv, -1.2));
  float t = 0.0;
  vec3 p;
  for (int i = 0; i < 64; i++) {
    p = ro + rd * t;
    float d = sceneSDF(p);
    if (d < 0.001) break;
    t += d * 0.7;
    if (t > 20.0) break;
  }
  vec3 col = vec3(0.02, 0.03, 0.06);
  if (t < 20.0) {
    vec3 n = calcNormal(p);
    vec3 light = normalize(vec3(2, 1, 2));
    float diff = max(dot(n, light), 0.0);
    vec3 albedo = vec3(0.0, 0.83, 0.67) * 0.55 + vec3(0.55, 0.35, 1.0) * 0.45;
    col = albedo * (0.28 + 0.72 * diff);
    col += vec3(0.12, 0.18, 0.35) * pow(max(dot(reflect(rd, n), light), 0.0), 10.0);
  }
  float vignette = 1.0 - 0.45 * dot(uv, uv);
  col *= vignette;
  gl_FragColor = vec4(col, 1.0);
}
`;

function createProgram(
  gl: WebGLRenderingContext,
  vsSrc: string,
  fsSrc: string
) {
  const v = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(v, vsSrc);
  gl.compileShader(v);
  const f = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(f, fsSrc);
  gl.compileShader(f);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return p;
}

export function ShaderCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const program = createProgram(gl, VS, FS);
    const positionLoc = gl.getAttribLocation(program, "a_position");
    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const timeLoc = gl.getUniformLocation(program, "u_time");

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const render = () => {
      resize();
      const t = (performance.now() - start) * 0.001;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };

    resize();
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="shader-canvas" aria-hidden />;
}
