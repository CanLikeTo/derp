import * as THREE from "three";
import {
  ROOM,
  MOVEMENT,
  CARBINE,
  aimQToRadians,
  type PlayerState,
} from "@derp/simulation";
import type { ProjectileView } from "@derp/protocol";
import type { WorldPoint } from "./input";
import type { EffectView } from "./combat";
export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-12, 12, 13.5, 0, 0.1, 100);
  private meshes = new Map<string, THREE.Mesh>();
  private directions = new Map<string, THREE.Line>();
  private labels = new Map<string, HTMLDivElement>();
  private playerGeometry = new THREE.BoxGeometry(
    MOVEMENT.width,
    MOVEMENT.height,
    0.6,
  );
  private materials = [
    new THREE.MeshStandardMaterial({ color: "#dcff63", roughness: 0.65 }),
    new THREE.MeshStandardMaterial({ color: "#ff916c", roughness: 0.65 }),
  ];
  private directionGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.5, 0, 0),
  ]);
  private directionMaterials = [
    new THREE.LineBasicMaterial({ color: "#dcff63" }),
    new THREE.LineBasicMaterial({ color: "#ff916c" }),
  ];
  private ghost = new THREE.Mesh(
    this.playerGeometry,
    new THREE.MeshBasicMaterial({
      color: "#f7f7e9",
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    }),
  );
  private outlines = new THREE.Group();
  private ghostDirection = new THREE.Line(
    this.directionGeometry,
    new THREE.LineBasicMaterial({
      color: "#f7f7e9",
      transparent: true,
      opacity: 0.65,
    }),
  );
  private reticle = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.18, 0, 0),
      new THREE.Vector3(-0.06, 0, 0),
      new THREE.Vector3(0.06, 0, 0),
      new THREE.Vector3(0.18, 0, 0),
      new THREE.Vector3(0, -0.18, 0),
      new THREE.Vector3(0, -0.06, 0),
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0, 0.18, 0),
    ]),
    new THREE.LineBasicMaterial({ color: "#f7f7e9" }),
  );
  private projectileGeometry = new THREE.BoxGeometry(
    CARBINE.halfExtent * 2,
    CARBINE.halfExtent * 2,
    0.12,
  );
  private projectileMaterials = [
    new THREE.MeshBasicMaterial({ color: "#dcff63" }),
    new THREE.MeshBasicMaterial({ color: "#ff916c" }),
  ];
  private projectileMeshes = Array.from(
    { length: CARBINE.roomProjectileCap },
    () => new THREE.Mesh(this.projectileGeometry, this.projectileMaterials[0]),
  );
  private effectGeometry = new THREE.RingGeometry(0.08, 0.2, 8);
  private effectMaterials = {
    muzzle: new THREE.MeshBasicMaterial({
      color: "#fff5a8",
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
    terrain: new THREE.MeshBasicMaterial({
      color: "#f7f7e9",
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
    player: new THREE.MeshBasicMaterial({
      color: "#ff577f",
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  };
  private effectMeshes = Array.from(
    { length: CARBINE.effectPoolSize },
    () => new THREE.Mesh(this.effectGeometry, this.effectMaterials.terrain),
  );
  private observer: ResizeObserver;
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor("#111916");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.camera.position.set(0, 0, 25);
    this.scene.add(new THREE.HemisphereLight("#f2ffe2", "#345245", 2.4));
    const light = new THREE.DirectionalLight("#ffffff", 2);
    light.position.set(-5, 10, 12);
    this.scene.add(light);
    const terrain = new THREE.MeshStandardMaterial({
      color: "#55695b",
      roughness: 0.9,
    });
    for (const solid of ROOM.solids) {
      const geometry = new THREE.BoxGeometry(solid.width, solid.height, 1.2);
      const mesh = new THREE.Mesh(geometry, terrain);
      mesh.position.set(solid.x, solid.y, -0.2);
      this.scene.add(mesh);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: "#c8ff9a" }),
      );
      outline.position.copy(mesh.position);
      this.outlines.add(outline);
    }
    const grid = new THREE.GridHelper(24, 24, "#28392e", "#1d2b22");
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 6, -1);
    this.scene.add(grid);
    this.scene.add(
      this.ghost,
      this.ghostDirection,
      this.reticle,
      this.outlines,
    );
    for (const mesh of [...this.projectileMeshes, ...this.effectMeshes]) {
      mesh.visible = false;
      this.scene.add(mesh);
    }
    this.ghost.visible = false;
    this.ghostDirection.visible = false;
    this.reticle.visible = false;
    this.outlines.visible = false;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }
  resize() {
    const width = this.host.clientWidth;
    this.renderer.setSize(width, (width * 9) / 16, false);
  }
  draw(
    players: PlayerState[],
    localId: string,
    authoritative: PlayerState | undefined,
    debug: boolean,
    reticleTarget?: WorldPoint,
    reticleVisible = false,
    projectiles: ProjectileView[] = [],
    effects: EffectView[] = [],
  ) {
    const ids = new Set(players.map((player) => player.id));
    for (const [id, mesh] of this.meshes)
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        const direction = this.directions.get(id);
        if (direction) this.scene.remove(direction);
        this.meshes.delete(id);
        this.directions.delete(id);
        this.labels.get(id)?.remove();
        this.labels.delete(id);
      }
    for (const player of players) {
      let mesh = this.meshes.get(player.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.playerGeometry,
          this.materials[player.slot - 1]!,
        );
        this.meshes.set(player.id, mesh);
        this.scene.add(mesh);
        const direction = new THREE.Line(
          this.directionGeometry,
          this.directionMaterials[player.slot - 1]!,
        );
        this.directions.set(player.id, direction);
        this.scene.add(direction);
        const label = document.createElement("div");
        label.className = `player-label p${player.slot}`;
        this.host.append(label);
        this.labels.set(player.id, label);
      }
      mesh.position.set(player.x, player.y, 0.4);
      const direction = this.directions.get(player.id)!;
      direction.position.set(player.x, player.y, 0.9);
      direction.rotation.z = aimQToRadians(player.aimQ);
      const label = this.labels.get(player.id)!;
      label.textContent = `P${player.slot}${player.id === localId ? " · LOCAL" : ""}${player.jetActive ? " · JET" : ""}`;
      label.style.left = `clamp(70px, ${((player.x + 12) / 24) * 100}%, calc(100% - 70px))`;
      label.style.top = `clamp(28px, ${(1 - (player.y + 1.4) / 13.5) * 100}%, calc(100% - 4px))`;
    }
    this.ghost.visible = debug && !!authoritative;
    this.ghostDirection.visible = debug && !!authoritative;
    this.outlines.visible = debug;
    if (authoritative) {
      this.ghost.position.set(authoritative.x, authoritative.y, 0.5);
      this.ghostDirection.position.set(authoritative.x, authoritative.y, 1);
      this.ghostDirection.rotation.z = aimQToRadians(authoritative.aimQ);
    }
    this.reticle.visible = reticleVisible && !!reticleTarget;
    if (reticleTarget)
      this.reticle.position.set(reticleTarget.x, reticleTarget.y, 1.2);
    for (let index = 0; index < this.projectileMeshes.length; index++) {
      const mesh = this.projectileMeshes[index]!;
      const projectile = projectiles[index];
      mesh.visible = !!projectile;
      if (projectile) {
        mesh.material = this.projectileMaterials[projectile.ownerSlot - 1]!;
        mesh.position.set(projectile.x, projectile.y, 1.05);
        mesh.rotation.z = aimQToRadians(projectile.aimQ);
      }
    }
    for (let index = 0; index < this.effectMeshes.length; index++) {
      const mesh = this.effectMeshes[index]!;
      const effect = effects[index];
      mesh.visible = !!effect;
      if (effect) {
        mesh.material =
          effect.kind === "muzzle"
            ? this.effectMaterials.muzzle
            : effect.kind === "impact-player"
              ? this.effectMaterials.player
              : this.effectMaterials.terrain;
        mesh.position.set(effect.x, effect.y, 1.15);
        mesh.rotation.z = Math.atan2(effect.normalY, effect.normalX);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
  counts() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let graphObjects = 0;
    this.scene.traverse((object) => {
      graphObjects++;
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.LineSegments
      ) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    return {
      players: this.meshes.size,
      directionLines: this.directions.size,
      reticles: 1,
      projectileSlots: this.projectileMeshes.length,
      visibleProjectiles: this.projectileMeshes.filter((mesh) => mesh.visible)
        .length,
      effectSlots: this.effectMeshes.length,
      visibleEffects: this.effectMeshes.filter((mesh) => mesh.visible).length,
      labels: this.labels.size,
      geometries: this.renderer.info.memory.geometries,
      trackedGeometries: geometries.size,
      materials: materials.size,
      programs: this.renderer.info.programs?.length ?? 0,
      sceneObjects: this.scene.children.length,
      graphObjects,
    };
  }
  dispose() {
    this.observer.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.LineSegments
      ) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.renderer.dispose();
    for (const label of this.labels.values()) label.remove();
    this.renderer.domElement.remove();
  }
}
