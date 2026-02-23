import asyncio
import websockets

clients = set()

async def handler(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            for client in clients:
                if client != websocket:
                    await client.send(message)
    finally:
        clients.remove(websocket)

async def main():
    async with websockets.serve(handler, "localhost", 8765):
        print("WebSocket server running on ws://0.0.0.0:8765")
        await asyncio.Future()

asyncio.run(main())
