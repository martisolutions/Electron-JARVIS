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
  private readonly orbitGroups: THREE.Group[] = [];
  private readonly orbitMaterials: THREE.PointsMaterial[] = [];
  private readonly satelliteGroup: THREE.Group;
  private readonly satellites: Array<{
    mesh: THREE.Mesh;
    beam: THREE.Line;
    beamMaterial: THREE.LineBasicMaterial;
    meshMaterial: THREE.MeshBasicMaterial;
    angle: number;
    speed: number;
  }> = [];
  private activityMode: "idle" | "thinking" | "acting" | "speaking" = "idle";

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

    this.satelliteGroup = new THREE.Group();
    this.scene.add(this.satelliteGroup);

    const orbitSpecs = [
      { radius: 1.28, count: 120, tiltX: 0.42, tiltZ: 0.08, size: 0.014 },
      { radius: 1.58, count: 150, tiltX: -0.55, tiltZ: 0.3, size: 0.012 },
      { radius: 1.9, count: 180, tiltX: 0.82, tiltZ: -0.18, size: 0.01 },
    ];
    for (const spec of orbitSpecs) {
      const positions = new Float32Array(spec.count * 3);
      for (let i = 0; i < spec.count; i += 1) {
        const angle = (i / spec.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
        const radius = spec.radius + (Math.random() - 0.5) * 0.06;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.035;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0x6fe6ff,
        size: spec.size,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      const group = new THREE.Group();
      group.rotation.x = spec.tiltX;
      group.rotation.z = spec.tiltZ;
      group.add(points);
      this.scene.add(group);
      this.orbitGroups.push(group);
      this.orbitMaterials.push(material);
    }
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

  setActivityMode(mode: "idle" | "thinking" | "acting" | "speaking"): void {
    this.activityMode = mode;
  }

  setSatellites(agents: Array<{ id?: string; name?: string }>): void {
    for (const satellite of this.satellites) {
      satellite.mesh.geometry.dispose();
      satellite.meshMaterial.dispose();
      satellite.beam.geometry.dispose();
      satellite.beamMaterial.dispose();
    }
    this.satelliteGroup.clear();
    this.satellites.length = 0;

    const unique = agents.filter((agent, index) => agents.findIndex((item) => item.id === agent.id) === index).slice(0, 4);
    unique.forEach((_agent, index) => {
      const meshMaterial = new THREE.MeshBasicMaterial({
        color: this.colorA,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), meshMaterial);
      mesh.frustumCulled = false;

      const beamMaterial = new THREE.LineBasicMaterial({
        color: this.colorA,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beamGeometry = new THREE.BufferGeometry();
      beamGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const beam = new THREE.Line(beamGeometry, beamMaterial);
      beam.frustumCulled = false;

      this.satelliteGroup.add(mesh, beam);
      this.satellites.push({
        mesh,
        beam,
        beamMaterial,
        meshMaterial,
        angle: (index / Math.max(1, unique.length)) * Math.PI * 2,
        speed: 0.08 + index * 0.025,
      });
    });
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
    const disposeGroup = (group: THREE.Group): void => {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      this.scene.remove(group);
    };
    this.orbitGroups.forEach(disposeGroup);
    this.orbitGroups.length = 0;
    this.orbitMaterials.length = 0;
    disposeGroup(this.satelliteGroup);
    this.satellites.length = 0;
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
    const orbitSpeed =
      this.activityMode === "acting" ? 2.4 : this.activityMode === "speaking" ? 1.8 : this.activityMode === "thinking" ? 1 : 0.5;
    this.orbitGroups.forEach((group, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      group.rotation.y += delta * (0.035 + index * 0.012) * direction * orbitSpeed;
      group.rotation.x += Math.sin(t * 0.16 + index) * delta * 0.012 * orbitSpeed;
      group.rotation.z += Math.cos(t * 0.12 + index) * delta * 0.009 * orbitSpeed;
      group.scale.setScalar(1 + Math.sin(t * 0.8 + index) * 0.018 * orbitSpeed);
    });
    this.orbitMaterials.forEach((material) => {
      material.color.copy(this.colorA);
      material.opacity = 0.5 + this.level * 0.25;
    });

    for (const satellite of this.satellites) {
      satellite.angle += delta * satellite.speed * orbitSpeed;
      const radius = 2.05;
      const x = Math.cos(satellite.angle) * radius;
      const y = Math.sin(satellite.angle * 1.7) * 0.3;
      const z = Math.sin(satellite.angle) * radius;
      satellite.mesh.position.set(x, y, z);
      satellite.meshMaterial.color.copy(this.colorA).lerp(this.colorC, 0.4);
      satellite.mesh.scale.setScalar(1 + Math.sin(t * 4 + satellite.angle) * 0.16);
      const beamPositions = satellite.beam.geometry.getAttribute("position") as THREE.BufferAttribute;
      beamPositions.setXYZ(0, 0, 0, 0);
      beamPositions.setXYZ(1, x, y, z);
      beamPositions.needsUpdate = true;
      satellite.beamMaterial.color.copy(this.colorA);
      satellite.beamMaterial.opacity = 0.18 + (Math.sin(t * 5 + satellite.angle) + 1) * 0.12;
    }
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
