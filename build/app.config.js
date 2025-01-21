"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tools_1 = __importDefault(require("@colyseus/tools"));
const ws_transport_1 = require("@colyseus/ws-transport");
const monitor_1 = require("@colyseus/monitor");
const playground_1 = require("@colyseus/playground");
// import { RedisDriver } from "@colyseus/redis-driver";
// import { RedisPresence } from "@colyseus/redis-presence";
/**
 * Import your Room files
 */
const MyRoom_1 = require("./rooms/MyRoom");
const auth_1 = __importDefault(require("./config/auth"));
exports.default = (0, tools_1.default)({
    options: {
    // devMode: true,
    // driver: new RedisDriver(),
    // presence: new RedisPresence(),
    },
    initializeTransport: (options) => new ws_transport_1.WebSocketTransport(options),
    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('my_room', MyRoom_1.MyRoom);
    },
    initializeExpress: (app) => {
        /**
         * Bind your custom express routes here:
         */
        app.get("/", (req, res) => {
            res.send(`Instance ID => ${process.env.NODE_APP_INSTANCE ?? "NONE"}`);
        });
        /**
         * Bind @colyseus/monitor
         * It is recommended to protect this route with a password.
         * Read more: https://docs.colyseus.io/tools/monitor/
         */
        app.use("/colyseus", (0, monitor_1.monitor)());
        // Bind "playground"
        app.use("/playground", playground_1.playground);
        // Bind auth routes
        app.use(auth_1.default.prefix, auth_1.default.routes());
    },
    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});
