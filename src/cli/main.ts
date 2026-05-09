#!/usr/bin/env node
import { AgentPackError } from "../core/errors.js";
import { configureProgram } from "./agent-pack.js";

configureProgram()
  .parseAsync(process.argv)
  .catch((error) => {
    if (error instanceof AgentPackError) {
      console.error(`agent-pack: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
