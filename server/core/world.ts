import fs from 'fs';
import path from 'path';

import chalk from 'chalk';
import { FastifyInstance } from 'fastify';

import { Coords2, Coords3, Helper } from '../../shared';
import { GeneratorTypes } from '../libs';

import { ClientType, Network, NetworkOptionsType, Chunk, Mine, Builder, Chunks } from '.';

const chunkNeighbors = [
  { x: -1, z: -1 },
  { x: 0, z: -1 },
  { x: 1, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: -1, z: 1 },
  { x: 0, z: 1 },
  { x: 1, z: 1 },
];

type WorldOptionsType = NetworkOptionsType & {
  name: string;
  save: boolean;
  time: number;
  tickSpeed: number;
  chunkRoot: string;
  preload: number;
  chunkSize: number;
  dimension: number;
  maxHeight: number;
  renderRadius: number;
  maxLightLevel: number;
  maxLoadedChunks: number;
  useSmoothLighting: boolean;
  generation: GeneratorTypes;
  description: string;
};

class World extends Network {
  public caching = false;
  public storage: string;

  public builder: Builder;

  public chunks: Chunks;
  public chunkCache: Set<Chunk> = new Set();

  public time = 0;
  public tickSpeed = 2;

  private prevTime = Date.now();

  constructor(public app: FastifyInstance, public options: WorldOptionsType) {
    super(options);

    const { save, time, tickSpeed } = options;

    this.time = time;
    this.tickSpeed = tickSpeed;

    this.builder = new Builder(this);
    this.chunks = new Chunks(this);

    console.log(`\nWorld: ${chalk.bgCyan.gray(options.name)}`);
    if (save) this.initStorage();
    this.preloadChunks();

    this.setupRoutes();
    setInterval(this.tick, 16);
    setInterval(() => {
      // mesh chunks per frame
      for (const client of this.clients) {
        const spliced = client.requestedChunks.splice(0, 4);
        const unprepared: Coords2[] = [];

        spliced.forEach((coords) => {
          const chunk = this.chunks.get(coords);

          if (!chunk) {
            unprepared.push(coords);
            return;
          }

          if (chunk.isDirty && !chunk.hasMesh) {
            chunk.remesh();
          }

          this.sendChunks(client, [chunk]);
        });

        const { currentChunk: cc } = client;
        if (cc) {
          const [cx, cz] = cc;
          client.requestedChunks.sort((a, b) => {
            return (cx - a[0]) ** 2 + (cz - a[1]) ** 2 - (cx - b[0]) ** 2 - (cz - b[1]) ** 2;
          });
        }
        client.requestedChunks.push(...unprepared);
      }
    }, 8);
  }

  initStorage = () => {
    // if storage doesn't exist, make directory
    const { chunkRoot, name } = this.options;

    this.storage = path.join(chunkRoot, name);

    if (!fs.existsSync(chunkRoot)) {
      fs.mkdirSync(chunkRoot);
    }

    if (!fs.existsSync(this.storage)) {
      fs.mkdirSync(this.storage);
    }

    console.log(`Storage at ${chalk.yellow(this.storage)}`);

    // save every minute
    setInterval(() => this.save(), 60000);
  };

  preloadChunks = () => {
    const { preload } = this.options;
    this.chunks.preload(preload).then(() => {
      console.log(`Preloaded ${this.chunks.all().length} amount of chunks.\n`);
    });
  };

  setupRoutes = () => {
    // this.app.get()
  };

  startCaching = () => {
    this.caching = true;
  };

  stopCaching = () => {
    this.caching = false;
  };

  clearCache = () => {
    this.chunkCache.clear();
  };

  save = () => {
    if (!this.options.save) return;

    this.chunks.all().forEach((chunk) => {
      if (chunk.needsSaving) {
        chunk.save();
      }
    });
  };

