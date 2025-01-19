import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF
} from "cloudflare:test";
import { it, expect } from "vitest";
// Could import any other source file/function here
import worker from "../src";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const nextMessage = (ws: WebSocket) => {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event.data));
  });
}

it("400 when not a websocket request", async () => {
  const request = new IncomingRequest("http://example.com/send");
  // Create an empty context to pass to `worker.fetch()`
  const ctx = createExecutionContext();
  const response = await SELF.fetch(request, env);
  // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(426);
});

it("WebSocket connects successfully", async () => {
  const request = new IncomingRequest("http://example.com/send", { headers: { Upgrade: 'websocket' } });
  // Create an empty context to pass to `worker.fetch()`
  const ctx = createExecutionContext();
  const response = await SELF.fetch(request, env);
  // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(101);

  const webSocket = response.webSocket;
  expect(webSocket).toBeDefined();

  webSocket?.accept();
  webSocket?.close();
});


it("Sender receives mnemonic", async () => {
  const request = new IncomingRequest("http://example.com/send", { headers: { Upgrade: 'websocket' } });
  // Create an empty context to pass to `worker.fetch()`
  const ctx = createExecutionContext();
  const response = await SELF.fetch(request, env);
  // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(101);

  const webSocket = response.webSocket;
  expect(webSocket).toBeDefined();
  const promise = nextMessage(webSocket!);
  webSocket?.accept();
  const msg = await promise;
  expect(JSON.parse(msg as string)).toHaveProperty('code');


  webSocket?.close();

})

it("Sender and receiver can communicate", async () => {
  let request = new IncomingRequest("http://example.com/send", { headers: { Upgrade: 'websocket' } });
  // Create an empty context to pass to `worker.fetch()`
  const ctx = createExecutionContext();
  let response = await SELF.fetch(request, env);
  // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(101);

  const sender = response.webSocket!;
  expect(sender).toBeDefined();
  const codeMessage = nextMessage(sender)

  sender.accept();
  let msg = await codeMessage;
  const { code } = JSON.parse(msg as string);
  expect(code).toBeDefined();
  sender.send(JSON.stringify({ name: 'don_quixote.txt', size: 2300000 }))

  request = new IncomingRequest(`http://example.com/receive/${code}`, { headers: { Upgrade: 'websocket' } });
  response = await SELF.fetch(request, env);
  const receiver = response.webSocket!;
  const metadataMessage = nextMessage(receiver);
  receiver.accept();
  msg = await metadataMessage;
  console.log(msg);
  const { name, size } = JSON.parse(msg as string);
  expect(name).toBe('don_quixote.txt');
  expect(size).toBe(2300000);
  receiver.send('LET_IT_RIP');
  sender.send('HELLO ');
  sender.send('WORLD!');
  sender.send('EOF');
  const msg1 = await nextMessage(receiver);
  expect(msg1).toBe('HELLO ')
  const msg2 = await nextMessage(receiver);
  expect(msg2).toBe('WORLD!')
  const msg3 = await nextMessage(receiver);
  expect(msg3).toBe('EOF')

  const rclosed = new Promise((resolve) => receiver.addEventListener("close", (event) => resolve(event)));
  const sclosed = new Promise((resolve) => sender.addEventListener("close", (event) => resolve(event)));

  expect(await rclosed).toBeDefined();
  expect(receiver.readyState).toBe(WebSocket.CLOSING);
  expect(await sclosed).toBeDefined();
  expect(sender.readyState).toBe(WebSocket.CLOSING);

  sender.close();
  receiver.close();
});