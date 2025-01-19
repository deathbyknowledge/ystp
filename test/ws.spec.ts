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
  const promise = new Promise((resolve) => {
    webSocket?.addEventListener("message", (event) => resolve(event.data));
  });

  webSocket?.accept();
  const msg = await promise;
  expect(JSON.parse(msg as string)).toHaveProperty('code');


  webSocket?.close();

})

it("Sender and receiver can communicate", async () => {
  const sendReq = new IncomingRequest("http://example.com/send", { headers: { Upgrade: 'websocket' } });
  // Create an empty context to pass to `worker.fetch()`
  const ctx = createExecutionContext();
  const sendRes = await SELF.fetch(sendReq, env);

  // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
  await waitOnExecutionContext(ctx);
  expect(sendRes.status).toBe(101);

  const sender = sendRes.webSocket;
  const codePromise = new Promise((resolve) => {
    sender?.addEventListener("message", (event) => resolve(event.data));
  });

  sender?.accept();
  const codeMsg = await codePromise;
  const { code } = JSON.parse(codeMsg as string);

  const receiveReq = new IncomingRequest(`http://example.com/receive/${code}`, { headers: { Upgrade: 'websocket' } });
  const receiveRes = await SELF.fetch(receiveReq, env);
  expect(receiveRes.status).toBe(101);

  const receiver = receiveRes.webSocket;

  const rPromise = new Promise((resolve) => {
    receiver?.addEventListener("message", (event) => resolve(event.data));
  });

  receiver?.accept();

  const sMsg = 'Hello from sender!';
  sender?.send(sMsg)
  let msg = await rPromise;
  expect(msg).toBe(`[FROM SENDER]: ${sMsg}`)

  const sPromise = new Promise((resolve) => {
    sender?.addEventListener("message", (event) => resolve(event.data));
  });

  const rMsg = 'Hello from receiver!';
  receiver?.send(rMsg)
  msg = await sPromise;
  expect(msg).toBe(`[FROM RECEIVER]: ${rMsg}`)

  // Close connections
  sender?.close();
  receiver?.close();
});