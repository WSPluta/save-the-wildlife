const path = require("path");
const { merge } = require("webpack-merge");
const portFinderSync = require("portfinder-sync");
const commonConfiguration = require("./webpack.common.js");

const parsedWebPort = parseInt(process.env.WEB_PORT || "8080", 10);
const DEFAULT_WEB_PORT = Number.isFinite(parsedWebPort) ? parsedWebPort : 8080;
const discoveredPort = portFinderSync.getPort(DEFAULT_WEB_PORT);
const DEV_SERVER_PORT = Number.isFinite(discoveredPort) ? discoveredPort : DEFAULT_WEB_PORT;
const WS_PORT = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3000;
const SCORE_PORT = process.env.SCORE_PORT ? parseInt(process.env.SCORE_PORT, 10) : 8082;
const WEB_HOST = process.env.WEB_HOST || "0.0.0.0";

module.exports = merge(commonConfiguration, {
  mode: "development",

  devServer: {
    host: WEB_HOST,
    port: DEV_SERVER_PORT,
    static: [
      {
        directory: path.resolve(__dirname, "../dist"),
        watch: true,
      },
      {
        directory: path.resolve(__dirname, "../static"),
        staticOptions: {},
        publicPath: "/static-public-path/",
        serveIndex: true,
        watch: true,
      },
    ],
    proxy: [
      { context: ["/socket.io"], target: `http://localhost:${WS_PORT}`, ws: true },
      { context: ["/metrics"], target: `http://localhost:${WS_PORT}` },
      { context: ["/api/observability"], target: `http://localhost:${WS_PORT}` },
      { context: ["/api"], target: `http://localhost:${SCORE_PORT}`, ws: true }
    ],
    open: true,
    server: "http",
    allowedHosts: "all",
    historyApiFallback: true,
    setupMiddlewares: (middlewares, devServer) => {
      if (devServer && devServer.app) {
        devServer.app.get("/some/path", function (req, res) {
          res.json({ custom: "response" });
        });
        devServer.app.get("/healthz", function (req, res) {
          res.setHeader("Cache-Control", "no-store");
          res.json({ ok: true, service: "web-dev" });
        });

        // Dev-only fallback to suppress noisy proxy ECONNREFUSED when Score service is disabled
        // This serves an empty leaderboard and prevents /api/top/score from being proxied to :8082.
        if (process.env.START_SCORE !== "1") {
          devServer.app.get("/api/top/score", function (req, res) {
            res.setHeader("Cache-Control", "no-store");
            res.json([]);
          });
        }
      }
      return middlewares;
    },
    client: {
      logging: "info",
      overlay: {
        errors: true,
        warnings: true,
      },
      progress: true,
      reconnect: true,
    },
  },
});
