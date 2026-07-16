// Three.js 3Dレンダラ（複数盤面対応）
// BoardView = 1盤面分の3Dオブジェクト一式（フレーム・ブロック・エフェクト）をGroupに内包。
// ソロ=1面／対戦=2面を同一シーン・同一カメラで描画する。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  COLOR_BY_INDEX,
  COLORS,
  COLS,
  ClearInfo,
  Game,
  HIDDEN,
  ROWS,
  VISIBLE,
  pieceCells,
} from '../core/tetris';

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
  max: number;
  mat: THREE.PointsMaterial;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

const VS_OFFSET = 7.6; // 対戦時の盤面中心オフセット

const cellGeo = new RoundedBoxGeometry(0.92, 0.92, 0.92, 3, 0.13);

class BoardView {
  group = new THREE.Group();

  private lockedMesh: THREE.InstancedMesh;
  private activeBoxes: THREE.Mesh[] = [];
  private activeMat: THREE.MeshStandardMaterial;
  private ghostBoxes: THREE.Mesh[] = [];
  private ghostMat: THREE.MeshBasicMaterial;
  private frameMats: THREE.MeshStandardMaterial[] = [];
  private flashLight: THREE.PointLight;
  private garbageBar: THREE.Mesh;

  private flashes: Flash[] = [];
  private bursts: Burst[] = [];
  private rings: Ring[] = [];

  private dirty = true;
  private greyMode = false;
  private framePulse = 0;
  private activeSmoothed: { x: number; y: number }[] | null = null;

