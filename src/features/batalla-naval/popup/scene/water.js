// Agua low poly: plano subdividido cuyo vertex shader desplaza la altura con
// el oleaje de layout.js (WAVES_GLSL, el mismo que siguen los objetos que
// flotan). El fragment shader usa normales por derivadas (caras facetadas) y
// suma: color segun la altura (valles oscuros, crestas claras), espuma en las
// crestas, destellos del sol que se mueven con las olas y vetas de corriente.

import { Mesh, PlaneGeometry, ShaderMaterial, Color, Vector3 } from 'three';
import { WATER_Y, WAVES_GLSL, WAVES, TIDE } from './layout.js';

// Altura maxima posible (para normalizar el color).
const MAX_H = WAVES.reduce((a, w) => a + w.amp, TIDE.amp);

const VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  ${WAVES_GLSL}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += swell(world.xz, uTime);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uLightDir;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float h = clamp(vWorld.y / ${(MAX_H * 2).toFixed(4)} + 0.5, 0.0, 1.0);

    vec3 col = mix(uDeep, uShallow, smoothstep(0.15, 0.95, h));
    col *= 0.55 + 0.6 * diff;

    // Vetas de corriente: bandas lentas que cruzan el mar (dan sensacion de marea).
    float streak = sin(vWorld.x * 0.9 + vWorld.z * 0.35 + uTime * 0.6)
                 * sin(vWorld.z * 1.3 - uTime * 0.45 + vWorld.x * 0.2);
    col += vec3(0.05, 0.08, 0.1) * smoothstep(0.55, 1.0, streak);

    // Espuma en las crestas (con un borde que "respira").
    float foam = smoothstep(0.84 + 0.04 * sin(uTime * 2.0 + vWorld.x), 1.0, h);
    col = mix(col, uFoam, foam * 0.35);

    // Destello del sol sobre las caras que miran hacia la camara.
    float spec = pow(max(dot(reflect(-L, n), V), 0.0), 28.0);
    col += vec3(1.0, 0.96, 0.85) * spec * 0.55;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createWater() {
  // Mas grande que el tablero para que el borde nunca se vea. Caras de ~0.6
  // casillas: se nota el facetado y las olas cortas se leen bien.
  const geo = new PlaneGeometry(48, 48, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new Color('#0a3d63') },
      uShallow: { value: new Color('#2a9ccc') },
      uFoam: { value: new Color('#e6f6ff') },
      uLightDir: { value: new Vector3(0.45, 0.9, 0.35) },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.renderOrder = -1;
  return {
    mesh,
    update(t) { mat.uniforms.uTime.value = t; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
