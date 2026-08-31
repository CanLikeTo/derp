import * as THREE from "three";
import { ROOM, MOVEMENT, type PlayerState } from "@derp/simulation";
export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-12, 12, 13.5, 0, 0.1, 100);
  private meshes = new Map<string, THREE.Mesh>();
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
    this.scene.add(this.ghost, this.outlines);
    this.ghost.visible = false;
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
  ) {
    const ids = new Set(players.map((player) => player.id));
    for (const [id, mesh] of this.meshes)
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
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
        const label = document.createElement("div");
        label.className = `player-label p${player.slot}`;
        this.host.append(label);
        this.labels.set(player.id, label);
      }
      mesh.position.set(player.x, player.y, 0.4);
      const label = this.labels.get(player.id)!;
      label.textContent = `P${player.slot}${player.id === localId ? " · LOCAL" : ""}`;
      label.style.left = `clamp(42px, ${((player.x + 12) / 24) * 100}%, calc(100% - 42px))`;
      label.style.top = `${(1 - (player.y + 1.4) / 13.5) * 100}%`;
    }
    this.ghost.visible = debug && !!authoritative;
    this.outlines.visible = debug;
    if (authoritative)
      this.ghost.position.set(authoritative.x, authoritative.y, 0.5);
    this.renderer.render(this.scene, this.camera);
  }
  counts() {
    return {
      players: this.meshes.size,
      geometries: this.renderer.info.memory.geometries,
      programs: this.renderer.info.programs?.length ?? 0,
      sceneObjects: this.scene.children.length,
    };
  }
  dispose() {
    this.observer.disconnect();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
    this.renderer.dispose();
    for (const label of this.labels.values()) label.remove();
    this.renderer.domElement.remove();
  }
}
