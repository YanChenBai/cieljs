import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

console.log({
  isTTY: stdin.isTTY,
  readable: stdin.readable,
  readableEnded: stdin.readableEnded,
  destroyed: stdin.destroyed,
});

const rl = createInterface({
  input: stdin,
  output: stdout,
});

while (true) {
  const value = await rl.question("> ");
  console.log("input:", value);
}
