import { Room, Client } from "colyseus";
import { MyRoomState, Player } from "./schema/MyRoomState";

// Extend the PositionMessage type to include rotation
export type PositionMessage = {
  id?: string; // Add the client ID to the position message
  carID?: string;
  x: number;
  z: number;
  rotationY: number; // Add the Y-axis rotation
  rightBlinker?: boolean;
  leftBlinker?: boolean;
  isHorizontal?: boolean;
  hasPriority?: boolean;
  turning?: string;
  speed?: number;
  entrance?: number;
  name?: string;
}

export type functionMessage = {
  id?: string; // Add the client ID to the position message
}

export type lightsMessage = {
  id: number; // Add the client ID to the position message
  prev: number;
}

export type tilesMessage = {
  id: string; // Add the client ID to the position message
  xx: number;
  yy: number;
}

export type spawnMessage = {
  id: string;
  spawn: number;
}

export type spawningMessage = {
  id: number[];
  playerID: string;
}

type TileOwnershipMessage = {
  ownerships: {
    [playerId: string]: {
      x: number;
      y: number;
    }[];
  };
};


let nextPlayerId = 1; // Start IDs at 1

export class MyRoom extends Room<MyRoomState> {

  private idPool: Set<number> = new Set(); // Track used IDs
  private maxPlayers: number = 4; // Maximum number of players supported
  private availableIds: number[] = []; // Pool of available IDs

  private tileOwnership: Map<string, Set<string>> = new Map(); // playerId -> Set of "x,y" strings

  private usedSpawnPoints: Map<string, number> = new Map();

  onCreate(options: any) {
    this.setState(new MyRoomState());
    this.resetIdPool();
    this.tileOwnership = new Map();
    this.usedSpawnPoints = new Map();
  }

  private getTileKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private findTileOwner(x: number, y: number): string | null {
    const tileKey = this.getTileKey(x, y);
    for (const [playerId, tiles] of this.tileOwnership.entries()) {
      if (tiles.has(tileKey)) {
        return playerId;
      }
    }
    return null;
  }

  private getCurrentTileOwnerships(): TileOwnershipMessage {
    const ownerships: TileOwnershipMessage['ownerships'] = {};

    for (const [playerId, tiles] of this.tileOwnership.entries()) {
      ownerships[playerId] = Array.from(tiles).map(tileKey => {
        const [x, y] = tileKey.split(',').map(Number);
        return { x, y };
      });
    }
    return { ownerships };
  }

  private resetIdPool() {
    this.idPool.clear();
    this.availableIds = Array.from({ length: this.maxPlayers }, (_, i) => i + 1);
  }

  private getNextAvailableId(): number {
    if (this.availableIds.length === 0) {
      throw new Error("No available IDs in the pool");
    }
    const id = this.availableIds.shift()!;
    this.idPool.add(id);
    return id;
  }

  private releaseId(id: number) {
    if (this.idPool.has(id)) {
      this.idPool.delete(id);
      this.availableIds.push(id);
      // Sort to maintain consistent order (optional)
      this.availableIds.sort((a, b) => a - b);
    }
  }

  private getAvailableSpawnSpots(): number[] {
    const allSpawnSpots = [0, 1, 2, 3];
    const takenSpawnSpots = new Set(this.usedSpawnPoints.values());
    return allSpawnSpots.filter(spot => !takenSpawnSpots.has(spot));
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    try {
      // Create a new player for the joined client
      this.state.players.set(client.sessionId, new Player());

      // Assign a new ID from the pool
      const playerId = this.getNextAvailableId();

      // Store the assigned ID with the client's session for later cleanup
      (client as any).playerId = playerId;

      // Initialize empty tile set for new player
      this.tileOwnership.set(playerId.toString(), new Set());
      // Broadcast the tile taking event
      this.broadcast("current_tiles", this.getCurrentTileOwnerships());

      client.send("player_id", { id: playerId });
      client.send("welcomeMessage", "Welcome to Colyseus!");
      this.broadcast("join", { id: client.sessionId });


      this.onMessage<lightsMessage>("light", (client, position) => {
        this.broadcast("light", {
          id: Math.floor(position.id),
          prev: position.prev
        });
      });

      this.onMessage<tilesMessage>("tileTaken", (client, position) => {
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

      this.onMessage<PositionMessage>("position", (client, position) => {
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

      this.onMessage<PositionMessage>("car_position", (client, position) => {
        this.broadcast("car_position", {
          carID: position.carID,
          x: position.x,
          z: position.z,
          rotationY: position.rotationY,
          rightBlinker: position.rightBlinker,
          leftBlinker: position.leftBlinker
        });
      });

      this.onMessage<functionMessage>("intersection", (client, position) => {
        this.broadcast("intersection", { id: position.id });
      });

      this.onMessage<functionMessage>("death", (client, position) => {
        const playerTiles = this.tileOwnership.get(position.id);

        // Clear the player's tile set if it exists
        if (playerTiles) {
          playerTiles.clear();
        }
        // Broadcast the updated tile ownerships
        this.broadcast("current_tiles", this.getCurrentTileOwnerships());
        this.broadcast("death", { id: position.id });
      });

      this.onMessage<functionMessage>("player_leave", (client, position) => {
        //console.log({ position });
        this.broadcast("player_leave", { id: position.id });
      });

      this.onMessage<spawnMessage>("spawn", (client, position) => {
        this.usedSpawnPoints.set(position.id, position.spawn);
        console.log(`Player ${position.id} assigned spawn point ${position.spawn}.`);
      });

      this.onMessage<spawningMessage>("spawning", (client, position) => {
        this.broadcast("spawning", { id: this.getAvailableSpawnSpots(), playerID: position.playerID });
      });

    } catch (error) {
      console.error("Error during player join:", error);
      client.leave();
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");

    const playerId = (client as any).playerId;
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
