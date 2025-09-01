const path = require("path");
const { merge } = require("webpack-merge");
const portFinderSync = require("portfinder-sync");
const commonConfiguration = require("./webpack.common.js");

const DEFAULT_WEB_PORT = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT, 10) : 8080;
const WS_PORT = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3000;
const SCORE_PORT = process.env.SCORE_PORT ? parseInt(process.env.SCORE_PORT, 10) : 8082;

module.exports = merge(commonConfiguration, {
  mode: "development",

  devServer: {
    host: "localhost",
    port: portFinderSync.getPort(DEFAULT_WEB_PORT),
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
      { context: ["/api"], target: `http://localhost:${SCORE_PORT}`, ws: true }
    ],
    open: true,
    server: "http",
    allowedHosts: "all",
    setupMiddlewares: (middlewares, devServer) => {
      if (devServer && devServer.app) {
        devServer.app.get("/some/path", function (req, res) {
          res.json({ custom: "response" });
        });
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
