// Plain WebSocket client for multiplayer sync

// Minimal WebSocket client for multiplayer sync
// Assumes backend is plain WebSocket (not Socket.IO)

const socket = new WebSocket("ws://localhost:8765");

socket.onopen = () => console.log("Connected");

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleMessage(data);
};

function send(data) {
  socket.send(JSON.stringify(data));
}

// Optionally, keep the NetworkClient class if needed for game logic
class NetworkClient {
  constructor(game) {
    this.game = game;
    this.playerId = Math.random().toString(36).substr(2, 9);
    this.setupSocket();
  }

  setupSocket() {
    // socket.onmessage = (event) => {
    //   const data = JSON.parse(event.data);
    //   if (data.type === 'player_update' && data.id !== this.playerId) {
    //     if (!this.game.remotePlayers) this.game.remotePlayers = {};
    //     if (!this.game.remotePlayers[data.id]) {
    //       this.game.remotePlayers[data.id] = {};
    //     }
    //     Object.assign(this.game.remotePlayers[data.id], data);
    // }
  }

  sendPlayerUpdate(player) {
    send({
      type: 'player_update',
      id: this.playerId,
      x: player.x,
      y: player.y,
      facing: player.facing
    });
  }
}
window.NetworkClient = NetworkClient;
console.log('network_socketio.js loaded, window.NetworkClient:', window.NetworkClient);