  markForSavingFromVoxel = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    chunk.needsSaving = true;
  };

  getChunkByCPos = (cCoords: Coords2) => {
    const chunk = this.chunks.raw(cCoords);
    if (this.caching && chunk) this.chunkCache.add(chunk);
    return chunk;
  };

  getChunkByVoxel = (vCoords: Coords3) => {
    const { chunkSize } = this.options;
    const chunkCoords = Helper.mapVoxelPosToChunkPos(vCoords, chunkSize);
    return this.getChunkByCPos(chunkCoords);
  };

  getNeighborChunks = (coords: Coords2) => {
    const [cx, cz] = coords;
    const chunks: Chunk[] = [];
    chunkNeighbors.forEach((offset) => {
      chunks.push(this.getChunkByCPos([cx + offset.x, cz + offset.z]));
    });
    return chunks;
  };

  getNeighborChunksByVoxel = (vCoords: Coords3) => {
    const { chunkSize } = this.options;
    const chunk = this.getChunkByVoxel(vCoords);
    const [cx, cz] = Helper.mapVoxelPosToChunkPos(vCoords, chunkSize);
    const [lx, , lz] = Helper.mapVoxelPosToChunkLocalPos(vCoords, chunkSize);
    const neighborChunks: (Chunk | null)[] = [];

    // check if local position is on the edge
    // TODO: fix this hacky way of doing so.
    const a = lx <= 0;
    const b = lz <= 0;
    const c = lx >= chunkSize - 1;
    const d = lz >= chunkSize - 1;

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
    return chunk ? chunk.getVoxel(vCoords) : 0;
  };

  getVoxelByWorld = (wCoords: Coords3) => {
    const vCoords = Helper.mapWorldPosToVoxelPos(wCoords, this.options.dimension);
    return this.getVoxelByVoxel(vCoords);
  };

  getTorchLight = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk?.getTorchLight(vCoords) || 0;
  };

  setTorchLight = (vCoords: Coords3, level: number) => {
    const chunk = this.getChunkByVoxel(vCoords);
    chunk?.setTorchLight(vCoords, level);
  };

  getSunlight = (vCoords: Coords3) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk?.getSunlight(vCoords);
  };

  setSunlight = (vCoords: Coords3, level: number) => {
    const chunk = this.getChunkByVoxel(vCoords);
    return chunk?.setSunlight(vCoords, level);
  };

  getBlockTypeByVoxel = (vCoords: Coords3) => {
    const typeID = this.getVoxelByVoxel(vCoords);
    return Mine.registry.getBlockByID(typeID);
  };

  getBlockTypeByType = (type: number) => {
    return Mine.registry.getBlockByID(type);
  };

  getMaxHeight = (column: Coords2) => {
    const chunk = this.getChunkByVoxel([column[0], 0, column[1]]);
    return chunk?.getMaxHeight(column);
  };

  setMaxHeight = (column: Coords2, height: number) => {
    const chunk = this.getChunkByVoxel([column[0], 0, column[1]]);
    return chunk?.setMaxHeight(column, height);
  };

  getTransparencyByVoxel = (vCoords: Coords3) => {
    return this.getBlockTypeByVoxel(vCoords).isTransparent;
  };

  setVoxel = (voxel: Coords3, type: number) => {
    const chunk = this.getChunkByVoxel(voxel);
    return chunk?.setVoxel(voxel, type);
  };

  update = (voxel: Coords3, type: number) => {
    const { maxHeight } = this.options;
    const [vx, vy, vz] = voxel;

    if (vy < 0 || vy >= maxHeight || !Mine.registry.getBlockByID(type).name) return;

    const chunk = this.getChunkByVoxel(voxel);
    if (chunk.needsPropagation) return;

    const currentType = this.getVoxelByVoxel(voxel);
    if (Mine.registry.isAir(currentType) && Mine.registry.isAir(type)) {
      return;
    }

    this.startCaching();
    chunk.update(voxel, type);
    this.stopCaching();

    const neighborChunks = this.getNeighborChunksByVoxel(voxel);
    neighborChunks.forEach((c) => this.chunkCache.add(c));

    this.broadcast({
      type: 'UPDATE',
      json: { vx, vy, vz, type },
    });

    this.chunkCache.forEach((chunk) => {
      chunk.remesh();
    });

    this.broadcast({
      type: 'UPDATE',
      chunks: Array.from(this.chunkCache).map((c) => c.getProtocol(false)),
    });

    this.clearCache();
  };

  onConfig = (client: ClientType, request) => {
    const { time, tickSpeed } = request.json;

    if (Helper.isNumber(time)) this.time = time;
    if (Helper.isNumber(tickSpeed)) this.tickSpeed = tickSpeed;

    this.broadcast({
      type: 'CONFIG',
      json: request.json,
    });
  };

  onUpdate = (request) => {
    const { x, y, z, type: typeStr } = request.json || {};

    const vx = parseInt(x, 10);
    const vy = parseInt(y, 10);
    const vz = parseInt(z, 10);
    const type = parseInt(typeStr, 10);
    const voxel = <Coords3>[vx, vy, vz];

    // fool proof
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || Number.isNaN(type)) {
      return;
    }

    this.update(voxel, type);
  };

  onPeer = (client: ClientType, request) => {
    const { name, px, py, pz, qx, qy, qz, qw } = request.peers[0];

    if (client) {
      if (!client.name) {
        this.broadcast({
          type: 'MESSAGE',
          message: {
            type: 'INFO',
            body: `${name} joined the game`,
          },
        });
      }

      client.name = name;
      client.position = [px, py, pz];
      client.rotation = [qx, qy, qz, qw];

      const { dimension, chunkSize } = this.options;
      const { currentChunk, position } = client;
      const [cx, cz] = Helper.mapVoxelPosToChunkPos(Helper.mapWorldPosToVoxelPos(position, dimension), chunkSize);

      if (!currentChunk || cx !== currentChunk[0] || cz !== currentChunk[1]) {
        client.currentChunk = [cx, cz];
        this.chunks.generate(client);
      }
    }
  };

  onChatMessage = (request) => {
    this.broadcast({
      type: 'MESSAGE',
      message: request.message,
    });
  };

  onRequest = (client: ClientType, request) => {
    switch (request.type) {
      case 'REQUEST': {
        const { x, z } = request.json;
        client.requestedChunks.push([x, z]);
        break;
      }
      case 'CONFIG': {
        this.onConfig(client, request);
        break;
      }
      case 'UPDATE': {
        this.onUpdate(request);
        break;
      }
      case 'PEER': {
        this.onPeer(client, request);
        break;
      }
      case 'MESSAGE': {
        this.onChatMessage(request);
      }
      default:
        break;
    }
  };

  onInit = (client: ClientType) => {
    client.send(
      Network.encode({
        type: 'INIT',
        json: {
          id: client.id,
          time: this.time,
          tickSpeed: this.tickSpeed,
          spawn: [0, this.getMaxHeight([0, 0]), 0],
          passables: Mine.registry.getPassableSolids(),
        },
      }),
    );
  };

  tick = () => {
    // broadcast player locations
    this.clients.forEach((client) => {
      const encoded = Network.encode({
        type: 'PEER',
        peers: this.clients
          .filter((c) => c !== client && c.position && c.rotation)
          .map(({ position, rotation, id, name }) => {
            const [px, py, pz] = position;
            const [qx, qy, qz, qw] = rotation;
            return {
              id,
              name,
              px,
              py,
              pz,
              qx,
              qy,
              qz,
              qw,
            };
          }),
      });
      client.send(encoded);
    });

    // update time
    this.time = (this.time + (this.tickSpeed * (Date.now() - this.prevTime)) / 1000) % 2400;
    this.prevTime = Date.now();
  };

  sendChunks = (client: ClientType, chunks: Chunk[], type = 'LOAD') => {
    client.send(
      Network.encode({
        type,
        // don't send voxel information if chunk isn't set up
        chunks: chunks.map((c) => c.getProtocol(!c.needsDecoration)),
      }),
    );
  };

  unloadChunks() {
    const { maxLoadedChunks } = this.options;
    const data = this.chunks.data();
    while (data.size > maxLoadedChunks) {
      const [oldestKey, oldestChunk] = data.entries().next().value;
      if (oldestChunk.needsSaving) {
        oldestChunk.save();
      }
      data.delete(oldestKey);
    }
  }
}

export { World, WorldOptionsType };
