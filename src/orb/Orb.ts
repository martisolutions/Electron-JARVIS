import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Levels } from "../lib/audio";
import type { OrbState } from "../types";
import { haloFragment, haloVertex, nucleusFragment, nucleusVertex, particleFragment, particleVertex } from "./shaders";

type OrbOptions = {
  levels: () => Levels;
  reducedMotion?: boolean;
  onZoom?: (zoom: number) => void;
};

type StatePalette = { a: number; b: number; c: number };

const PALETTES: Record<OrbState, StatePalette> = {
  idle: { a: 0x36e2ff, b: 0x6a5bff, c: 0xeaffff },
  connecting: { a: 0x2a86a8, b: 0x394a86, c: 0xc6f2ff },
  listening: { a: 0x7cf7ff, b: 0x3d7bff, c: 0xffffff },
  thinking: { a: 0xb28cff, b: 0xff5ce1, c: 0xffefff },
  speaking: { a: 0x40e7ff, b: 0x9a6bff, c: 0xfff1c9 },
  error: { a: 0xff5b6e, b: 0xff2d55, c: 0xffd0d6 },
};

export class Orb {
  private readonly container: HTMLElement;
  private readonly levels: () => Levels;
  private readonly reducedMotion: boolean;
  private readonly onZoom?: (zoom: number) => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  private readonly points: THREE.Points;
  private readonly particleMaterial: THREE.ShaderMaterial;
  private readonly nucleus: THREE.Mesh;
  private readonly nucleusMaterial: THREE.ShaderMaterial;
  private readonly halo: THREE.Mesh;
  private readonly haloMaterial: THREE.ShaderMaterial;
  private readonly networkGroup: THREE.Group;
  private readonly networkMaterial: THREE.LineBasicMaterial;
  private readonly networkPointMaterial: THREE.PointsMaterial;

  private readonly colorA = new THREE.Color(PALETTES.idle.a);
  private readonly colorB = new THREE.Color(PALETTES.idle.b);
  private readonly colorC = new THREE.Color(PALETTES.idle.c);
  private readonly targetA = new THREE.Color(PALETTES.idle.a);
  private readonly targetB = new THREE.Color(PALETTES.idle.b);
  private readonly targetC = new THREE.Color(PALETTES.idle.c);

  private state: OrbState = "idle";
  private level = 0;
  private speak = 0;
  private thinking = 0;
  private bass = 0;
  private treble = 0;

