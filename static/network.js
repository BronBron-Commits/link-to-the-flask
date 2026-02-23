export class NetworkClient {
    sendAttack(data) {
      this.send({
        type: "attack",
        payload: {
          id: window.playerId,
          ...data
        }
      });
    }
  constructor() {
    // Use localhost for local testing
    this.socket = new WebSocket("ws://localhost:8765");
    this.socket.onopen = () => console.log("Connected");
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
  }

  send(data) {
    this.socket.send(JSON.stringify(data));
  }

  sendPlayerUpdate(playerData) {
    const data = {
      type: "player_update",
      ...playerData
    };
    this.send(data);
  }

  handleMessage(data) {
    if (data.type === "attack") {
      const { id, attackType, dx, dy, power } = data.payload || {};
      if (id !== window.playerId && window.remotePlayers && window.remotePlayers[id]) {
        const rp = window.remotePlayers[id];
        const dpr = window.devicePixelRatio || 1;
        const logicalW = window.canvas.width / dpr;
        const logicalH = window.canvas.height / dpr;
        const camera = window.camera || {x:0, y:0};
        // Spawn at remote player's screen position
        const worldX = rp.x + 38;
        const worldY = rp.y + 26;
        if (attackType === "normal") {
          window.castAttack(worldX, worldY, dx, dy, {
            speed:22, life:1, rangeTiles:6, scaleBoost:1, trailCount:5
          });
        }
        if (attackType === "shotgun") {
          window.castShotgun(worldX, worldY, dx, dy);
        }
        if (attackType === "charged") {
          window.castAttack(worldX, worldY, dx, dy, {
            speed: 30 + power*70,
            life: 1.2 + power*1.4,
            rangeTiles: 7 + Math.round(power*6),
            scaleBoost: 1.8 + power*1.6,
            trailCount:7
          });
        }
      }
    } else if (data.type === "player_update") {
      // Use a unique id for each player (e.g., data.id)
      if (!data.id) return; // Ignore if no id
      if (!window.remotePlayers) window.remotePlayers = {};
      window.remotePlayers[data.id] = {
        x: data.x,
        y: data.y,
        facing: data.facing,
        health: data.health,
        energy: data.energy,
        activeWeapon: data.activeWeapon,
        characterType: data.characterType || "wizard",
        robeColor: getGlobalRobeColorForId(data.id),
        name: typeof data.name === 'string' ? data.name : ''
      };

// Deterministic robe color for each player id (robe)
function getGlobalRobeColorForId(id) {
  const palette = ["#5b2fa0", "#6a3dad", "#7c52c7", "#a884ff", "#2fa05b", "#ad3d6a", "#c7c752", "#ff84a8"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
    } else if (data.type === "ultimate") {
      const { id } = data.payload || {};
      if (id !== window.playerId && window.remotePlayers && window.remotePlayers[id]) {
        const rp = window.remotePlayers[id];
        const worldX = rp.x + 38;
        const worldY = rp.y + 26;
        window.triggerUltimateBurst(worldX, worldY);
      }
    } else {
      console.log("Received message:", data);
    }
  }
}

export function sendAttack(x, y, dx, dy, opts = {}) {
  // Deprecated: use networkClient.sendAttack instead
}

export function sendShotgun(x, y, dx, dy) {
  const data = {
    type: "shotgun",
    id: window.playerId,
    x,
    y,
    dx,
    dy
  };
  const client = window.networkClient || null;
  if (client) client.send(data);
}

