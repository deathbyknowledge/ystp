import { DurableObject } from "cloudflare:workers";

enum Step {
  Created,
  WaitingMetadata,
  WaitingReceiver,
  WaitingApproval,
  Transfer
}

/*
  Steps:
  1. (Created) DO is created. Sender has successfully upgraded 
     protocol to WebSocket. DO sends the first message with the
     session code.
  2. (WaitingMetadata) DO is waiting for sender to send the file
      metadata.
  3. (WaitingReceiver) DO is waiting for receiver's approval to
     start transfer.
  4. (Transfer) Transfer has started and all incoming messages 
     from sender are relayed to the receiver.
*/

// Durable Object
export class Relay extends DurableObject<Env> {
  private _sender?: WebSocket;
  private _receiver?: WebSocket;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept WebSocket and set appropriate tag so we can find it later.
    if (request.url.endsWith('/send')) {
      if (await this.currentStep() != Step.Created) {
        return new Response('Session has already been created.', { status: 423, webSocket: client, });
      }
      this.ctx.acceptWebSocket(server, ['sender']);

      // Send mnemonic as first message
      this.ctx.waitUntil(new Promise(res => {
        server.send(JSON.stringify({ code: request.headers.get('Code') }));
        res(null);
      }))

      // Ready to receive metadata through WS.
      this.setStep(Step.WaitingMetadata);

    } else {
      if (await this.currentStep() != Step.WaitingReceiver) {
        return new Response('Session is not ready, try again later.', { status: 423, webSocket: client, });
      }
      this.ctx.acceptWebSocket(server, ['receiver']);

      // Send metadata as first message
      const metadata = await this.ctx.storage.get('metadata');
      this.ctx.waitUntil(new Promise(res => {
        server.send(JSON.stringify(metadata));
        res(null);
      }))

      // Ready to receive approval through WS.
      this.setStep(Step.WaitingApproval);
    }

    // Return the client connection with 101 Switching Protocols.
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async currentStep(): Promise<Step> {
    return (await this.ctx.storage.get('step') as Step) || Step.Created;
  }

  async setStep(step: Step) {
    this.ctx.storage.put('step', step);
  }

  sender(): WebSocket {
    if (this._sender) return this._sender; // Not sure if getWebSockets is cached
    const [sender] = this.ctx.getWebSockets('sender');
    this._sender = sender;
    return sender;
  }

  receiver(): WebSocket {
    if (this._receiver) return this._receiver;
    const [receiver] = this.ctx.getWebSockets('receiver');
    this._receiver = receiver;
    return receiver;
  }

  shutdown() {
    this.receiver().close();
    this.sender().close();
    this.ctx.storage.deleteAll();
  }

  async handleSenderMessage(message: ArrayBuffer | string) {
    switch (await this.currentStep()) {
      // Sender sends file metadata
      case Step.WaitingMetadata: {
        if (typeof message == 'string') {
          const { name, size } = JSON.parse(message);
          await this.ctx.storage.put('metadata', { name, size })
          this.setStep(Step.WaitingReceiver);
        }
        break;
      }
      // Sender sends chunk
      case Step.Transfer: {
        if (typeof message == 'string' && message == "EOF") {
          this.receiver().send(message);
          this.shutdown();
        } else {
          this.receiver().send(message);
        }
        break;
      }
    }
  }

  async handleReceiverMessage(message: ArrayBuffer | string) {
    switch (await this.currentStep()) {
      // Receiver sends approval to start transfer.
      case Step.WaitingApproval: {
        if (typeof message == 'string' && message == 'LET_IT_RIP') {
          await this.setStep(Step.Transfer);
          this.sender().send(message);
        }
        break;
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const [tag] = this.ctx.getTags(ws);
    switch (tag) {
      case 'sender': this.handleSenderMessage(message); break;
      case 'receiver': this.handleReceiverMessage(message); break;
    }
  }

  webSocketClose(ws: WebSocket): void | Promise<void> {
    const [tag] = this.ctx.getTags(ws);
    switch (tag) {
      case 'sender': this.sender().close(); break;
      case 'receiver': this.shutdown(); break;
    }
  }
}