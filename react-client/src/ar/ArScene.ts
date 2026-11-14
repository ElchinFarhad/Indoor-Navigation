/**
 * The 3D overlay drawn on top of the camera image (Three.js / WebGL).
 *
 * The scene is the building in real-world metres: map x -> X, map y -> Z, up
 * is +Y, the floor is the plane Y = 0. A virtual camera is placed where the
 * user is estimated to be and oriented like the phone, so anything drawn in
 * the scene lands on the matching spot of the camera image:
 *
 *   - a trail of chevrons on the floor along the route,
 *   - a floating sign at the next turn / staircase,
 *   - a pin above the destination,
 *   - a large guidance arrow that stays in view and always points along the
 *     route, however the phone is held.
 *
 * The same scene serves both rendering modes: the camera-overlay mode, where
 * the pose comes from the QR + motion-sensor tracker, and the WebXR mode,
 * where the browser's own AR tracking moves the camera.
 */
import * as THREE from 'three';
import { Building } from '../nav/building';
import { angleDiff, Mat3 } from '../nav/geometry';
import { Maneuver } from '../nav/instructions';
import { headingOf } from '../nav/orientation';
import { pointAlongRoute, Route } from '../nav/routing';

export interface ArFrame {
  /** Camera-to-map rotation (see nav/orientation.ts), or null when the orientation is unknown. */
  cameraToWorld: Mat3 | null;
  /** Estimated user position in map units. */
  position: { x: number; y: number; floor: number } | null;
  route: Route | null;
  maneuvers: Maneuver[];
  arrived: boolean;
  /** Direction the user faces on the map according to the tracker (used to align a WebXR session). */
  heading?: number | null;
}

/** Where WebXR tracking says the user is, in map units / map heading. */
export interface XrPose {
  x: number;
  y: number;
  heading: number;
}

const EYE_HEIGHT = 1.45; // metres: a phone held in front of the chest / face
const TRAIL_SPACING = 1.1; // metres between chevrons
const TRAIL_LENGTH = 20; // metres of route shown ahead
const MAX_CHEVRONS = 24;
const TRAIL_START = 1.0; // metres ahead of the user where the trail begins

const COLOR_ROUTE = 0x22b8f0;
const COLOR_ROUTE_EDGE = 0xffffff;
const COLOR_TURN = 0xffb020;
const COLOR_DEST = 0x22c55e;

function arrowShape(): THREE.Shape {
  // Points along +x, one unit long.
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.13);
  s.lineTo(0.05, -0.13);
  s.lineTo(0.05, -0.34);
  s.lineTo(0.5, 0);
  s.lineTo(0.05, 0.34);
  s.lineTo(0.05, 0.13);
  s.lineTo(-0.5, 0.13);
  s.closePath();
  return s;
}

