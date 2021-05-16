import { IncomingMessage } from 'http';
import path from 'path';

import chalk from 'chalk';
import fastify from 'fastify';
import WebSocket from 'ws';

import { WORLD_LIST } from '../shared/saves';

import { ClientType, Mine } from './core';
import { getQueryWorld } from './utils';

const isProduction = 'production' === process.env.NODE_ENV;

// BASE APP
const app = fastify();
app.register(require('fastify-cors'));
if (isProduction) {
  app.register(require('fastify-static'), {
    root: path.join(__dirname, '..', 'public'),
  });
}

// ATLAS
app.get('/atlas', (_, reply) => {
  reply.header('Content-Type', 'image/png').send(Mine.registry.textureAtlas.canvas.createPNGStream());
});

// WORLD SETUPS
const { WORLDS } = process.env;
if (WORLDS) {
  let worldNames: string[];
  if (WORLDS === '*') worldNames = Object.keys(WORLD_LIST);
  else worldNames = WORLDS.split(',');

  worldNames.forEach((name) => {
    const data = WORLD_LIST[name];
    if (!data) {
      console.log(chalk.red(`World ${name} not found.`));
      return;
    }
    Mine.registerWorld(app, name, data);
  });

  app.get('/worlds', (_, reply) => {
    reply
      .code(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({ worlds: worldNames.map((key) => ({ name: key, ...WORLD_LIST[key] })) });
  });
} else {
  console.log(chalk.red('No worlds loaded!'));
}

app.get('/time', (request, reply) => {
  const world = getQueryWorld(request.raw);
  reply.send(world.time);
});

// MAIN SOCKET HANDLING TRAFFIC
const wss = new WebSocket.Server({ server: app.server });
wss.on('connection', (client: ClientType, request: IncomingMessage) => {
  getQueryWorld(request)?.onConnect(client);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`🚀  Server listening on ${chalk.green(`http://localhost:${port}`)}`);
});
