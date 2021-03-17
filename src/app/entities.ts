import { Object3D } from 'three';

import { Engine } from '..';
import { AABB, Brain, EntityType, RigidBody, SmartDictionary } from '../libs';

type EntitiesOptionsType = {
  maxEntities: number;
};

const defaultEntitiesOptions: EntitiesOptionsType = {
  maxEntities: 1000,
};

class Entities {
  public options: EntitiesOptionsType;

  public engine: Engine;

  public list: SmartDictionary<EntityType> = new SmartDictionary();

  constructor(engine: Engine, options: Partial<EntitiesOptionsType> = {}) {
    this.options = {
      ...defaultEntitiesOptions,
      ...options,
    };

    this.engine = engine;
  }

  addEntity(name: string, object: Object3D, size: [number, number, number], options: Partial<RigidBody> = {}) {
    if (this.list.data.length >= this.options.maxEntities)
      throw new Error(`Failed to add entity, ${name}: max entities reached.`);

    const { physics } = this.engine;

    const aabb = new AABB(object.position.toArray(), size);
    const rigidBody = physics.core.addBody({ ...options, aabb });
    const brain = new Brain(rigidBody);

    const newEntity = {
      brain,
      object,
      body: rigidBody,
    };

    this.list.set(name, newEntity);

    return newEntity;
  }

  preTick() {
    this.list.data.forEach((entity) => {
      entity.brain.tick(this.engine.clock.delta);
    });
  }

  tick() {
    this.list.data.forEach((entity) => {
      this.engine.physics.setPositionFromPhysics(entity.body, entity.object);
    });
  }
}

export { Entities };