function chevronShape(scale: number): THREE.Shape {
  // A "V" pointing along +x.
  const s = new THREE.Shape();
  const p: number[][] = [
    [0.3, 0],
    [-0.08, 0.32],
    [-0.3, 0.32],
    [0.08, 0],
    [-0.3, -0.32],
    [-0.08, -0.32],
  ];
  p.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

/** Flat geometry lying on the floor, pointing along +X. */
function floorGeometry(shape: THREE.Shape): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Extruded arrow lying in the XZ plane, pointing along -Z ("forward" for a camera). */
function solidArrowGeometry(thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(arrowShape(), {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export class ArScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);

  /** Everything anchored to the building. In WebXR mode this group is re-based onto the XR frame. */
  readonly world = new THREE.Group();

  private building: Building;
  private mpu: number;
  private trail: THREE.InstancedMesh;
  private trailEdge: THREE.InstancedMesh;
  private turnSign: THREE.Group;
  private destPin: THREE.Group;
  private destRing: THREE.Mesh;
  private hud: THREE.Group;
  private hudArrow: THREE.Mesh;
  private floorPlan: THREE.Mesh | null = null;
  private dummy = new THREE.Object3D();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private tmpE = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private targetQuat = new THREE.Quaternion();
  private hasPose = false;
  private lastTime = 0;
  private hudYaw = 0;
  /** State of a running WebXR session: `yaw` rotates map directions into the XR frame. */
  private xr: { yaw: number; aligned: boolean; frames: number } | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(canvas: HTMLCanvasElement, building: Building) {
    this.building = building;
    this.mpu = building.metersPerUnit;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene.add(this.world);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);

    // --- trail of chevrons on the floor (white rim underneath, colour on top)
    const chevron = this.track(floorGeometry(chevronShape(1)));
    const chevronRim = this.track(floorGeometry(chevronShape(1.22)));
    const trailMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: COLOR_ROUTE, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
    );
    const rimMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: COLOR_ROUTE_EDGE, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    );
    this.trailEdge = new THREE.InstancedMesh(chevronRim, rimMaterial, MAX_CHEVRONS);
    this.trail = new THREE.InstancedMesh(chevron, trailMaterial, MAX_CHEVRONS);
    this.trailEdge.renderOrder = 1;
    this.trail.renderOrder = 2;
    this.trail.frustumCulled = false;
    this.trailEdge.frustumCulled = false;
    this.world.add(this.trailEdge, this.trail);

    // --- floating sign at the next turn / staircase
    const signArrow = this.track(solidArrowGeometry(0.1));
    const signMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: COLOR_TURN, emissive: COLOR_TURN, emissiveIntensity: 0.45, roughness: 0.4 })
    );
    this.turnSign = new THREE.Group();
    const sign = new THREE.Mesh(signArrow, signMaterial);
    sign.scale.setScalar(0.8);
    this.turnSign.add(sign);
    this.turnSign.visible = false;
    this.world.add(this.turnSign);

    // --- destination pin
    const pinMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: COLOR_DEST, emissive: COLOR_DEST, emissiveIntensity: 0.5, roughness: 0.35 })
    );
    this.destPin = new THREE.Group();
    const head = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.24, 24, 16)), pinMaterial);
    head.position.y = 0.55;
    const tip = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.2, 0.5, 24)), pinMaterial);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.2;
    this.destPin.add(head, tip);
    this.destRing = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.45, 0.6, 40)),
      this.track(new THREE.MeshBasicMaterial({ color: COLOR_DEST, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
    );
    this.destRing.rotation.x = -Math.PI / 2;
    this.destPin.visible = false;
    this.destRing.visible = false;
    this.world.add(this.destPin, this.destRing);

    // --- guidance arrow that stays in view (attached to the camera)
    this.hud = new THREE.Group();
    this.hud.position.set(0, -0.27, -1.5);
    const hudGeometry = this.track(solidArrowGeometry(0.07));
    this.hudArrow = new THREE.Mesh(
      hudGeometry,
      this.track(new THREE.MeshStandardMaterial({ color: COLOR_ROUTE, emissive: 0x0b6fd0, emissiveIntensity: 0.55, roughness: 0.3 }))
    );
    const hudRim = new THREE.Mesh(
      hudGeometry,
      this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }))
    );
    hudRim.scale.set(1.08, 1.4, 1.06);
    this.hudArrow.add(hudRim);
    this.hudArrow.scale.setScalar(0.44);
    this.hud.add(this.hudArrow);
    this.hud.visible = false;
    this.camera.add(this.hud);
  }

  private track<T extends { dispose: () => void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  /** Draws the floor plan on the ground. Used when there is no camera image behind the overlay. */
  showFloorPlan(imageUrl: string, widthUnits: number, heightUnits: number) {
    if (this.floorPlan) return;
    const texture = this.track(new THREE.TextureLoader().load(imageUrl));
    const w = widthUnits * this.mpu;
    const h = heightUnits * this.mpu;
    const geometry = this.track(new THREE.PlaneGeometry(w, h));
    geometry.rotateX(-Math.PI / 2);
    const material = this.track(new THREE.MeshBasicMaterial({ map: texture }));
    this.floorPlan = new THREE.Mesh(geometry, material);
    this.floorPlan.position.set(w / 2, -0.02, h / 2);
    this.floorPlan.renderOrder = 0;
    // Plain ground around the building so the horizon sits where it should.
    const groundGeometry = this.track(new THREE.PlaneGeometry(600, 600));
    groundGeometry.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeometry, this.track(new THREE.MeshBasicMaterial({ color: 0xb9b3a6 })));
    ground.position.set(w / 2, -0.06, h / 2);
    ground.renderOrder = -1;
    this.world.add(ground, this.floorPlan);
  }

  setSize(width: number, height: number, verticalFovDeg: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = verticalFovDeg;
    this.camera.updateProjectionMatrix();
  }

  /** World position (metres) of a map point. */
  private toWorld(p: { x: number; y: number }, height = 0, target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(p.x * this.mpu, height, p.y * this.mpu);
  }

  /**
   * Camera pose from the tracker (camera-overlay mode).
   * Not used in WebXR mode, where the XR session drives the camera.
   */
  private applyPose(frame: ArFrame, dt: number) {
    if (!frame.position || !frame.cameraToWorld) {
      this.hasPose = false;
      return;
    }
    const m = frame.cameraToWorld;
    // Map world (x, y, down) -> scene (X = x, Y = -down, Z = y); camera axes
    // (x right, y down, z forward) -> Three.js camera axes (x right, y up, z back).
    const basis = new THREE.Matrix4().set(
      m[0], -m[1], -m[2], 0,
      -m[6], m[7], m[8], 0,
      m[3], -m[4], -m[5], 0,
      0, 0, 0, 1
    );
    this.targetQuat.setFromRotationMatrix(basis);
    const target = this.toWorld(frame.position, EYE_HEIGHT);
    if (!this.hasPose) {
      this.camera.quaternion.copy(this.targetQuat);
      this.camera.position.copy(target);
      this.hasPose = true;
    } else {
      // Light smoothing: hides sensor jitter and the jump of each step.
      this.camera.quaternion.slerp(this.targetQuat, 1 - Math.exp(-dt / 0.05));
      this.camera.position.lerp(target, 1 - Math.exp(-dt / 0.3));
    }
  }

  private updateTrail(frame: ArFrame, time: number) {
    const route = frame.route;
    let count = 0;
    if (route && frame.position && !frame.arrived) {
      // The chevrons flow towards the destination.
      const phase = ((time / 1000) * 0.9) % TRAIL_SPACING;
      const floor = frame.position.floor;
      const end = Math.min(route.length, TRAIL_LENGTH);
      for (let s = phase + TRAIL_START; s < end && count < MAX_CHEVRONS; s += TRAIL_SPACING) {
        const p = pointAlongRoute(route, s);
        const leg = route.legs[p.legIndex];
        if (leg.kind !== 'walk') break; // the trail stops at the stairs
        if (p.floor !== floor) break;
        // Grow in at the start, shrink away at the far end.
        const grow = Math.min(1, (s - TRAIL_START) / 1.0);
        const fade = Math.min(1, (end - s) / 2.5);
        const scale = Math.max(0.001, Math.min(grow, fade));
        this.dummy.position.set(p.x * this.mpu, 0.02, p.y * this.mpu);
        this.dummy.rotation.set(0, -leg.dir, 0);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        this.trail.setMatrixAt(count, this.dummy.matrix);
        this.dummy.position.y = 0.015;
        this.dummy.updateMatrix();
        this.trailEdge.setMatrixAt(count, this.dummy.matrix);
        count++;
      }
    }
    this.trail.count = count;
    this.trailEdge.count = count;
    this.trail.instanceMatrix.needsUpdate = true;
    this.trailEdge.instanceMatrix.needsUpdate = true;
  }

  private updateSigns(frame: ArFrame, time: number) {
    const route = frame.route;
    const bob = Math.sin(time / 350) * 0.06;
    // Where the viewer is, in the coordinates of the building group.
    const viewer = this.world.worldToLocal(this.camera.getWorldPosition(this.tmpE));

    // Next turn or floor change on this floor.
    let shown = false;
    if (route && frame.position && !frame.arrived) {
      const next = frame.maneuvers.find((m) => m.type !== 'arrive' && m.type !== 'straight');
      if (next && next.at < 30) {
        const point = route.points[next.pointIndex];
        const leg = route.legs[next.pointIndex];
        if (point && leg && point.floor === frame.position.floor) {
          this.toWorld(point, 1.25 + bob, this.turnSign.position);
          const mesh = this.turnSign.children[0];
          if (leg.kind === 'walk') {
            // A sign pointing into the new corridor, turned so its face is
            // towards the viewer (like a road sign) instead of edge-on.
            const out = this.tmpA.set(Math.cos(leg.dir), 0, Math.sin(leg.dir));
            const toViewer = this.tmpB.copy(viewer).sub(this.turnSign.position).setY(0);
            if (toViewer.lengthSq() < 1e-6) toViewer.set(0, 0, 1);
            toViewer.normalize().setY(0.45);
            const normal = toViewer.addScaledVector(out, -toViewer.dot(out)).normalize();
            const back = this.tmpC.copy(out).negate(); // the arrow geometry points along its -Z
            const side = this.tmpD.crossVectors(normal, back);
            this.turnSign.quaternion.setFromRotationMatrix(this.tmpM.makeBasis(side, normal, back));
            mesh.rotation.set(0, 0, 0);
          } else {
            // Stairs / elevator: an arrow standing upright, pointing up or down, slowly spinning.
            this.turnSign.rotation.set(0, time / 900, 0);
            mesh.rotation.set(leg.to.floor > leg.from.floor ? Math.PI / 2 : -Math.PI / 2, 0, 0);
          }
          // Keep it readable from far away without looming when close.
          // ...and shrink it away once the user is at the spot (the banner and
          // the guidance arrow take over there; a sign at arm's length would fill the view).
          const range = Math.hypot(this.turnSign.position.x - viewer.x, this.turnSign.position.z - viewer.z);
          const near = Math.min(1, Math.max(0, (range - 1.6) / 1.6));
          this.turnSign.scale.setScalar(Math.min(2.2, Math.max(1, range / 6)) * near);
          shown = near > 0.02;
        }
      }
    }
    this.turnSign.visible = shown;

    // Destination.
    const dest = route ? this.building.node(route.destId) : undefined;
    const showDest = !!dest && !!frame.position && dest.floor === frame.position.floor;
    this.destPin.visible = showDest;
    this.destRing.visible = showDest;
    if (dest && showDest) {
      this.toWorld(dest, 1.15 + bob * 1.5, this.destPin.position);
      this.destPin.rotation.y = time / 1200;
      // Up close only the ring on the floor remains.
      const range = Math.hypot(this.destPin.position.x - viewer.x, this.destPin.position.z - viewer.z);
      const near = Math.min(1, Math.max(0, (range - 1.4) / 1.6));
      this.destPin.scale.setScalar(Math.max(0.001, near));
      this.destPin.visible = near > 0.02;
      this.toWorld(dest, 0.03, this.destRing.position);
      const pulse = 1 + 0.25 * (0.5 + 0.5 * Math.sin(time / 300));
      this.destRing.scale.set(pulse, pulse, pulse);
    }
  }

  private updateHud(frame: ArFrame, heading: number | null, dt: number) {
    const route = frame.route;
    if (!route || !frame.position || heading === null || frame.arrived || route.legs.length === 0) {
      this.hud.visible = false;
      return;
    }
    // Aim at a point a little ahead on the route so the arrow starts to swing
    // before a corner instead of snapping at it.
    const ahead = pointAlongRoute(route, Math.min(route.length, 2.5));
    const leg = route.legs[ahead.legIndex];
    let dir = leg.dir;
    const dx = (ahead.x - frame.position.x) * this.mpu;
    const dy = (ahead.y - frame.position.y) * this.mpu;
    if (leg.kind === 'walk' && ahead.floor === frame.position.floor && Math.hypot(dx, dy) > 0.8) {
      dir = Math.atan2(dy, dx);
    } else if (leg.kind !== 'walk') {
      this.hud.visible = false; // at the stairs: the upright sign says it all
      return;
    }
    const relative = angleDiff(dir, heading); // > 0: the route is to the user's right
    this.hudYaw += angleDiff(relative, this.hudYaw) * (1 - Math.exp(-dt / 0.12));
    this.hud.visible = true;
    // Tip the arrow up towards the viewer so its shape reads clearly.
    this.hudArrow.rotation.set(0.55, -this.hudYaw, 0, 'XYZ');
  }

  /* ------------------------------------------------------------------ WebXR */

  /** True while a WebXR session drives the camera. */
  get presenting(): boolean {
    return this.xr !== null;
  }

  /**
   * Hands the camera over to a WebXR `immersive-ar` session. The browser then
   * tracks the phone in 3D (visual-inertial odometry), which is far more
   * precise than counting steps; the building is re-based onto the XR frame at
   * the user's current estimated position and heading.
   */
  async startXR(session: any, onEnd: () => void): Promise<void> {
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.xr = { yaw: 0, aligned: false, frames: 0 };
    session.addEventListener('end', () => {
      this.xr = null;
      this.renderer.xr.enabled = false;
      this.world.position.set(0, 0, 0);
      this.world.rotation.set(0, 0, 0);
      this.hasPose = false;
      onEnd();
    });
  }

  private static xrHeading(camera: THREE.Camera, forward: THREE.Vector3, up: THREE.Vector3): number {
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    return Math.atan2(forward.z + up.z, forward.x + up.x);
  }

  /** Aligns the building with the XR frame and reports where XR tracking puts the user. */
  private updateXr(frame: ArFrame): XrPose | null {
    const xr = this.xr!;
    xr.frames++;
    if (xr.frames < 3) return null; // the first frames have no pose yet
    const k = ArScene.xrHeading(this.camera, this.tmpA, this.tmpB);
    if (!xr.aligned) {
      if (!frame.position || frame.heading === null || frame.heading === undefined) return null;
      // A rotation of the building by `yaw` about the vertical turns a map
      // direction h into the XR direction h - yaw; the user faces `heading`
      // on the map and `k` in XR right now.
      xr.yaw = frame.heading - k;
      this.world.rotation.set(0, xr.yaw, 0);
      this.world.position.set(0, 0, 0);
      this.world.updateMatrixWorld(true);
      const here = this.world.localToWorld(this.toWorld(frame.position, 0, this.tmpC));
      this.world.position.set(
        this.camera.position.x - here.x,
        this.camera.position.y - EYE_HEIGHT, // 'local' space: the origin is at phone height
        this.camera.position.z - here.z
      );
      this.world.updateMatrixWorld(true);
      xr.aligned = true;
    }
    const local = this.world.worldToLocal(this.tmpD.copy(this.camera.position));
    return { x: local.x / this.mpu, y: local.z / this.mpu, heading: k + xr.yaw };
  }

  /**
   * Draws one frame. In WebXR mode it returns the user's pose as tracked by
   * the XR session (to be fed back into the position tracker), otherwise null.
   */
  render(frame: ArFrame, time: number): XrPose | null {
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0.016;
    this.lastTime = time;

    let heading: number | null;
    let posed: boolean;
    let xrPose: XrPose | null = null;
    if (this.xr) {
      xrPose = this.updateXr(frame);
      heading = xrPose ? xrPose.heading : null;
      posed = this.xr.aligned;
    } else {
      this.applyPose(frame, dt);
      heading = frame.cameraToWorld ? headingOf(frame.cameraToWorld) : null;
      posed = this.hasPose;
    }
    this.world.visible = posed;

    this.updateTrail(frame, time);
    this.updateSigns(frame, time);
    this.updateHud(frame, posed ? heading : null, dt);
    this.renderer.render(this.scene, this.camera);
    return xrPose;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    const xrSession: any = this.renderer.xr.getSession();
    if (xrSession) xrSession.end().catch(() => undefined);
    this.disposables.forEach((d) => d.dispose());
    this.trail.dispose();
    this.trailEdge.dispose();
    this.renderer.dispose();
  }
}
