import { DurableObject } from "cloudflare:workers";
import { wordList } from "./wordlist";



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

// Worker
export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method == 'GET' && request.headers.get('Upgrade') == 'websocket') {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/send')) {
        const code = mnemonic();
        let id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName(code);
        let stub = env.MY_DURABLE_OBJECT.get(id);
        const req = new Request(request)
        req.headers.set('Code', code);

        return await stub.fetch(req);
      } else if (url.pathname.endsWith('/receive')) {
        const code = url.searchParams.get('code')
        if (code) {
          let id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName(code);
          let stub = env.MY_DURABLE_OBJECT.get(id);

          return await stub.fetch(request);
        } else {
          return new Response('Missing "code" parameter.', { status: 400 });
        }
      }
      return new Response('You sure you got the path right?', { status: 404 });
    }
    return new Response('Worker expected Upgrade: websocket', { status: 400 });

  },
} satisfies ExportedHandler<Env>;
