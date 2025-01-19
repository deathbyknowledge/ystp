import { mnemonic } from "./mnemonic";
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory'
import index from './index.html'
import { Relay } from "./relay";

type Bindings = {
  RELAY: DurableObjectNamespace<Relay>
}

const app = new Hono<{ Bindings: Bindings }>();

const ws = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade != 'websocket')
    return new Response("Expected websocket upgrade", { status: 426 });
  await next();
});

app.on('GET', ['/send', '/receive/*'], ws);

app.get('/send', (c) => {
  const code = mnemonic();
  let id: DurableObjectId = c.env.RELAY.idFromName(code);
  let stub = c.env.RELAY.get(id);

  // Add the code in a header to send to the DO, since it is not available from
  // within the DO instance and we want to send it back in a WS message.
  const req = new Request(c.req.raw)
  req.headers.set('Code', code);
  return stub.fetch(req);
})

app.get('/receive/:code', (c) => {
  const id = c.env.RELAY.idFromName(c.req.param('code'));
  const stub = c.env.RELAY.get(id);
  return stub.fetch(c.req.raw)
})

app.get('/', c => c.html(index))

export default app;
export { Relay };