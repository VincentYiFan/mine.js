import { EventEmitter } from 'events';

import { Coords2, Coords3 } from '../../shared';
import { AABB, Clouds, ServerChunkType, Sky } from '../libs';
import { Helper } from '../utils';

import { Chunk } from './chunk';
import { Engine } from './engine';

type WorldOptionsType = {
  maxHeight: number;
  chunkSize: number;
  dimension: number;
  renderRadius: number;
  requestRadius: number;
  maxChunkRequestPerFrame: number;
  maxChunkProcessPerFrame: number;
  maxBlockPerFrame: number;
};

class World extends EventEmitter {
  public isReady = false;

  public sky: Sky;
  public clouds: Clouds;

  // uniforms
  public uSunlightIntensity = { value: 0.1 };

  public blockData: { passables: number[] } = {
    passables: [],
  };

  private camChunkName: string;
  private camChunkPos: Coords2;

  private pendingChunks: Coords2[] = [];
  private requestedChunks: Set<string> = new Set();
  private receivedChunks: ServerChunkType[] = [];
  private chunks: Map<string, Chunk> = new Map();

  constructor(public engine: Engine, public options: WorldOptionsType) {
    super();

    this.sky = new Sky(engine.rendering);
    this.clouds = new Clouds(engine.rendering);

    engine.on('ready', () => {
      const { hardwareConcurrency } = window.navigator;
      const renderRadius = Math.max(hardwareConcurrency + 2, 6);

      this.options.renderRadius = renderRadius;
      this.options.requestRadius = renderRadius + 2;
      this.options.maxChunkProcessPerFrame = Math.max(hardwareConcurrency, 3);
      this.options.maxChunkRequestPerFrame = Math.max(hardwareConcurrency, 3);

      this.updateRenderRadius(renderRadius);

      engine.inputs.bind('esc', engine.lock, 'menu', { occasion: 'keyup' });
    });

    engine.on('focus', async () => {
      this.setTime(await engine.network.fetchData('/time'), false);
    });
  }

  tick = () => {
    this.checkCamChunk();
    this.requestChunks();
    this.meshChunks();
    this.animateSky();
  };

  getChunkByCPos = (cCoords: Coords2) => {
    return this.getChunkByName(Helper.getChunkName(cCoords));
  };

  getChunkByName = (chunkName: string) => {
    return this.chunks.get(chunkName);
  };

  getChunkByVoxel = (vCoords: Coords3) => {
    const { chunkSize } = this.options;
    const chunkCoords = Helper.mapVoxelPosToChunkPos(vCoords, chunkSize);
    return this.getChunkByCPos(chunkCoords);
  };

  getNeighborChunksByVoxel = (vCoords: Coords3, padding = 0) => {
    const { chunkSize } = this.options;
    const chunk = this.getChunkByVoxel(vCoords);
    const [cx, cz] = Helper.mapVoxelPosToChunkPos(vCoords, chunkSize);
    const [lx, , lz] = Helper.mapVoxelPosToChunkLocalPos(vCoords, chunkSize);
    const neighborChunks: (Chunk | null)[] = [];

    // check if local position is on the edge
    // TODO: fix this hacky way of doing so.
    const a = lx < padding;
    const b = lz < padding;
    const c = lx >= chunkSize - padding;
    const d = lz >= chunkSize - padding;

    // direct neighbors
    if (a) neighborChunks.push(this.getChunkByCPos([cx - 1, cz]));
    if (b) neighborChunks.push(this.getChunkByCPos([cx, cz - 1]));
    if (c) neighborChunks.push(this.getChunkByCPos([cx + 1, cz]));
    if (d) neighborChunks.push(this.getChunkByCPos([cx, cz + 1]));

    // side-to-side diagonals
    if (a && b) neighborChunks.push(this.getChunkByCPos([cx - 1, cz - 1]));
    if (a && d) neighborChunks.push(this.getChunkByCPos([cx - 1, cz + 1]));
    if (b && c) neighborChunks.push(this.getChunkByCPos([cx + 1, cz - 1]));
    if (c && d) neighborChunks.push(this.getChunkByCPos([cx + 1, cz + 1]));

    return neighborChunks.filter(Boolean).filter((c) => c !== chunk);
  };

