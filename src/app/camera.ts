import raycast from 'fast-voxel-raycast';
import { BoxBufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';

import { Engine } from '..';
import { Coords3 } from '../libs';
import { Helper } from '../utils';

type CameraOptionsType = {
  fov: number;
  near: number;
  far: number;
  initPos: [number, number, number];
  minPolarAngle: number;
  maxPolarAngle: number;
  acceleration: number;
  flyingInertia: number;
  reachDistance: number;
  lookBlockScale: number;
  lookBlockLerp: number;
};

const defaultCameraOptions: CameraOptionsType = {
  fov: 75,
  near: 0.1,
  far: 8000,
  initPos: [20, 20, 20],
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  acceleration: 1,
  flyingInertia: 3,
  reachDistance: 32,
  lookBlockScale: 1.02,
  lookBlockLerp: 0.7,
};

class Camera {
  public engine: Engine;
  public threeCamera: PerspectiveCamera;
  public controls: PointerLockControls;

  public options: CameraOptionsType;
  public lookBlock: Coords3 | null = [0, 0, 0];
  public targetBlock: Coords3 | null = [0, 0, 0];

  private acc = new Vector3();
  private vel = new Vector3();
  private movements = {
    up: false,
    down: false,
    left: false,
    right: false,
    front: false,
    back: false,
  };
  private lookBlockMesh: Mesh;

  constructor(engine: Engine, options: Partial<CameraOptionsType> = {}) {
    const { fov, near, far, initPos, lookBlockScale } = (this.options = {
      ...defaultCameraOptions,
      ...options,
    });

    this.engine = engine;

    // three.js camera
    this.threeCamera = new PerspectiveCamera(fov, this.engine.rendering.aspectRatio, near, far);

    // three.js pointerlock controls
    this.controls = new PointerLockControls(this.threeCamera, this.engine.container.canvas);
    this.engine.rendering.scene.add(this.controls.getObject());
    this.engine.container.canvas.onclick = () => this.controls.lock();

    this.controls.getObject().position.set(...initPos);

    window.addEventListener('resize', () => {
      engine.container.fitCanvas();
      engine.rendering.adjustRenderer();

      this.threeCamera.aspect = engine.rendering.aspectRatio;
      this.threeCamera.updateProjectionMatrix();
    });

    document.addEventListener('keydown', this.onKeyDown, false);
    document.addEventListener('keyup', this.onKeyUp, false);

    this.threeCamera.lookAt(new Vector3(0, 0, 0));

    // look block
    engine.on('ready', () => {
      const { dimension } = engine.world.options;
      this.lookBlockMesh = new Mesh(
        new BoxBufferGeometry(dimension * lookBlockScale, dimension * lookBlockScale, dimension * lookBlockScale),
        new MeshBasicMaterial({
          color: 'white',
          alphaTest: 0.2,
          opacity: 0.3,
          transparent: true,
        }),
      );
      this.lookBlockMesh.renderOrder = 100000;

      engine.rendering.scene.add(this.lookBlockMesh);
    });
  }

  onKeyDown = ({ code }: KeyboardEvent) => {
    if (!this.controls.isLocked) return;

    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.movements.front = true;
        break;

      case 'ArrowLeft':
      case 'KeyA':
        this.movements.left = true;
        break;

      case 'ArrowDown':
      case 'KeyS':
        this.movements.back = true;
        break;

      case 'ArrowRight':
      case 'KeyD':
        this.movements.right = true;
        break;

      case 'Space':
        this.movements.up = true;
        break;

      case 'ShiftLeft':
        this.movements.down = true;
        break;
    }
  };

  onKeyUp = ({ code }: KeyboardEvent) => {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.movements.front = false;
        break;

      case 'ArrowLeft':
      case 'KeyA':
        this.movements.left = false;
        break;

      case 'ArrowDown':
      case 'KeyS':
        this.movements.back = false;
        break;

      case 'ArrowRight':
      case 'KeyD':
        this.movements.right = false;
        break;

      case 'Space':
        this.movements.up = false;
        break;

      case 'ShiftLeft':
        this.movements.down = false;
        break;
    }
  };

  tick = () => {
    const { delta } = this.engine.clock;

    const { right, left, up, down, front, back } = this.movements;
    const { acceleration, flyingInertia } = this.options;

    const movementVec = new Vector3();
    movementVec.x = Number(right) - Number(left);
    movementVec.z = Number(front) - Number(back);
    movementVec.normalize();

    const yMovement = Number(up) - Number(down);

    this.acc.x = -movementVec.x * acceleration;
    this.acc.y = yMovement * acceleration;
    this.acc.z = -movementVec.z * acceleration;

    this.vel.x -= this.vel.x * flyingInertia * delta;
    this.vel.y -= this.vel.y * flyingInertia * delta;
    this.vel.z -= this.vel.z * flyingInertia * delta;

    this.vel.add(this.acc.multiplyScalar(delta));
    this.acc.set(0, 0, 0);

    this.controls.moveRight(-this.vel.x);
    this.controls.moveForward(-this.vel.z);

    this.controls.getObject().position.y += this.vel.y;

    this.updateLookBlock();
  };

  get voxel(): Coords3 {
    return Helper.mapWorldPosToVoxelPos(this.position, this.engine.world.options.dimension);
  }

  get position(): Coords3 {
    const { x, y, z } = this.threeCamera.position;
    return [x, y, z];
  }

  get voxelPositionStr() {
    const { voxel } = this;
    return `${voxel[0]} ${voxel[1]} ${voxel[2]}`;
  }

  get lookBlockStr() {
    const { lookBlock } = this;
    return lookBlock ? `${lookBlock[0]} ${lookBlock[1]} ${lookBlock[2]}` : 'None';
  }

  private updateLookBlock() {
    const { world } = this.engine;
    const { dimension } = world.options;
    const { reachDistance, lookBlockLerp } = this.options;

    const camDir = new Vector3();
    const camPos = this.threeCamera.position;
    this.threeCamera.getWorldDirection(camDir);
    camDir.normalize();

    const point: number[] = [];
    const normal: number[] = [];

    const result = raycast(
      (x, y, z) => Boolean(world.getVoxelByWorld([Math.floor(x), Math.floor(y), Math.floor(z)]) !== 0),
      [camPos.x, camPos.y, camPos.z],
      [camDir.x, camDir.y, camDir.z],
      reachDistance * dimension,
      point,
      normal,
    );

    if (!result) {
      // no target
      this.lookBlockMesh.visible = false;
      this.lookBlock = null;
      this.targetBlock = null;
      return;
    }

    this.lookBlockMesh.visible = true;
    const flooredPoint = point.map((n, i) => Math.floor(parseFloat(n.toFixed(3))) - Number(normal[i] > 0));

    const [nx, ny, nz] = normal;
    const newLookBlock = Helper.mapWorldPosToVoxelPos(flooredPoint as Coords3, world.options.dimension);

    if (world.getVoxelByVoxel(newLookBlock) === 0) {
      // this means the look block isn't actually a block
      return;
    }

    const [lbx, lby, lbz] = newLookBlock;
    this.lookBlockMesh.position.lerp(
      new Vector3(
        lbx * dimension + 0.5 * dimension,
        lby * dimension + 0.5 * dimension,
        lbz * dimension + 0.5 * dimension,
      ),
      lookBlockLerp,
    );

    this.lookBlock = newLookBlock;
    // target block is look block summed with the normal
    this.targetBlock = [this.lookBlock[0] + nx, this.lookBlock[1] + ny, this.lookBlock[2] + nz];
  }
}

export { Camera };
