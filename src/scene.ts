// The Three.js scene: instanced stars, soft halos, cluster labels, camera controls and picking.
// It draws a frame only when something changed, so an idle tab uses no GPU time.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  AmbientLight,
  DirectionalLight,
  MeshLambertMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Galaxy } from "./lib/layout.ts";
import { seeded } from "./lib/layout.ts";
import { categoryColor } from "./lib/palette.ts";
import type { Catalog } from "./lib/types.ts";

export interface SceneOptions {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  ringHover: HTMLElement;
  ringSelected: HTMLElement;
  catalog: Catalog;
  galaxy: Galaxy;
  titles: string[];
  reducedMotion: () => boolean;
  onHover: (star: number | null, x: number, y: number) => void;
  onPick: (star: number | null) => void;
  onCategory: (categoryIndex: number) => void;
}

export interface SceneApi {
  setSelection(categoryIndex: number | null, star: number | null): void;
  showAll(): void;
  rotate(dTheta: number, dPhi: number): void;
  zoom(factor: number): void;
  resize(): void;
  dispose(): void;
}

interface View {
  theta: number;
  phi: number;
  dist: number;
  target: Vector3;
}

const FOV = 46;
const MIN_DIST = 5;
const MAX_PLATFORM_LABELS = 10;

function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

