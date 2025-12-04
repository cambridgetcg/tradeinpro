import { createRequestHandler } from "@react-router/express";
import express from "express";

const app = express();

app.use(
  express.static("build/client", {
    immutable: true,
    maxAge: "1y",
  })
);

app.all(
  "/{*splat}",
  createRequestHandler({
    build: () => import("../build/server/index.js"),
    mode: process.env.NODE_ENV,
  })
);

export default app;