  private tmpMatrix = new THREE.Matrix4();
  private tmpColor = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private owner: Renderer3D,
    private game: Game,
    offsetX: number,
  ) {
    this.group.position.set(offsetX, 0, 0);
    scene.add(this.group);

    const lockedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.4,
      roughness: 0.25,
    });
    this.lockedMesh = new THREE.InstancedMesh(cellGeo, lockedMat, COLS * VISIBLE + 8);
    this.lockedMesh.count = 0;
    this.lockedMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.lockedMesh);

    this.activeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      metalness: 0.3,
      roughness: 0.3,
    });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(cellGeo, this.activeMat);
      this.group.add(m);
      this.activeBoxes.push(m);
    }

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
    });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(cellGeo, this.ghostMat);
      this.group.add(m);
      this.ghostBoxes.push(m);
    }

    this.flashLight = new THREE.PointLight(0xffffff, 0, 0, 1.6);
    this.flashLight.position.set(0, 0, 6);
    this.group.add(this.flashLight);

    // 受けているせり上がり量の警告バー（盤面左側の赤いゲージ）
    this.garbageBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 1, 0.6),
      new THREE.MeshStandardMaterial({
        color: 0x330a12,
        emissive: 0xff2040,
        emissiveIntensity: 1.2,
      }),
    );
    this.garbageBar.visible = false;
    this.group.add(this.garbageBar);

    this.buildStage();
    this.bindGameEvents();
  }

  private worldX(c: number): number {
    return c - (COLS - 1) / 2;
  }

  private worldY(r: number): number {
    return ROWS - 1 - r - (VISIBLE - 1) / 2;
  }

  private buildStage(): void {
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS + 1.2, VISIBLE + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x070a16, metalness: 0.6, roughness: 0.7 }),
    );
    back.position.set(0, 0, -0.66);
    this.group.add(back);

    const gridPts: number[] = [];
    for (let c = 0; c <= COLS; c++) {
      const x = c - COLS / 2;
      gridPts.push(x, -VISIBLE / 2, -0.6, x, VISIBLE / 2, -0.6);
    }
    for (let r = 0; r <= VISIBLE; r++) {
      const y = r - VISIBLE / 2;
      gridPts.push(-COLS / 2, y, -0.6, COLS / 2, y, -0.6);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    const grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x18244a, transparent: true, opacity: 0.65 }),
    );
    this.group.add(grid);

    const mkBar = (w: number, h: number, x: number, y: number, emissive: number): void => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0b0e1c,
        emissive,
        emissiveIntensity: 0.35,
        metalness: 0.4,
        roughness: 0.4,
      });
      this.frameMats.push(mat);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.1), mat);
      bar.position.set(x, y, 0);
      this.group.add(bar);
    };
    const half = COLS / 2 + 0.22;
    const vhalf = VISIBLE / 2 + 0.22;
    mkBar(0.34, VISIBLE + 0.9, -half, 0, 0x00d5ff);
    mkBar(0.34, VISIBLE + 0.9, half, 0, 0xff2fd0);
    mkBar(COLS + 1.14, 0.34, 0, -vhalf, 0x00d5ff);
    mkBar(COLS + 1.14, 0.34, 0, vhalf, 0xff2fd0);
  }

  private bindGameEvents(): void {
    const g = this.game;
    g.on('reset', () => {
      this.greyMode = false;
      this.dirty = true;
      this.activeSmoothed = null;
    });
    g.on('lock', () => {
      this.dirty = true;
      this.owner.addShake(0.03);
    });
    g.on('spawn', () => {
      this.activeSmoothed = null;
      this.dirty = true;
    });
    g.on('hold', () => {
      this.activeSmoothed = null;
    });
    g.on('garbage', (p) => {
      const rows = p as number;
      if (rows <= 0) return;
      this.dirty = true;
      this.owner.addShake(0.12 + rows * 0.05);
      const grey = new THREE.Color(0x9aa4bd);
      for (let c = 0; c < COLS; c += 2) {
        this.spawnBurst(this.worldX(c), -VISIBLE / 2 + 0.5, grey, 8, 5.5);
      }
    });
    g.on('harddrop', (p) => {
      const dist = (p as { dist: number }).dist;
      if (dist <= 0) return;
      this.owner.addShake(Math.min(0.05 + dist * 0.006, 0.16));
      const { type, rot, x, y } = g.current;
      const color = new THREE.Color(COLORS[type]);
      for (const [cx, cy] of pieceCells(type, rot, x, y)) {
        if (cy < HIDDEN) continue;
        this.spawnBurst(this.worldX(cx), this.worldY(cy), color, 6, 3.2);
      }
    });
    g.on('clear', (payload) => {
      const info = payload as ClearInfo;
      const big = info.lines === 4 || info.tspin || info.pc;
      const mega = info.tspin || info.pc;
      this.owner.addShake(mega ? 0.95 : big ? 0.5 : 0.1 + info.lines * 0.06);
      this.framePulse = mega ? 2.8 : big ? 1.8 : 0.8;

      const rowColor = new THREE.Color(info.tspin ? 0xd38bff : 0x9fdcff);
      for (const r of info.rows) {
        this.spawnRowFlash(r);
        const step = mega ? 1 : 2;
        for (let c = 0; c < COLS; c += step) {
          this.spawnBurst(
            this.worldX(c),
            this.worldY(r),
            rowColor,
            mega ? 14 : 8,
            mega ? 9.5 : 6.5,
          );
        }
      }

      const yCenter =
        info.rows.length > 0
          ? this.worldY(info.rows[Math.floor(info.rows.length / 2)])
          : 0;

      if (mega) {
        const c1 = new THREE.Color(info.pc ? 0xffffff : 0xd38bff);
        const c2 = new THREE.Color(0xffffff);
        const c3 = new THREE.Color(info.pc ? 0xfff6ae : 0xff4fd8);
        this.spawnRing(0, yCenter, c1, 0.5);
        this.spawnRing(0, yCenter, c2, 0.72);
        this.spawnRing(0, yCenter, c3, 0.95);
        this.spawnBurst(0, yCenter, c1, 90, 12);
        this.spawnBurst(0, yCenter, c2, 50, 7);
        this.flashLight.color.set(info.pc ? 0xffffff : 0xd38bff);
        this.flashLight.intensity = 900;
        this.flashLight.position.set(0, yCenter, 6);
      } else if (big) {
        const color = new THREE.Color(0x5cf2ff);
        this.spawnRing(0, yCenter, color, 0.55);
        this.spawnBurst(0, yCenter, color, 40, 8);
        this.flashLight.color.set(0x5cf2ff);
        this.flashLight.intensity = 420;
        this.flashLight.position.set(0, yCenter, 6);
      }
      this.dirty = true;
    });
    g.on('levelup', () => {
      this.framePulse = 1.4;
    });
    g.on('gameover', () => {
      this.greyMode = true;
      this.dirty = true;
      this.owner.addShake(0.4);
    });
  }

  private spawnRowFlash(row: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(COLS + 0.5, 0.96, 1.25),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.set(0, this.worldY(row), 0.1);
    this.group.add(mesh);
    this.flashes.push({ mesh, life: 0.32, max: 0.32 });
  }

  private spawnBurst(
    x: number,
    y: number,
    color: THREE.Color,
    count: number,
    speed: number,
  ): void {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 0.6;
      pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      pos[i * 3 + 2] = 0.4;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.75);
      vel[i * 3] = Math.cos(a) * s;
      vel[i * 3 + 1] = Math.sin(a) * s + 1.6;
      vel[i * 3 + 2] = (Math.random() - 0.2) * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.2,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    this.bursts.push({ points, vel, life: 0.9, max: 0.9, mat });
  }

  private spawnRing(x: number, y: number, color: THREE.Color, life = 0.55): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.12, 56),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.set(x, y, 0.6);
    this.group.add(mesh);
    this.rings.push({ mesh, life, max: life });
  }

  private rebuildLocked(): void {
    let i = 0;
    for (let r = HIDDEN; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.game.grid[r][c];
        if (v === 0) continue;
        this.tmpMatrix.makeTranslation(this.worldX(c), this.worldY(r), 0);
        this.lockedMesh.setMatrixAt(i, this.tmpMatrix);
        if (this.greyMode) {
          this.tmpColor.setHex(0x3a4152);
        } else {
          this.tmpColor.setHex(COLOR_BY_INDEX[v] ?? 0xffffff);
          this.tmpColor.multiplyScalar(1.25);
        }
        this.lockedMesh.setColorAt(i, this.tmpColor);
        i++;
      }
    }
    this.lockedMesh.count = i;
    this.lockedMesh.instanceMatrix.needsUpdate = true;
    if (this.lockedMesh.instanceColor) this.lockedMesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const g = this.game;

    if (this.dirty) {
      this.rebuildLocked();
      this.dirty = false;
    }

    const { type, rot, x, y } = g.current;
    const cells = pieceCells(type, rot, x, y);
    const show = !g.over;
    const color = new THREE.Color(COLORS[type]);
    this.activeMat.color.copy(color);
    this.activeMat.emissive.copy(color);
    if (!this.activeSmoothed) {
      this.activeSmoothed = cells.map(([cx, cy]) => ({
        x: this.worldX(cx),
        y: this.worldY(cy),
      }));
    }
    const k = 1 - Math.exp(-20 * dt);
    const topEdgeY = this.worldY(HIDDEN) + 0.55;
    for (let i = 0; i < 4; i++) {
      const box = this.activeBoxes[i];
      if (!show) {
        box.visible = false;
        continue;
      }
      const [cx, cy] = cells[i];
      const tx = this.worldX(cx);
      const ty = this.worldY(cy);
      const s = this.activeSmoothed[i];
      s.x += (tx - s.x) * k;
      s.y += (ty - s.y) * k;
      box.position.set(s.x, s.y, 0);
      box.visible = s.y <= topEdgeY;
    }

    const gd = g.ghostDistance();
    this.ghostMat.color.copy(color);
    for (let i = 0; i < 4; i++) {
      const box = this.ghostBoxes[i];
      const [cx, cy] = cells[i];
      const gy = cy + gd;
      box.visible = show && gd > 0 && gy >= HIDDEN;
      if (box.visible) box.position.set(this.worldX(cx), this.worldY(gy), 0);
    }

    // 受けているせり上がり警告バー
    const pending = g.garbagePending();
    if (pending > 0) {
      const h = Math.min(pending, VISIBLE);
      this.garbageBar.visible = true;
      this.garbageBar.scale.y = h;
      this.garbageBar.position.set(-(COLS / 2 + 0.75), -VISIBLE / 2 + h / 2, 0);
    } else {
      this.garbageBar.visible = false;
    }

    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      const t = Math.max(f.life / f.max, 0);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      f.mesh.scale.y = 0.4 + t * 0.6;
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });

    this.bursts = this.bursts.filter((b) => {
      b.life -= dt;
      const posAttr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += b.vel[i] * dt;
        arr[i + 1] += b.vel[i + 1] * dt;
        arr[i + 2] += b.vel[i + 2] * dt;
        b.vel[i + 1] -= 9.0 * dt;
      }
      posAttr.needsUpdate = true;
      b.mat.opacity = Math.max(b.life / b.max, 0);
      if (b.life <= 0) {
        this.group.remove(b.points);
        b.points.geometry.dispose();
        b.mat.dispose();
        return false;
      }
      return true;
    });

    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      const t = 1 - Math.max(r.life / r.max, 0);
      r.mesh.scale.setScalar(1 + t * 9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });

    this.framePulse = Math.max(this.framePulse - dt * 2.2, 0);
    for (const m of this.frameMats) {
      m.emissiveIntensity = 0.35 + this.framePulse * 1.5;
    }

    this.flashLight.intensity *= Math.exp(-dt * 7);
    if (this.flashLight.intensity < 1) this.flashLight.intensity = 0;
  }

  dispose(scene: THREE.Scene): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== cellGeo) mesh.geometry.dispose();
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[];
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    scene.remove(this.group);
  }
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private starfield: THREE.Points;
  private views: BoardView[] = [];
  private shake = 0;
  private camBase = new THREE.Vector3(0, 1.6, 24);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.id = 'gl';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050d);
    this.scene.fog = new THREE.Fog(0x04050d, 40, 110);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );

    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(6, 12, 10);
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x00d5ff, 80, 0, 2);
    p1.position.set(-12, 6, 9);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0xff2fd0, 80, 0, 2);
    p2.position.set(12, -6, 9);
    this.scene.add(p2);

    this.starfield = this.buildStarfield();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,
      0.45,
      0.72,
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.onResize());
  }

  // ソロ=1盤面／対戦=2盤面に切り替える
  setBoards(games: Game[]): void {
    for (const v of this.views) v.dispose(this.scene);
    const offsets = games.length === 2 ? [-VS_OFFSET, VS_OFFSET] : [0];
    this.views = games.map((g, i) => new BoardView(this.scene, this, g, offsets[i]));
    this.fitCamera();
  }

  addShake(v: number): void {
    this.shake = Math.max(this.shake, v);
  }

  private buildStarfield(): THREE.Points {
    const n = 420;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 40 + Math.random() * 55;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) - 5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9db8ff,
        size: 0.32,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(pts);
    return pts;
  }

  // 全盤面（フレーム込み）が必ず画面に収まるカメラ距離を計算する
  private fitCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = VISIBLE / 2 + 2.0;
    const halfW =
      this.views.length === 2 ? VS_OFFSET + COLS / 2 + 1.6 : COLS / 2 + 1.6;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const zForHeight = halfH / tan;
    const zForWidth = halfW / (tan * aspect);
    this.camBase.z = Math.max(zForHeight, zForWidth) + 1;
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, -0.2, 0);
  }

  render(dt: number): void {
    for (const v of this.views) v.update(dt);

    this.starfield.rotation.z += dt * 0.012;

    this.shake *= Math.exp(-dt * 5.5);
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * this.shake,
      this.camBase.y + (Math.random() - 0.5) * this.shake,
      this.camBase.z,
    );

    this.composer.render();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
