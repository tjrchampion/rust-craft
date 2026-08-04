import type { ClientMsg, ServerMsg } from "@rustcraft/shared";

export type ServerMsgHandler = (msg: ServerMsg) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private handlers = new Set<ServerMsgHandler>();
  private closedByUs = false;

  onMessage(handler: ServerMsgHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(characterId: string, wsUrl: string): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "join", characterId }));
      };
      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(e.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === "welcome") resolve();
        for (const handler of this.handlers) handler(msg);
      };
      ws.onerror = () => reject(new Error("Connection failed"));
      ws.onclose = () => {
        this.ws = null;
        if (!this.closedByUs) {
          for (const handler of this.handlers) {
            handler({ t: "error", message: "__disconnected__" });
          }
        }
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.closedByUs = true;
    this.ws?.close(1000, "bye");
    this.ws = null;
  }
}