export function createScene(o: SceneOptions): SceneApi {
  const { galaxy, catalog } = o;
  const starCount = galaxy.stars.length;

  const renderer = new WebGLRenderer({ canvas: o.canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.5, 2000);

  // Stars: one draw call for every platform.
  const baseColors = galaxy.stars.map((s) => new Color(categoryColor(catalog.categories[s.categoryIndex].id, s.categoryIndex)));
  const starGeometry = new IcosahedronGeometry(1, 3);
  const starMaterial = new MeshLambertMaterial();
  // The key light rides with the camera so every star reads as a lit ball from any angle.
  const key = new DirectionalLight(0xffffff, 2.1);
  key.position.set(-0.6, 0.9, 1);
  camera.add(key);
  scene.add(camera, new AmbientLight(0xffffff, 1.25));
  const starMesh = new InstancedMesh(starGeometry, starMaterial, Math.max(1, starCount));
  starMesh.count = starCount;
  const m4 = new Matrix4();
  galaxy.stars.forEach((s, i) => {
    m4.makeScale(s.size, s.size, s.size).setPosition(s.position[0], s.position[1], s.position[2]);
    starMesh.setMatrixAt(i, m4);
    starMesh.setColorAt(i, baseColors[i]);
  });
  starMesh.frustumCulled = false;
  scene.add(starMesh);

  // Halos: one point per star, sized in world units.
  const haloGeometry = new BufferGeometry();
  const haloPos = new Float32Array(starCount * 3);
  const haloColor = new Float32Array(starCount * 3);
  const haloSize = new Float32Array(starCount);
  galaxy.stars.forEach((s, i) => {
    haloPos.set(s.position, i * 3);
    haloSize[i] = s.size * 5.2;
  });
  haloGeometry.setAttribute("position", new BufferAttribute(haloPos, 3));
  haloGeometry.setAttribute("color", new BufferAttribute(haloColor, 3));
  haloGeometry.setAttribute("aSize", new BufferAttribute(haloSize, 1));
  const haloMaterial = new ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: `
      attribute float aSize;
      attribute vec3 color;
      uniform float uScale;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * uScale / -mv.z, 220.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * 0.2);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const halos = new Points(haloGeometry, haloMaterial);
  halos.frustumCulled = false;
  scene.add(halos);

  // A faint thread through each cluster, biggest platform first.
  const linePos: number[] = [];
  const lineColor: number[] = [];
  catalog.categories.forEach((_, ci) => {
    const members = galaxy.stars.filter((s) => s.categoryIndex === ci).sort((a, b) => b.size - a.size || a.platformIndex - b.platformIndex);
    for (let i = 0; i + 1 < members.length; i++) {
      linePos.push(...members[i].position, ...members[i + 1].position);
      const c = baseColors[members[i].index];
      lineColor.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  });
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute("position", new BufferAttribute(new Float32Array(linePos), 3));
  lineGeometry.setAttribute("color", new BufferAttribute(new Float32Array(lineColor), 3));
  const lineMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  scene.add(lines);

  // A soft cloud behind each cluster.
  const glow = glowTexture();
  const clouds = galaxy.clusters.map((cluster) => {
    const color = categoryColor(catalog.categories[cluster.categoryIndex].id, cluster.categoryIndex);
    const material = new SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.1, depthWrite: false, blending: AdditiveBlending });
    const sprite = new Sprite(material);
    sprite.position.set(cluster.center[0], cluster.center[1], cluster.center[2]);
    sprite.scale.setScalar(cluster.radius * 3.4);
    scene.add(sprite);
    return sprite;
  });

  // Background dust.
  const rand = seeded(20261008);
  const dustCount = 700;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const r = galaxy.extent * (1.1 + rand() * 2.4);
    const a = rand() * Math.PI * 2;
    const y = (rand() - 0.5) * 2;
    const flat = Math.sqrt(1 - y * y);
    dustPos.set([Math.cos(a) * flat * r, y * r * 0.7, Math.sin(a) * flat * r], i * 3);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute("position", new BufferAttribute(dustPos, 3));
  const dustMaterial = new PointsMaterial({ color: 0xcfe3d8, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.32, depthWrite: false });
  const dust = new Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  scene.add(dust);

  // Labels live in the DOM so they stay sharp and selectable.
  const categoryLabels = galaxy.clusters.map((cluster) => {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.className = "label label-category";
    b.style.setProperty("--c", categoryColor(catalog.categories[cluster.categoryIndex].id, cluster.categoryIndex));
    b.textContent = o.titles[cluster.categoryIndex];
    b.addEventListener("click", () => o.onCategory(cluster.categoryIndex));
    o.labels.append(b);
    return b;
  });
  const platformLabels = Array.from({ length: MAX_PLATFORM_LABELS + 1 }, () => {
    const s = document.createElement("span");
    s.className = "label label-platform";
    s.hidden = true;
    o.labels.append(s);
    return s;
  });

  // Camera state: where it is and where it is heading.
  const cur: View = { theta: 0.9, phi: 0.95, dist: 100, target: new Vector3() };
  const goal: View = { theta: 0.35, phi: 0.98, dist: 100, target: new Vector3() };
  let width = 1;
  let height = 1;
  let projScale = 1;
  let selectedCategory: number | null = null;
  let selectedStar: number | null = null;
  let hoverStar: number | null = null;
  let labelStars: number[] = [];
  let frame = 0;
  let last = 0;
  let disposed = false;
  let touched = false;
  let labelSizes: number[][] = [];
  const labelOrder = galaxy.clusters.map((c) => c.categoryIndex).sort((a, b) => catalog.categories[b].jobCount - catalog.categories[a].jobCount || a - b);

  const screen = new Float32Array(starCount * 3); // x, y, radius in px
  const depth = new Float32Array(starCount);
  const v = new Vector3();

  function fitDistance(radius: number): number {
    const vHalf = (FOV / 2) * (Math.PI / 180);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    return radius / Math.sin(Math.min(vHalf, hHalf));
  }

  /** Portrait screens look down on the disc so it fills the height; wide screens see it at a slant. */
  function overviewPhi(): number {
    return camera.aspect < 0.8 ? 0.5 : 0.98;
  }

  function overviewDist(): number {
    return fitDistance(galaxy.extent) * 0.8;
  }

  function maxDist(): number {
    return fitDistance(galaxy.extent) * 1.5;
  }

  function clampGoal(): void {
    goal.phi = Math.min(Math.PI - 0.2, Math.max(0.2, goal.phi));
    goal.dist = Math.min(maxDist(), Math.max(MIN_DIST, goal.dist));
  }

  function invalidate(): void {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    frame = 0;
    const dt = Math.min(0.05, last === 0 ? 0.016 : (now - last) / 1000);
    last = now;
    const k = o.reducedMotion() ? 1 : 1 - Math.exp(-dt * 6.5);
    cur.theta += (goal.theta - cur.theta) * k;
    cur.phi += (goal.phi - cur.phi) * k;
    cur.dist += (goal.dist - cur.dist) * k;
    cur.target.lerp(goal.target, k);
    const moving =
      Math.abs(goal.theta - cur.theta) > 0.0004 ||
      Math.abs(goal.phi - cur.phi) > 0.0004 ||
      Math.abs(goal.dist - cur.dist) > 0.01 ||
      cur.target.distanceToSquared(goal.target) > 0.0001;
    draw();
    if (moving) invalidate();
    else last = 0;
  }

  function draw(): void {
    const sinPhi = Math.sin(cur.phi);
    camera.position.set(
      cur.target.x + cur.dist * sinPhi * Math.sin(cur.theta),
      cur.target.y + cur.dist * Math.cos(cur.phi),
      cur.target.z + cur.dist * sinPhi * Math.cos(cur.theta),
    );
    camera.lookAt(cur.target);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);

    // Screen positions for picking, rings and labels.
    for (let i = 0; i < starCount; i++) {
      const s = galaxy.stars[i];
      v.set(s.position[0], s.position[1], s.position[2]);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      depth[i] = v.z < 1 && v.z > -1 ? d : -1;
      screen[i * 3] = (v.x * 0.5 + 0.5) * width;
      screen[i * 3 + 1] = (-v.y * 0.5 + 0.5) * height;
      screen[i * 3 + 2] = (s.size * projScale) / d;
    }
    placeRing(o.ringHover, hoverStar !== null && hoverStar !== selectedStar ? hoverStar : null);
    placeRing(o.ringSelected, selectedStar);

    // Category labels: the selected one first, then by size. A label that would cover one
    // already placed is hidden until the camera moves.
    const placed: number[][] = [];
    const order = selectedCategory === null ? labelOrder : [selectedCategory, ...labelOrder.filter((i) => i !== selectedCategory)];
    for (const i of order) {
      const cluster = galaxy.clusters[i];
      const el = categoryLabels[i];
      v.set(cluster.center[0], cluster.center[1] + cluster.radius * 0.62 + 0.8, cluster.center[2]);
      v.project(camera);
      const [w, hgt] = labelSizes[i] ?? [80, 24];
      const x = (v.x * 0.5 + 0.5) * width;
      const y = (-v.y * 0.5 + 0.5) * height;
      const box = [x - w / 2 - 3, y - hgt - 3, x + w / 2 + 3, y + 3];
      const visible = v.z < 1 && v.z > -1 && !placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
      el.style.visibility = visible ? "visible" : "hidden";
      if (!visible) continue;
      placed.push(box);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    // Platform labels: the selected platform first, then by size, skipping any that would overlap.
    const used: number[][] = [];
    const slots = labelStars.map((star, i) => ({ star, i })).sort((a, b) => Number(b.star === selectedStar) - Number(a.star === selectedStar) || a.i - b.i);
    platformLabels.forEach((el, i) => i >= labelStars.length && (el.hidden = true));
    for (const { star, i } of slots) {
      const el = platformLabels[i];
      if (depth[star] < 0) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      const w = el.offsetWidth;
      const x = screen[star * 3];
      const y = screen[star * 3 + 1] + Math.max(9, screen[star * 3 + 2] + 6) + 3;
      const box = [x - w / 2 - 4, y - 2, x + w / 2 + 4, y + 18];
      if (used.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
        el.hidden = true;
        continue;
      }
      used.push(box);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
    }
  }

  function placeRing(el: HTMLElement, star: number | null): void {
    if (star === null || depth[star] < 0) {
      el.style.opacity = "0";
      return;
    }
    const r = Math.max(9, screen[star * 3 + 2] + 6);
    el.style.opacity = "1";
    el.style.width = el.style.height = `${(r * 2).toFixed(1)}px`;
    el.style.transform = `translate(${(screen[star * 3] - r).toFixed(1)}px, ${(screen[star * 3 + 1] - r).toFixed(1)}px)`;
  }

  /** Nearest star to a point on screen. A small star still gets a finger-sized target. */
  function pick(x: number, y: number, slack: number): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < starCount; i++) {
      if (depth[i] < 0) continue;
      const r = screen[i * 3 + 2];
      const d = Math.hypot(screen[i * 3] - x, screen[i * 3 + 1] - y);
      if (d > Math.max(r, slack)) continue;
      // Inside the disc wins by depth; otherwise the closest edge wins.
      const s = d <= r ? -1e6 + depth[i] : d - r;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  }

  function paint(): void {
    const dim = new Color();
    for (let i = 0; i < starCount; i++) {
      const on = selectedCategory === null || galaxy.stars[i].categoryIndex === selectedCategory;
      dim.copy(baseColors[i]).multiplyScalar(on ? 1 : 0.3);
      starMesh.setColorAt(i, dim);
      const h = on ? 1 : 0.25;
      haloColor[i * 3] = baseColors[i].r * h;
      haloColor[i * 3 + 1] = baseColors[i].g * h;
      haloColor[i * 3 + 2] = baseColors[i].b * h;
    }
    if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
    haloGeometry.getAttribute("color").needsUpdate = true;
    clouds.forEach((c, i) => (c.material.opacity = selectedCategory === null ? 0.1 : i === selectedCategory ? 0.14 : 0.03));
    categoryLabels.forEach((el, i) => el.classList.toggle("is-dim", selectedCategory !== null && i !== selectedCategory));
    categoryLabels.forEach((el, i) => el.classList.toggle("is-on", i === selectedCategory));
  }

  function chooseLabels(): void {
    labelStars = [];
    if (selectedCategory !== null) {
      labelStars = galaxy.stars
        .filter((s) => s.categoryIndex === selectedCategory)
        .sort((a, b) => b.size - a.size || a.platformIndex - b.platformIndex)
        .slice(0, MAX_PLATFORM_LABELS)
        .map((s) => s.index);
      if (selectedStar !== null && !labelStars.includes(selectedStar)) labelStars.push(selectedStar);
    }
    platformLabels.forEach((el, i) => {
      const star = labelStars[i];
      if (star === undefined) return;
      const s = galaxy.stars[star];
      el.textContent = catalog.categories[s.categoryIndex].platforms[s.platformIndex].title;
      el.classList.toggle("is-on", star === selectedStar);
    });
  }

  function resize(): void {
    const rect = o.stage.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    projScale = height / (2 * Math.tan((FOV / 2) * (Math.PI / 180)));
    haloMaterial.uniforms.uScale.value = projScale * dpr;
    if (selectedCategory === null && selectedStar === null) {
      goal.dist = overviewDist();
      if (!touched) goal.phi = overviewPhi();
    }
    labelSizes = categoryLabels.map((el) => [el.offsetWidth, el.offsetHeight]);
    clampGoal();
    invalidate();
  }

  // Pointer input: one finger or the mouse orbits, two fingers pinch, shift or right drag pans.
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = { x: 0, y: 0, t: 0 };
  let travelled = 0;
  let pinch = 0;

  function local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = o.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function setHover(star: number | null, x: number, y: number): void {
    if (star !== hoverStar) {
      hoverStar = star;
      o.canvas.style.cursor = star === null ? "grab" : "pointer";
      invalidate();
    }
    o.onHover(star, x, y);
  }

  function onPointerDown(e: PointerEvent): void {
    o.canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      travelled = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      travelled = 99;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        const p = local(e);
        setHover(pick(p.x, p.y, 8), p.x, p.y);
      }
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) goal.dist *= pinch / d;
      pinch = d;
      clampGoal();
      invalidate();
      return;
    }
    travelled += Math.abs(dx) + Math.abs(dy);
    if (travelled < 6) return;
    touched = true;
    setHover(null, 0, 0);
    if (e.shiftKey || e.buttons === 2) {
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const s = cur.dist / projScale;
      goal.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else {
      goal.theta -= dx * 0.0055;
      goal.phi -= dy * 0.0055;
    }
    clampGoal();
    invalidate();
  }

  function onPointerUp(e: PointerEvent): void {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!had || pointers.size > 0) return;
    if (travelled < 6 && performance.now() - downAt.t < 600) {
      const p = local(e);
      o.onPick(pick(p.x, p.y, e.pointerType === "mouse" ? 8 : 22));
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;
    goal.dist *= Math.exp(Math.max(-120, Math.min(120, e.deltaY * unit)) * 0.0016);
    clampGoal();
    invalidate();
  }

  function onLeave(): void {
    setHover(null, 0, 0);
  }

  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  function onContextLost(e: Event): void {
    e.preventDefault();
  }

  o.canvas.addEventListener("pointerdown", onPointerDown);
  o.canvas.addEventListener("pointermove", onPointerMove);
  o.canvas.addEventListener("pointerup", onPointerUp);
  o.canvas.addEventListener("pointercancel", onPointerUp);
  o.canvas.addEventListener("pointerleave", onLeave);
  o.canvas.addEventListener("wheel", onWheel, { passive: false });
  o.canvas.addEventListener("contextmenu", onContextMenu);
  o.canvas.addEventListener("webglcontextlost", onContextLost);
  o.canvas.addEventListener("webglcontextrestored", invalidate);
  o.canvas.style.cursor = "grab";

  const observer = new ResizeObserver(resize);
  observer.observe(o.stage);

  resize();
  paint();
  // Label widths change once the web font arrives.
  void document.fonts?.ready.then(() => !disposed && resize());
  // Start a little further out and settle in. With reduced motion the first frame is the final one.
  cur.dist = goal.dist * 1.35;
  cur.target.copy(goal.target);
  invalidate();

  return {
    setSelection(categoryIndex, star) {
      selectedCategory = categoryIndex;
      selectedStar = star;
      paint();
      chooseLabels();
      if (star !== null) {
        const s = galaxy.stars[star];
        const cluster = galaxy.clusters[s.categoryIndex];
        goal.target.set(s.position[0], s.position[1], s.position[2]);
        goal.dist = fitDistance(Math.max(cluster.radius * 0.95, s.size * 6));
      } else if (categoryIndex !== null) {
        const cluster = galaxy.clusters[categoryIndex];
        goal.target.set(cluster.center[0], cluster.center[1], cluster.center[2]);
        goal.dist = fitDistance(cluster.radius * 1.2);
      } else {
        goal.target.set(0, 0, 0);
        goal.dist = overviewDist();
      }
      clampGoal();
      invalidate();
    },
    showAll() {
      goal.target.set(0, 0, 0);
      goal.theta = 0.35;
      goal.phi = overviewPhi();
      goal.dist = overviewDist();
      invalidate();
    },
    rotate(dTheta, dPhi) {
      goal.theta += dTheta;
      goal.phi += dPhi;
      clampGoal();
      invalidate();
    },
    zoom(factor) {
      goal.dist *= factor;
      clampGoal();
      invalidate();
    },
    resize,
    dispose() {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      o.canvas.removeEventListener("pointerdown", onPointerDown);
      o.canvas.removeEventListener("pointermove", onPointerMove);
      o.canvas.removeEventListener("pointerup", onPointerUp);
      o.canvas.removeEventListener("pointercancel", onPointerUp);
      o.canvas.removeEventListener("pointerleave", onLeave);
      o.canvas.removeEventListener("wheel", onWheel);
      o.canvas.removeEventListener("contextmenu", onContextMenu);
      o.canvas.removeEventListener("webglcontextlost", onContextLost);
      o.canvas.removeEventListener("webglcontextrestored", invalidate);
      o.labels.replaceChildren();
      for (const g of [starGeometry, haloGeometry, lineGeometry, dustGeometry]) g.dispose();
      for (const m of [starMaterial, haloMaterial, lineMaterial, dustMaterial]) m.dispose();
      clouds.forEach((c) => c.material.dispose());
      glow.dispose();
      starMesh.dispose();
      renderer.dispose();
    },
  };
}
