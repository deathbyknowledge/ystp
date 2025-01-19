import { DurableObject } from "cloudflare:workers";
import { wordList } from "./wordlist";
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory'


// Durable Object
export class MyDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    // Get WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    // Accept WebSocket and set appropriate tag so we can find it later.
    if (request.url.endsWith('/send')) {
      this.ctx.acceptWebSocket(server, ['sender']);
      // Send mnemonic as first message
      this.ctx.waitUntil(new Promise(res => {
        server.send(JSON.stringify({ code: request.headers.get('Code') }));
        res(null);
      }))
    } else {
      this.ctx.acceptWebSocket(server, ['receiver']);
    }

    // Return the client connection with 101 Switching Protocols.
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  handleSender(message?: ArrayBuffer | string) {
    const [receiver] = this.ctx.getWebSockets('receiver');
    receiver.send(`[FROM SENDER]: ${message}`)
  }

  handleReceiver(message?: ArrayBuffer | string) {
    const [sender] = this.ctx.getWebSockets('sender');
    sender.send(`[FROM RECEIVER]: ${message}`)
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const [tag] = this.ctx.getTags(ws);
    switch (tag) {
      case 'sender': this.handleSender(message); break;
      case 'receiver': this.handleReceiver(message); break;
    }
  }
}

const mnemonic = () => {
  const MNEMONIC_LEN = 5;
  const words = [];
  for (let i = 0; i < MNEMONIC_LEN; i++) {
    words.push(wordList[Math.floor(Math.random() * (wordList.length - 1))])
  }

  return words.join('-');
};

type Bindings = {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>
}

const app = new Hono<{ Bindings: Bindings }>();


// WS Middleware
const ws = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade != 'websocket')
    return new Response("Exepected websocket upgrade", { status: 426 });
  await next();
});

app.on('GET', ['/send', '/receive/*'], ws);

app.get('/send', (c) => {
  const code = mnemonic();
  let id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName(code);
  let stub = c.env.MY_DURABLE_OBJECT.get(id);
  const req = new Request(c.req.raw)
  req.headers.set('Code', code);
  return stub.fetch(req);
})

app.get('/receive/:code', (c) => {
  const id = c.env.MY_DURABLE_OBJECT.idFromName(c.req.param('code'));
  const stub = c.env.MY_DURABLE_OBJECT.get(id);
  return stub.fetch(c.req.raw)
})

export default app;