  private pointerX = 0;
  private pointerY = 0;
  private frame = 0;
  private clock = 0;
  private lastTime = 0;
  private zoom = 4.5;
  private targetZoom = 4.5;
  private running = true;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, options: OrbOptions) {
    this.container = container;
    this.levels = options.levels;
    this.reducedMotion = options.reducedMotion ?? false;
    this.onZoom = options.onZoom;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: dpr < 2,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "orb-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 4.5);
    this.camera.lookAt(0, 0, 0);

    const isSmall = width < 640;
    const baseSize = isSmall ? 0.038 : 0.027;

    const particleCount = this.resolveParticleCount(width);
    const { positions, seeds } = buildSphere(particleCount, isSmall);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uBass: { value: 0 },
        uSpeak: { value: 0 },
        uThinking: { value: 0 },
        uSize: { value: baseSize },
        uPixelRatio: { value: dpr },
        uColorA: { value: this.colorA },
        uColorB: { value: this.colorB },
        uColorC: { value: this.colorC },
        uTreble: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.particleMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.nucleusMaterial = new THREE.ShaderMaterial({
      vertexShader: nucleusVertex,
      fragmentShader: nucleusFragment,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uColor: { value: this.colorA },
        uColorHot: { value: this.colorC },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.nucleus = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), this.nucleusMaterial);
    this.nucleus.position.set(0, 0, -0.05);
    this.scene.add(this.nucleus);

    this.haloMaterial = new THREE.ShaderMaterial({
      vertexShader: haloVertex,
      fragmentShader: haloFragment,
      uniforms: {
        uColor: { value: this.colorB },
        uLevel: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), this.haloMaterial);
    this.halo.position.set(0, 0, -1.4);
    this.scene.add(this.halo);

    const network = buildNetwork();
    const networkGeometry = new THREE.BufferGeometry();
    networkGeometry.setAttribute("position", new THREE.BufferAttribute(network.positions, 3));
    this.networkMaterial = new THREE.LineBasicMaterial({
      color: 0x55dfff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const networkLines = new THREE.LineSegments(networkGeometry, this.networkMaterial);
    networkLines.frustumCulled = false;

    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(network.nodePositions, 3));
    this.networkPointMaterial = new THREE.PointsMaterial({
      color: 0x9ff7ff,
      size: 0.018,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const networkNodes = new THREE.Points(nodeGeometry, this.networkPointMaterial);
    networkNodes.frustumCulled = false;

    this.networkGroup = new THREE.Group();
    this.networkGroup.add(networkLines, networkNodes);
    this.scene.add(this.networkGroup);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.45, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    window.addEventListener("pointermove", this.handlePointer, { passive: true });
    this.container.addEventListener("wheel", this.handleWheel, { passive: false });
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  setState(state: OrbState): void {
    if (this.state === state) return;
    this.state = state;
    const palette = PALETTES[state];
    this.targetA.setHex(palette.a);
    this.targetB.setHex(palette.b);
    this.targetC.setHex(palette.c);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("pointermove", this.handlePointer);
    this.container.removeEventListener("wheel", this.handleWheel);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.points.geometry.dispose();
    this.particleMaterial.dispose();
    this.nucleus.geometry.dispose();
    this.nucleusMaterial.dispose();
    this.halo.geometry.dispose();
    this.haloMaterial.dispose();
    this.networkGroup.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  zoomBy(delta: number): void {
    this.targetZoom = Math.min(6.2, Math.max(2.2, this.targetZoom + delta));
    this.onZoom?.(this.targetZoom);
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomBy(event.deltaY * 0.0018);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.particleMaterial.uniforms.uPixelRatio.value = dpr;
    this.particleMaterial.uniforms.uSize.value = width < 640 ? 0.038 : 0.027;
  }

  private resolveParticleCount(width: number): number {
    if (this.reducedMotion) return 14_000;
    if (width < 640) return 20_000;
    const cores = navigator.hardwareConcurrency || 6;
    return cores >= 8 ? 52_000 : 34_000;
  }

  private loop(now: number): void {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);

    const delta = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += delta;
    const t = this.clock;
    const speed = this.reducedMotion ? 0.35 : 1;

    const audio = this.levels();
    const speaking = this.state === "speaking";
    const thinking = this.state === "thinking";
    const listening = this.state === "listening";

    const targetLevel = speaking
      ? Math.min(0.82, audio.level * 0.92)
      : thinking
        ? 0.1 + 0.05 * Math.sin(t * 3.6)
        : listening
          ? 0.05 + Math.min(0.5, audio.level * 0.9)
          : this.state === "error"
            ? 0.12 + 0.04 * Math.sin(t * 9)
            : 0.03;

    this.level += (targetLevel - this.level) * Math.min(1, delta * 9);
    this.speak += ((speaking ? 1 : 0) - this.speak) * Math.min(1, delta * 6);
    this.thinking += ((thinking ? 1 : 0) - this.thinking) * Math.min(1, delta * 4);
    this.bass += (((speaking || listening) ? audio.bass : 0) - this.bass) * Math.min(1, delta * 10);
    this.treble += (((speaking || listening) ? audio.treble : 0) - this.treble) * Math.min(1, delta * 8);

    this.colorA.lerp(this.targetA, Math.min(1, delta * 3.2));
    this.colorB.lerp(this.targetB, Math.min(1, delta * 3.2));
    this.colorC.lerp(this.targetC, Math.min(1, delta * 3.2));

    const uniforms = this.particleMaterial.uniforms;
    uniforms.uTime.value = t * speed;
    uniforms.uLevel.value = this.level;
    uniforms.uBass.value = this.bass;
    uniforms.uSpeak.value = this.speak;
    uniforms.uThinking.value = this.thinking;
    uniforms.uTreble.value = this.treble;

    this.nucleusMaterial.uniforms.uTime.value = t * speed;
    this.nucleusMaterial.uniforms.uLevel.value = this.level;

    this.haloMaterial.uniforms.uTime.value = t * speed;
    this.haloMaterial.uniforms.uLevel.value = this.level;

    this.nucleus.scale.setScalar(1 + this.level * 0.12 + Math.sin(t * 1.6) * 0.02);
    this.halo.scale.setScalar(1 + this.level * 0.14);

    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, delta * 4.5);
    this.camera.position.z = this.zoom;
    this.networkGroup.rotation.y = t * 0.035 * speed;
    this.networkGroup.rotation.x = Math.sin(t * 0.08) * 0.16;
    this.networkGroup.rotation.z = Math.cos(t * 0.06) * 0.08;
    this.networkMaterial.color.copy(this.colorA).lerp(this.colorC, 0.24);
    this.networkMaterial.opacity = 0.12 + this.level * 0.12;

    this.points.rotation.y += delta * (0.06 + this.level * 0.12) * speed;
    this.points.rotation.x = Math.sin(t * 0.12) * 0.12;
    this.points.rotation.z = Math.cos(t * 0.09) * 0.05;

    const px = this.pointerX * 0.22;
    const py = -this.pointerY * 0.14;
    this.camera.position.x += (px - this.camera.position.x) * Math.min(1, delta * 2.6);
    this.camera.position.y += (py - this.camera.position.y) * Math.min(1, delta * 2.6);
    this.camera.lookAt(0, 0, 0);

    this.bloom.strength = 0.48 + this.level * 0.28 + this.speak * 0.05;

    this.composer.render();
  }
}

function buildSphere(count: number, small: boolean): { positions: Float32Array; seeds: Float32Array } {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const innerRatio = small ? 0.24 : 0.18;

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const inner = i < count * innerRatio;
    const r = inner ? 0.34 + Math.random() * 0.36 : 0.92 + Math.random() * 0.22;

    positions[i * 3] = Math.cos(theta) * radius * r;
    positions[i * 3 + 1] = y * r;
    positions[i * 3 + 2] = Math.sin(theta) * radius * r;
    seeds[i] = Math.random();
  }

  return { positions, seeds };
}

function buildNetwork(): { positions: Float32Array; nodePositions: Float32Array } {
  const count = 64;
  const nodes: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const r = 1.22 + Math.random() * 0.24;
    nodes.push([Math.cos(theta) * radius * r, y * r, Math.sin(theta) * radius * r]);
  }

  const segments: number[] = [];
  const push = (from: [number, number, number], to: [number, number, number]): void => {
    segments.push(from[0], from[1], from[2], to[0], to[1], to[2]);
  };

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const dx = nodes[i][0] - nodes[j][0];
      const dy = nodes[i][1] - nodes[j][1];
      const dz = nodes[i][2] - nodes[j][2];
      if (dx * dx + dy * dy + dz * dz < 0.82) push(nodes[i], nodes[j]);
    }
  }

  return {
    positions: new Float32Array(segments),
    nodePositions: new Float32Array(nodes.flatMap((node) => node)),
  };
}