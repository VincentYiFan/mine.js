import { Euler, EventDispatcher, Vector3, PerspectiveCamera } from 'three';

const _euler = new Euler(0, 0, 0, 'YXZ');
const _vector = new Vector3();

const _changeEvent = { type: 'change' };
const _lockEvent = { type: 'lock' };
const _unlockEvent = { type: 'unlock' };

const _PI_2 = Math.PI / 2;

class PointerLockControls extends EventDispatcher {
  public isLocked = false;
  public minPolarAngle = 0;
  public maxPolarAngle = Math.PI;

  private lockCallback: () => void;
  private unlockCallback: () => void;

  constructor(public camera: PerspectiveCamera, public domElement: HTMLElement) {
    super();

    this.connect();
  }

  onMouseMove = (event: MouseEvent) => {
    if (this.isLocked === false) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    _euler.setFromQuaternion(this.camera.quaternion);

    _euler.y -= movementX * 0.002;
    _euler.x -= movementY * 0.002;

    _euler.x = Math.max(_PI_2 - this.maxPolarAngle, Math.min(_PI_2 - this.minPolarAngle, _euler.x));

    this.camera.quaternion.setFromEuler(_euler);

    this.dispatchEvent(_changeEvent);
  };

  onPointerlockChange = () => {
    if (this.domElement.ownerDocument.pointerLockElement === this.domElement) {
      this.dispatchEvent(_lockEvent);

      if (this.lockCallback) {
        this.lockCallback();
      }

      this.isLocked = true;
    } else {
      this.dispatchEvent(_unlockEvent);

      if (this.unlockCallback) {
        this.unlockCallback();
      }

      this.isLocked = false;
    }
  };

  onPointerlockError = () => {
    console.error('THREE.PointerLockControls: Unable to use Pointer Lock API');
  };

  connect = () => {
    this.domElement.ownerDocument.addEventListener('mousemove', this.onMouseMove);
    this.domElement.ownerDocument.addEventListener('pointerlockchange', this.onPointerlockChange);
    this.domElement.ownerDocument.addEventListener('pointerlockerror', this.onPointerlockError);
  };

  disconnect = () => {
    this.domElement.ownerDocument.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.ownerDocument.removeEventListener('pointerlockchange', this.onPointerlockChange);
    this.domElement.ownerDocument.removeEventListener('pointerlockerror', this.onPointerlockError);
  };

  dispose = () => {
    this.disconnect();
  };

  getObject = () => {
    return this.camera;
  };

  getDirection = (() => {
    const direction = new Vector3(0, 0, -1);

    return function (v) {
      return v.copy(direction).applyQuaternion(this.camera.quaternion);
    };
  })();

  moveForward = (distance: number) => {
    // move forward parallel to the xz-plane
    // assumes camera.up is y-up

    _vector.setFromMatrixColumn(this.camera.matrix, 0);

    _vector.crossVectors(this.camera.up, _vector);

    this.camera.position.addScaledVector(_vector, distance);
  };

  moveRight = (distance: number) => {
    _vector.setFromMatrixColumn(this.camera.matrix, 0);

    this.camera.position.addScaledVector(_vector, distance);
  };

  lock = (callback?: () => void) => {
    this.domElement.requestPointerLock();

    if (callback) {
      this.lockCallback = callback;
    }
  };

  unlock = (callback?: () => void) => {
    this.domElement.ownerDocument.exitPointerLock();

    if (callback) {
      this.unlockCallback = callback;
    }
  };
}

export { PointerLockControls };
