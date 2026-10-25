// A very small Socket.IO v4 client over Node's built-in WebSocket, so the tests need no extra
// dependency. Speaks just enough of the protocol: connect (with auth), emit with ack, receive events.
class SocketClient {
  constructor(url, { auth, headers } = {}) {
    this.events = [];
    this.waiters = [];
    this.acks = new Map();
    this.nextAck = 0;
    this.state = "connecting";
    this.error = null;
    const wsUrl = `${url.replace(/^http/, "ws")}/socket.io/?EIO=4&transport=websocket`;
    this.ws = new WebSocket(wsUrl, headers ? { headers } : undefined);
    this.ready = new Promise(resolve => {
      this.settle = resolve;
    });
    this.ws.addEventListener("message", event => this.onMessage(String(event.data), auth));
    this.ws.addEventListener("close", () => {
      if (this.state === "connecting") this.state = "closed";
      this.settle(this);
    });
    this.ws.addEventListener("error", () => {});
  }

  onMessage(frame, auth) {
    if (frame[0] === "0") {
      // Engine.IO open: ask to join the default namespace, sending the auth payload.
      this.ws.send(`40${auth ? JSON.stringify(auth) : ""}`);
    } else if (frame === "2") {
      this.ws.send("3");
    } else if (frame.startsWith("40")) {
      this.state = "connected";
      this.settle(this);
    } else if (frame.startsWith("44")) {
      this.state = "rejected";
      this.error = JSON.parse(frame.slice(2)).message;
      this.settle(this);
    } else if (frame.startsWith("42")) {
      const [name, ...args] = JSON.parse(frame.slice(2));
      this.events.push({ name, args });
      this.waiters = this.waiters.filter(waiter => !waiter(name, args));
    } else if (frame.startsWith("43")) {
      const match = frame.slice(2).match(/^(\d+)(.*)$/);
      const resolve = this.acks.get(Number(match[1]));
      if (resolve) resolve(JSON.parse(match[2])[0]);
    }
  }

  /** Emits an event and resolves with the server's acknowledgement. */
  emit(name, ...args) {
    const id = this.nextAck++;
    return new Promise(resolve => {
      this.acks.set(id, resolve);
      this.ws.send(`42${id}${JSON.stringify([name, ...args])}`);
    });
  }

  /** Emits without waiting for an acknowledgement. */
  send(name, ...args) {
    this.ws.send(`42${JSON.stringify([name, ...args])}`);
  }

  /** Resolves with the args of the next `name` event, or null after `ms`. */
  next(name, ms = 400) {
    const already = this.events.findIndex(event => event.name === name);
    if (already >= 0) return Promise.resolve(this.events.splice(already, 1)[0].args);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), ms);
      this.waiters.push((eventName, args) => {
        if (eventName !== name) return false;
        clearTimeout(timer);
        const index = this.events.findIndex(event => event.name === name);
        if (index >= 0) this.events.splice(index, 1);
        resolve(args);
        return true;
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

module.exports = { SocketClient };
