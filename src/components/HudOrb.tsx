import { useEffect, useRef } from "react";
import * as THREE from "three";

type Mode = "idle" | "thinking" | "talking" | "delegated";

type SatelliteInfo = {
  id: string;
  name: string;
  summary: string;
};

type Props = {
  load: number;
  mode: Mode;
  visual: { color: string; expansion: number };
  level: () => number;
  satellites: SatelliteInfo[];
  delegationPulse: number;
  onZoom?: (zoom: number) => void;
};

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.25, "#ffc15a");
    gradient.addColorStop(1, "rgba(255,120,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function makeLabelTexture(name: string, summary: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 22px monospace";
    context.fillStyle = "rgba(255, 225, 166, 0.96)";
    context.fillText(name.slice(0, 24).toUpperCase(), 16, 30);
    context.font = "400 19px monospace";
    context.fillStyle = "rgba(255, 190, 105, 0.82)";
    context.fillText(summary.slice(0, 54), 16, 63);
    if (summary.length > 54) context.fillText(summary.slice(54, 108), 16, 90);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function HudOrb({ load, mode, visual, level, satellites, delegationPulse, onZoom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadRef = useRef(load);
  const modeRef = useRef(mode);
  const satellitesRef = useRef(satellites);
  const visualRef = useRef(visual);
  const levelRef = useRef(level);
  const pulseRef = useRef(delegationPulse);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    satellitesRef.current = satellites;
  }, [satellites]);
  useEffect(() => {
    visualRef.current = visual;
  }, [visual]);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(() => {
    pulseRef.current = delegationPulse;
  }, [delegationPulse]);

  useEffect(() => {
    const wrap = canvasRef.current?.parentElement;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const orb = new THREE.Group();
    scene.add(orb);

    const glowTexture = makeGlowTexture();
    const additive = THREE.AdditiveBlending;
    const activeColor = new THREE.Color(visualRef.current.color);
    const coloredMaterials: THREE.Material[] = [];
    const randomDirection = (): THREE.Vector3 => {
      const vector = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      return vector.length() < 0.01 ? randomDirection() : vector.normalize();
    };

    const cloudCount = 2600;
    const cloudPositions = new Float32Array(cloudCount * 3);
    const cloudColors = new Float32Array(cloudCount * 3);

    for (let index = 0; index < cloudCount; index += 1) {
      const radius = index % 4 ? 2.1 + Math.random() * 0.5 : 0.55 + Math.random() * 1.5;
      const vector = randomDirection().multiplyScalar(radius);
      cloudPositions.set([vector.x, vector.y, vector.z], index * 3);
      const shade = 0.45 + Math.random() * 0.55;
      cloudColors.set([shade, shade, shade], index * 3);
    }
    const cloudGeometry = new THREE.BufferGeometry();
    cloudGeometry.setAttribute("position", new THREE.BufferAttribute(cloudPositions, 3));
    cloudGeometry.setAttribute("color", new THREE.BufferAttribute(cloudColors, 3));
    const cloud = new THREE.Points(
      cloudGeometry,
      new THREE.PointsMaterial({
        size: 0.075,
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: additive,
        vertexColors: true,
        color: activeColor,
      }),
    );
    coloredMaterials.push(cloud.material as THREE.Material);
    orb.add(cloud);

    const streakCount = 520;
    const streakPositions = new Float32Array(streakCount * 6);
    for (let index = 0; index < streakCount; index += 1) {
      const start = randomDirection().multiplyScalar(index % 3 ? 2.4 : 0.9 + Math.random() * 1.4);
      const direction = new THREE.Vector3().crossVectors(start, randomDirection()).normalize().multiplyScalar(0.08 + Math.random() * 0.32);
      start.toArray(streakPositions, index * 6);
      start.add(direction).toArray(streakPositions, index * 6 + 3);
    }
    const streakGeometry = new THREE.BufferGeometry();
    streakGeometry.setAttribute("position", new THREE.BufferAttribute(streakPositions, 3));
    const streaks = new THREE.LineSegments(
      streakGeometry,
      new THREE.LineBasicMaterial({ color: 0xffa826, transparent: true, opacity: 0.7, blending: additive, depthWrite: false }),
    );
    coloredMaterials.push(streaks.material as THREE.Material);
    orb.add(streaks);

    const rings: Array<{ group: THREE.Group; speed: number; dot: THREE.Sprite; radius: number; angle: number }> = [];
    const makeRing = (radius: number, rx: number, rz: number, speed: number, dash: number, color: number, thick: boolean): void => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 200; index += 1) {
        const angle = (index / 200) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
      }
      const group = new THREE.Group();
      group.rotation.set(rx, 0, rz);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color,
          dashSize: dash,
          gapSize: dash * 0.6,
          transparent: true,
          opacity: 0.85,
          blending: additive,
          depthWrite: false,
        }),
      );
      line.computeLineDistances();
      coloredMaterials.push(line.material as THREE.Material);
      group.add(line);
      if (thick) {
        const torus = new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.012, 8, 220),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: additive }),
        );
        coloredMaterials.push(torus.material as THREE.Material);
        group.add(torus);
      }
      const dot = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture, blending: additive, transparent: true, depthWrite: false }),
      );
      dot.scale.setScalar(0.38);
      coloredMaterials.push(dot.material as THREE.Material);
      group.add(dot);
      orb.add(group);
      rings.push({ group, speed, dot, radius, angle: Math.random() * 6.28 });
    };
    makeRing(3, 1.2, 0.3, 0.25, 0.25, 0xffa826, true);
    makeRing(2.75, 0.4, -0.9, -0.35, 0.12, 0xffd27a, false);
    makeRing(2.2, 1.8, 0.6, 0.5, 0.4, 0xff9a1f, true);
    makeRing(1.7, 0.2, 1.2, -0.7, 0.08, 0xffc15a, false);
    makeRing(3.25, 0.9, -0.5, 0.15, 0.6, 0xff7a00, false);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, wireframe: true, transparent: true, opacity: 0.9, blending: additive }),
    );
    coloredMaterials.push(core.material as THREE.Material);
    orb.add(core);
    const glow = (spec: [number, number]): THREE.Sprite => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture, blending: additive, transparent: true, depthWrite: false, opacity: spec[1] }),
      );
      sprite.scale.setScalar(spec[0]);
      coloredMaterials.push(sprite.material as THREE.Material);
      orb.add(sprite);
      return sprite;
    };
    const glowA = glow([2.4, 0.95]);
    const glowB = glow([9, 0.22]);

    const satelliteGroup = new THREE.Group();
    scene.add(satelliteGroup);
    let satelliteEntries: Array<{
      mesh: THREE.Mesh;
      beam: THREE.Line;
      beamMaterial: THREE.LineBasicMaterial;
      meshMaterial: THREE.MeshBasicMaterial;
      label: THREE.Sprite;
      labelMaterial: THREE.SpriteMaterial;
      labelTexture: THREE.CanvasTexture;
      angle: number;
      speed: number;
    }> = [];

    const syncSatellites = (): void => {
      for (const entry of satelliteEntries) {
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
        entry.beam.geometry.dispose();
        entry.beamMaterial.dispose();
        entry.labelMaterial.map?.dispose();
        entry.labelMaterial.dispose();
        entry.labelTexture.dispose();
      }
      satelliteGroup.clear();
      satelliteEntries = [];
      satellitesRef.current.slice(0, 4).forEach((agent, index, list) => {
        const beamMaterial = new THREE.LineBasicMaterial({
          color: 0xffa826,
          transparent: true,
          opacity: 0.3,
          blending: additive,
          depthWrite: false,
        });
        const beamGeometry = new THREE.BufferGeometry();
        beamGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        const beam = new THREE.Line(beamGeometry, beamMaterial);
        const meshMaterial = new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          blending: additive,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), meshMaterial);
        const labelTexture = makeLabelTexture(agent.name, agent.summary);
        const labelMaterial = new THREE.SpriteMaterial({
          map: labelTexture,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        });
        const label = new THREE.Sprite(labelMaterial);
        label.scale.set(1.45, 0.36, 1);
        satelliteGroup.add(mesh, beam, label);
        satelliteEntries.push({
          mesh,
          beam,
          beamMaterial,
          meshMaterial,
          label,
          labelMaterial,
          labelTexture,
          angle: (index / Math.max(1, list.length)) * Math.PI * 2,
          speed: 0.12 + index * 0.04,
        });
      });
    };
    syncSatellites();
    const burstBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a1f,
      transparent: true,
      opacity: 0,
      blending: additive,
      depthWrite: false,
    });
    const burstBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.26, 1, 16, 1, true), burstBeamMaterial);
    burstBeam.visible = false;
    scene.add(burstBeam);
    const burstRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a1f,
      transparent: true,
      opacity: 0,
      blending: additive,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const burstRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 64), burstRingMaterial);
    burstRing.visible = false;
    scene.add(burstRing);
    let burstAge = -1;
    let lastPulseValue = pulseRef.current;
    const lastSatellitePosition = new THREE.Vector3(3.15, 0, 0);

    let rotationX = 0.35;
    let rotationY = 0;
    let spin = 0;
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let zoom = 1;

    const onPointerDown = (event: PointerEvent): void => {
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      rotationY += (event.clientX - pointerX) * 0.008;
      rotationX = Math.max(-1.3, Math.min(1.3, rotationX + (event.clientY - pointerY) * 0.008));
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const onPointerUp = (): void => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoom = Math.max(0.72, Math.min(1.4, zoom - event.deltaY * 0.001));
      onZoom?.(zoom);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = (): void => {
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = 8.6 * Math.max(1, 1.05 / camera.aspect);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    let satelliteSignature = "";
    const animate = (): void => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      const currentLoad = loadRef.current / 100;
      const currentMode = modeRef.current;
      const speed =
        currentMode === "delegated" ? 0.75 : currentMode === "talking" ? 1.25 : currentMode === "thinking" ? 0.8 : 0.36;
      const expansion = visualRef.current.expansion * (currentMode === "talking" ? 1 + levelRef.current() * 0.32 : 1);
      const pulse = currentMode === "thinking" ? 1 + Math.sin(time * 1.8) * 0.035 : 1;
      activeColor.set(visualRef.current.color);
      coloredMaterials.forEach((material) => {
        const tinted = material as THREE.Material & { color?: THREE.Color };
        tinted.color?.copy(activeColor);
      });
      burstBeamMaterial.color.copy(activeColor);
      burstRingMaterial.color.copy(activeColor);
      orb.scale.setScalar(expansion * pulse);
      spin += delta * (0.18 + 0.5 * currentLoad) * speed;
      orb.rotation.set(rotationX, spin + rotationY, 0);
      cloud.scale.setScalar(1 + 0.025 * Math.sin(time * 2) + 0.05 * currentLoad);
      streaks.rotation.y = -time * 0.08 * speed;
      cloud.rotation.y = time * 0.05 * speed;
      core.rotation.x = time * 0.9 * speed;
      core.rotation.y = time * 0.6 * speed;
      glowA.scale.setScalar(2.2 + 0.5 * Math.sin(time * 3) + currentLoad);
      glowB.scale.setScalar(9 + Math.sin(time * 0.5) * 0.4);
      rings.forEach((ring) => {
        ring.group.rotation.z += ring.speed * delta * speed;
        ring.angle += ring.speed * 2.2 * delta * speed;
        ring.dot.position.set(Math.cos(ring.angle) * ring.radius, Math.sin(ring.angle) * ring.radius, 0);
      });
      camera.position.z = 8.6 * Math.max(1, 1.05 / camera.aspect) / zoom;

      if (pulseRef.current !== lastPulseValue) {
        lastPulseValue = pulseRef.current;
        const from = lastSatellitePosition.clone();
        const direction = from.length() > 0.01 ? from.clone().normalize() : new THREE.Vector3(1, 0, 0);
        burstBeam.position.copy(from).multiplyScalar(0.5);
        burstBeam.scale.set(1, Math.max(0.5, from.length()), 1);
        burstBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        burstBeam.visible = true;
        burstBeamMaterial.opacity = 0.9;
        burstRing.position.set(0, 0, 0);
        burstRing.scale.setScalar(1);
        burstRing.visible = true;
        burstRingMaterial.opacity = 0.85;
        burstAge = 0;
      }
      if (burstAge >= 0) {
        burstAge += delta;
        const progress = Math.min(1, burstAge / 1.15);
        burstBeamMaterial.opacity = (1 - progress) * 0.9;
        burstRingMaterial.opacity = (1 - progress) * 0.85;
        burstRing.scale.setScalar(1 + progress * 4.5);
        if (progress >= 1) {
          burstAge = -1;
          burstBeam.visible = false;
          burstRing.visible = false;
        }
      }
      const currentSignature = satellitesRef.current.map((agent) => `${agent.id}:${agent.summary}`).join("|");
      if (currentSignature !== satelliteSignature) {
        satelliteSignature = currentSignature;
        syncSatellites();
      }
      satelliteEntries.forEach((entry) => {
        entry.angle += delta * entry.speed * speed;
        const radius = 3.15;
        const x = Math.cos(entry.angle) * radius;
        const y = Math.sin(entry.angle * 1.7) * 0.35;
        const z = Math.sin(entry.angle) * radius;
        entry.mesh.position.set(x, y, z);
        entry.label.position.set(x, y + 0.3, z);
        entry.meshMaterial.color.copy(activeColor);
        entry.beamMaterial.color.copy(activeColor);
        entry.labelMaterial.color.copy(activeColor);
        lastSatellitePosition.set(x, y, z);
        const beamPositions = entry.beam.geometry.getAttribute("position") as THREE.BufferAttribute;
        beamPositions.setXYZ(0, 0, 0, 0);
        beamPositions.setXYZ(1, x, y, z);
        beamPositions.needsUpdate = true;
        entry.beamMaterial.opacity = 0.18 + (Math.sin(time * 5 + entry.angle) + 1) * 0.12;
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      for (const entry of satelliteEntries) {
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
        entry.beam.geometry.dispose();
        entry.beamMaterial.dispose();
        entry.labelMaterial.dispose();
        entry.labelTexture.dispose();
      }
      cloudGeometry.dispose();
      (cloud.material as THREE.Material).dispose();
      streakGeometry.dispose();
      (streaks.material as THREE.Material).dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      glowTexture.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="hud-orb-canvas" aria-label="Orbe 3D de JARVIS" />;
}
