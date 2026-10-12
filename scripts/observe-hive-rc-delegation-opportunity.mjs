#!/usr/bin/env node
import { observeHiveRcDelegationOpportunity } from "../src/index.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--account") {
  console.error("usage: observe-hive-rc-delegation-opportunity.mjs --account ACCOUNT");
  process.exitCode = 2;
} else {
  const opportunity = await observeHiveRcDelegationOpportunity({ account: args[1] });
  process.stdout.write(`${JSON.stringify(opportunity, null, 2)}\n`);
}
