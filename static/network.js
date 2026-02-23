export class NetworkClient {
  constructor() {
    this.playerId = Math.random().toString(36).substring(2);

    this.socket = new WebSocket("ws://78.138.31.143:8765");

    this.socket.onopen = () => console.log("Connected");

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
  }

  send(data) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  sendPlayerUpdate(playerData) {
    this.send({
      type: "player_update",
      payload: {
        id: this.playerId,
        ...playerData
      }
    });
  }

  handleMessage(data) {
    if (data.type === "player_update") {
      const { id, x, y, facing } = data.payload;

      if (id !== this.playerId) {
        window.remotePlayers = window.remotePlayers || {};
        window.remotePlayers[id] = { x, y, facing };
      }
    }
  }
}