  getVoxelByVoxel = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk ? chunk.getVoxel(...vCoords) : null;
  };

  getVoxelByWorld = (wCoords: Coords3) => {
    const vCoords = Helper.mapWorldPosToVoxelPos(wCoords, this.options.dimension);
    return this.getVoxelByVoxel(vCoords);
  };

  getSolidityByVoxel = (vCoords: Coords3) => {
    const type = this.getVoxelByVoxel(vCoords);
    return type !== 0 && !this.blockData.passables.includes(type);
  };

  getFluidityByVoxel = (vCoords: Coords3) => {
    // TODO
    return false;
  };

  getSolidityByWorld = (wCoords: Coords3) => {
    const vCoords = Helper.mapWorldPosToVoxelPos(wCoords, this.options.dimension);
    return this.getSolidityByVoxel(vCoords);
  };

  getFluidityByWorld = (wCoords: Coords3) => {
    const vCoords = Helper.mapWorldPosToVoxelPos(wCoords, this.options.dimension);
    return this.getFluidityByVoxel(vCoords);
  };

  getTorchLight = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk?.getTorchLight(...vCoords) || 0;
  };

  getSunlight = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk?.getSunlight(...vCoords);
  };

  handleServerChunk = (serverChunk: ServerChunkType, prioritized = false) => {
    const { x: cx, z: cz } = serverChunk;
    const coords = [cx, cz] as Coords2;
    this.requestedChunks.delete(Helper.getChunkName(coords));
    if (prioritized) this.receivedChunks.unshift(serverChunk);
    else this.receivedChunks.push(serverChunk);
  };

  setChunk = (chunk: Chunk) => {
    // TODO: remove chunks that are too far away
    return this.chunks.set(chunk.name, chunk);
  };

  setVoxel = (voxel: Coords3, type: number, sideEffects = true) => {
    const [vx, vy, vz] = voxel;
    this.getChunkByVoxel([vx, vy, vz])?.setVoxel(vx, vy, vz, type);

    if (sideEffects) {
      this.engine.network.server.sendEvent({
        type: 'UPDATE',
        json: { x: vx, y: vy, z: vz, type },
      });
    }
  };

  breakVoxel = () => {
    if (this.engine.player.lookBlock) {
      // TODO: use type.air instead of 0
      this.setVoxel(this.engine.player.lookBlock, 0);
    }
  };

  placeVoxel = (type: number) => {
    const { dimension } = this.options;
    const {
      targetBlock,
      entity: {
        body: { aabb },
      },
    } = this.engine.player;
    const blockSize = dimension - 0.05;
    if (targetBlock) {
      const [tx, ty, tz] = targetBlock;
      const offset = (dimension - blockSize) / 2;
      const blockAABB = new AABB([tx + offset, ty + offset, tz + offset], [blockSize, blockSize, blockSize]);
      if (!aabb.intersects(blockAABB)) this.setVoxel(targetBlock, type);
    }
  };

  updateRenderRadius = (renderRadiuus: number) => {
    const { registry } = this.engine;
    const { chunkSize, dimension } = this.options;

    registry.opaqueChunkMaterial.uniforms.uFogNear.value = renderRadiuus * 0.6 * chunkSize * dimension;
    registry.opaqueChunkMaterial.uniforms.uFogFar.value = renderRadiuus * chunkSize * dimension;

    this.checkCamChunk();
    this.surroundCamChunks();
  };

  setTime = (time: number, sideEffect = true) => {
    this.sky.tracker.time = time % 2400;

    // full cycle to sync up the colors
    if (this.engine.tickSpeed !== 0)
      for (let i = 0; i < 2400; i++) {
        this.sky.tick(1 / this.engine.tickSpeed);
      }

    if (sideEffect) {
      this.engine.network.server.sendEvent({
        type: 'CONFIG',
        json: {
          time: this.sky.tracker.time,
        },
      });
    }
  };

  setBlockData = ({ passables }) => {
    if (passables && passables.length) this.blockData.passables = passables;
  };

  sortPendingChunks = () => {
    const [cx, cz] = this.camChunkPos;

    this.pendingChunks.sort((a, b) => (cx - a[0]) ** 2 + (cz - a[1]) ** 2 - (cx - b[0]) ** 2 - (cz - b[1]) ** 2);
  };

  handleReconnection = () => {
    // move requested chunks to pending
    this.pendingChunks.push(...Array.from(this.requestedChunks).map((rc) => Helper.parseChunkName(rc) as Coords2));
    this.sortPendingChunks();
  };

  get camChunkPosStr() {
    return `${this.camChunkPos[0]} ${this.camChunkPos[1]}`;
  }

  private checkCamChunk = () => {
    const { chunkSize, renderRadius } = this.options;

    const pos = this.engine.player.voxel;
    const chunkPos = Helper.mapVoxelPosToChunkPos(pos, chunkSize);
    const chunkName = Helper.getChunkName(chunkPos);

    if (chunkName !== this.camChunkName) {
      this.engine.emit('chunk-changed', chunkPos);

      this.camChunkName = chunkName;
      this.camChunkPos = chunkPos;

      this.surroundCamChunks();
    }

    let supposed = 0;
    const [cx, cz] = this.camChunkPos;
    for (let x = cx - renderRadius; x <= cx + renderRadius; x++) {
      for (let z = cz - renderRadius; z <= cz + renderRadius; z++) {
        const dx = x - cx;
        const dz = z - cz;

        // sphere of chunks around camera effect
        if (dx * dx + dz * dz > renderRadius * renderRadius) continue;

        const chunk = this.getChunkByCPos([x, z]);

        if (chunk) {
          chunk.addToScene();
        }

        supposed++;
      }
    }

    if (!this.isReady && supposed <= this.chunks.size) {
      this.isReady = true;
      this.engine.emit('world-ready');
    }
  };

  private surroundCamChunks = () => {
    const { renderRadius, requestRadius, chunkSize } = this.options;

    const [cx, cz] = this.camChunkPos;

    for (let x = cx - requestRadius; x <= cx + requestRadius; x++) {
      for (let z = cz - requestRadius; z <= cz + requestRadius; z++) {
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > requestRadius * requestRadius) continue;

        const chunk = this.getChunkByCPos([x, z]);

        if (!chunk && !this.requestedChunks.has(Helper.getChunkName([x, z]))) {
          this.pendingChunks.push([x, z]);
        }
      }
    }

    this.pendingChunks = Array.from(new Set(this.pendingChunks.map((pc) => Helper.getChunkName(pc)))).map(
      (pcStr) => Helper.parseChunkName(pcStr) as Coords2,
    );

    // make pending chunks radiate from player, might have easier ways of doing so
    this.sortPendingChunks();

    // if the chunk is too far away, remove from scene.
    const deleteDistance = renderRadius * chunkSize * 1.414;
    const removeDistance = requestRadius * chunkSize * 1.414;
    for (const chunk of this.chunks.values()) {
      const dist = chunk.distTo(...this.engine.player.voxel);
      if (dist > deleteDistance) {
        chunk.removeFromScene();
      }

      if (dist > removeDistance) {
        chunk.dispose();
        this.chunks.delete(chunk.name);
      }
    }
  };

  private requestChunks = () => {
    // separate chunk request into frames to avoid clogging
    if (this.pendingChunks.length === 0 || !this.engine.connected) return;

    const { maxChunkRequestPerFrame } = this.options;

    // don't clog up the server
    if (this.requestedChunks.size < maxChunkRequestPerFrame) {
      const framePendingChunks = this.pendingChunks.splice(0, maxChunkRequestPerFrame);
      framePendingChunks.forEach(([cx, cz]) => {
        const rep = Helper.getChunkName([cx, cz]);
        if (this.requestedChunks.has(rep)) return;
        this.engine.network.server.sendEvent({
          type: 'REQUEST',
          json: { x: cx, z: cz },
        });
        this.requestedChunks.add(rep);
      });
    }
  };

  private meshChunks = () => {
    // separate chunk meshing into frames to avoid clogging
    if (this.receivedChunks.length === 0) return;

    const { maxChunkProcessPerFrame } = this.options;

    const frameReceivedChunks = this.receivedChunks.splice(0, maxChunkProcessPerFrame);
    frameReceivedChunks.forEach((serverChunk) => {
      const { x: cx, z: cz } = serverChunk;
      const coords = [cx, cz] as Coords2;

      let chunk = this.getChunkByCPos(coords);

      if (!chunk) {
        const { chunkSize, dimension, maxHeight } = this.options;
        chunk = new Chunk(this.engine, coords, { size: chunkSize, dimension, maxHeight });
        this.setChunk(chunk);
      }

      const { meshes, voxels, lights } = serverChunk;

      chunk.setupMesh(meshes);
      if (voxels.length) chunk.voxels.data = new Uint8Array(serverChunk.voxels);
      if (lights.length) chunk.lights.data = new Uint8Array(serverChunk.lights);
    });
  };

  private animateSky = () => {
    const { delta } = this.engine.clock;
    this.sky.tick(delta);
    this.clouds.tick(delta);
  };
}

export { World, WorldOptionsType };
