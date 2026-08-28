import { Command } from "commander";

const program = new Command();

program
  .name("queryguard")
  .description("PostgreSQL wire-protocol proxy, N+1 detector, and index advisor")
  .version("0.1.0");

export function runCli(argv = process.argv): void {
  program.parse(argv);
}

if (process.argv[1]?.endsWith("queryguard.js") || process.argv[1]?.endsWith("index.ts")) {
  runCli();
}
