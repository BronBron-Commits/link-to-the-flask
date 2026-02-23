export class NetworkClient {
  constructor() {
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

  handleMessage(data) {
    // Implement your message handling logic here
    // For example, update game state
    // This should be customized as needed
    console.log("Received message:", data);
  }
}
