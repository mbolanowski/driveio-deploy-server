"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MyRoom = void 0;
const colyseus_1 = require("colyseus");
const MyRoomState_1 = require("./schema/MyRoomState");
let nextPlayerId = 1; // Start IDs at 1
class MyRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.idPool = new Set(); // Track used IDs
        this.maxPlayers = 4; // Maximum number of players supported
        this.availableIds = []; // Pool of available IDs
        this.tileOwnership = new Map(); // playerId -> Set of "x,y" strings
        this.usedSpawnPoints = new Map();
    }
    onCreate(options) {
        this.setState(new MyRoomState_1.MyRoomState());
        this.resetIdPool();
        this.tileOwnership = new Map();
        this.usedSpawnPoints = new Map();
    }
    getTileKey(x, y) {
        return `${x},${y}`;
    }
    findTileOwner(x, y) {
        const tileKey = this.getTileKey(x, y);
        for (const [playerId, tiles] of this.tileOwnership.entries()) {
            if (tiles.has(tileKey)) {
                return playerId;
            }
        }
        return null;
    }
    getCurrentTileOwnerships() {
        const ownerships = {};
        for (const [playerId, tiles] of this.tileOwnership.entries()) {
            ownerships[playerId] = Array.from(tiles).map(tileKey => {
                const [x, y] = tileKey.split(',').map(Number);
                return { x, y };
            });
        }
        return { ownerships };
    }
    resetIdPool() {
        this.idPool.clear();
        this.availableIds = Array.from({ length: this.maxPlayers }, (_, i) => i + 1);
    }
    getNextAvailableId() {
        if (this.availableIds.length === 0) {
            throw new Error("No available IDs in the pool");
        }
        const id = this.availableIds.shift();
        this.idPool.add(id);
        return id;
    }
    releaseId(id) {
        if (this.idPool.has(id)) {
            this.idPool.delete(id);
            this.availableIds.push(id);
            // Sort to maintain consistent order (optional)
            this.availableIds.sort((a, b) => a - b);
        }
    }
    getAvailableSpawnSpots() {
        const allSpawnSpots = [0, 1, 2, 3];
        const takenSpawnSpots = new Set(this.usedSpawnPoints.values());
        return allSpawnSpots.filter(spot => !takenSpawnSpots.has(spot));
    }
    onJoin(client, options) {
        console.log(client.sessionId, "joined!");
        try {
            // Create a new player for the joined client
            this.state.players.set(client.sessionId, new MyRoomState_1.Player());
            // Assign a new ID from the pool
            const playerId = this.getNextAvailableId();
            // Store the assigned ID with the client's session for later cleanup
            client.playerId = playerId;
            // Initialize empty tile set for new player
            this.tileOwnership.set(playerId.toString(), new Set());
            // Broadcast the tile taking event
            this.broadcast("current_tiles", this.getCurrentTileOwnerships());
            client.send("player_id", { id: playerId });
            client.send("welcomeMessage", "Welcome to Colyseus!");
            this.broadcast("join", { id: client.sessionId });
            this.onMessage("light", (client, position) => {
                this.broadcast("light", {
                    id: Math.floor(position.id),
                    prev: position.prev
                });
            });
            this.onMessage("tileTaken", (client, position) => {
                console.log(position);
                // Find current owner of the tile (if any)
                const previousOwner = this.findTileOwner(position.xx, position.yy);
                const tileKey = this.getTileKey(position.xx, position.yy);
                // If tile was owned, remove it from previous owner
                if (previousOwner) {
                    const previousOwnerTiles = this.tileOwnership.get(previousOwner);
                    if (previousOwnerTiles) {
                        previousOwnerTiles.delete(tileKey);
                    }
                }
                // Add tile to new owner's set
                const newOwnerTiles = this.tileOwnership.get(position.id);
                if (newOwnerTiles) {
                    newOwnerTiles.add(tileKey);
                }
                // Broadcast the tile taking event
                this.broadcast("current_tiles", this.getCurrentTileOwnerships());
            });
            this.onMessage("position", (client, position) => {
                const player = this.state.players.get(client.sessionId);
                player.x = position.x;
                player.z = position.z;
                player.rotationY = position.rotationY;
                this.broadcast("player_position", {
                    id: position.id,
                    x: position.x,
                    z: position.z,
                    rotationY: position.rotationY,
                    rightBlinker: position.rightBlinker,
                    leftBlinker: position.leftBlinker,
                    isHorizontal: position.isHorizontal,
                    hasPriority: position.hasPriority,
                    turning: position.turning,
                    speed: position.speed,
                    entrance: position.entrance,
                    name: position.name
                });
            });
            this.onMessage("car_position", (client, position) => {
                this.broadcast("car_position", {
                    carID: position.carID,
                    x: position.x,
                    z: position.z,
                    rotationY: position.rotationY,
                    rightBlinker: position.rightBlinker,
                    leftBlinker: position.leftBlinker
                });
            });
            this.onMessage("intersection", (client, position) => {
                this.broadcast("intersection", { id: position.id });
            });
            this.onMessage("death", (client, position) => {
                const playerTiles = this.tileOwnership.get(position.id);
                // Clear the player's tile set if it exists
                if (playerTiles) {
                    playerTiles.clear();
                }
                // Broadcast the updated tile ownerships
                this.broadcast("current_tiles", this.getCurrentTileOwnerships());
                this.broadcast("death", { id: position.id });
            });
            this.onMessage("player_leave", (client, position) => {
                //console.log({ position });
                this.broadcast("player_leave", { id: position.id });
            });
            this.onMessage("spawn", (client, position) => {
                this.usedSpawnPoints.set(position.id, position.spawn);
                console.log(`Player ${position.id} assigned spawn point ${position.spawn}.`);
            });
            this.onMessage("spawning", (client, position) => {
                this.broadcast("spawning", { id: this.getAvailableSpawnSpots(), playerID: position.playerID });
            });
        }
        catch (error) {
            console.error("Error during player join:", error);
            client.leave();
        }
    }
    onLeave(client, consented) {
        console.log(client.sessionId, "left!");
        const playerId = client.playerId;
        if (playerId) {
            // Remove player's tile ownership data
            this.tileOwnership.delete(playerId.toString());
            // Free the player's spawn point
            const playerSpawnPoint = this.usedSpawnPoints.get(playerId);
            if (playerSpawnPoint !== undefined) {
                this.usedSpawnPoints.delete(playerId);
                console.log(`Spawn point ${playerSpawnPoint} freed for player ${playerId}.`);
            }
            this.releaseId(playerId);
        }
        this.broadcast("left", { id: client.sessionId });
        this.state.players.delete(client.sessionId);
    }
    onDispose() {
        console.log("room", this.roomId, "disposing...");
        this.resetIdPool();
        this.tileOwnership.clear();
    }
}
exports.MyRoom = MyRoom;
