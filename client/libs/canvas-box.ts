import { MathUtils } from 'three';
import {
  BoxBufferGeometry,
  FrontSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RepeatWrapping,
  Side,
  Texture,
} from 'three';

type CanvasBoxOptionsType = {
  gap: number; // gap between layers
  layers: number;
  width: number;
  dimension: number;
  side: Side;
};

type ArtFunction = (mat: MeshBasicMaterial) => void;

type BoxSidesType = 'back' | 'front' | 'top' | 'bottom' | 'left' | 'right' | 'all' | 'sides';

const defaultCanvasBoxOptions: CanvasBoxOptionsType = {
  gap: 0,
  layers: 1,
  width: 8,
  dimension: 1,
  side: FrontSide,
};

const BOX_SIDES = ['back', 'front', 'top', 'bottom', 'left', 'right'];

class Layer {
  public geometry: BoxBufferGeometry;
  public materials: Map<string, MeshBasicMaterial> = new Map();
  public mesh: Mesh;

  constructor(dimension: number, width: number, private side: Side) {
    this.geometry = new BoxBufferGeometry(dimension, dimension, dimension);

    for (const face of BOX_SIDES) {
      this.materials.set(face, this.createCanvasMaterial(width));
    }

    this.mesh = new Mesh(this.geometry, Array.from(this.materials.values()));
    this.mesh.rotation.y = -Math.PI / 2;
  }

  createCanvasMaterial = (width: number) => {
    const canvas = document.createElement('canvas');
    canvas.height = width;
    canvas.width = width;

    const material = new MeshBasicMaterial({
      side: this.side,
      map: new Texture(canvas),
      transparent: true,
    });

    material.map.magFilter = NearestFilter;
    material.map.minFilter = LinearMipMapLinearFilter;
    material.map.wrapS = RepeatWrapping;
    material.map.wrapT = RepeatWrapping;
    material.map.needsUpdate = true;

    return material;
  };

  paint = (side: BoxSidesType[] | BoxSidesType, art: ArtFunction) => {
    const actualSides = Array.isArray(side)
      ? side
      : side === 'all'
      ? BOX_SIDES
      : side === 'sides'
      ? ['front', 'back', 'left', 'right']
      : [side];

    for (const face of actualSides) {
      const material = this.materials.get(face);
      if (!material) continue;
      art(material);

      material.map.needsUpdate = true;
    }
  };
}

class CanvasBox {
  public options: CanvasBoxOptionsType;

  public meshes = new Group();
  public layers: Layer[] = [];

  constructor(options: Partial<CanvasBoxOptionsType> = {}) {
    this.options = {
      ...defaultCanvasBoxOptions,
      ...options,
    };

    this.makeBoxes();
  }

  makeBoxes = () => {
    const { layers, gap, dimension, side, width } = this.options;

    for (let i = 0; i < layers; i++) {
      const newLayer = new Layer(dimension + i * gap * 2, width, side);
      this.layers.push(newLayer);
      this.meshes.add(newLayer.mesh);
    }

    this.meshes.rotation.y = -Math.PI * 0.5;
  };

  paint = (side: BoxSidesType[] | BoxSidesType, art: ArtFunction, layer = 0) => {
    if (layer >= this.layers.length) {
      throw new Error('Canvas box layer does not exist.');
    }

    this.layers[layer].paint(side, art);
  };

  // TODO: fix this ugly code ?
  scaleColor = (() => {
    let m = 1.0;

    return (multiplier: number) => {
      const scale = MathUtils.lerp(m, multiplier, 0.1);
      this.layers.forEach((layer) => {
        layer.materials.forEach((material) => {
          material.color.multiplyScalar((1 / m) * scale);
        });
      });
      m = scale;
    };
  })();

  get mesh() {
    return this.layers[0].mesh;
  }

  get boxMaterials() {
    return this.layers[0].materials;
  }
}

export { BoxSidesType, CanvasBox, CanvasBoxOptionsType };
