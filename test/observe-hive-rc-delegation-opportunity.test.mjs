import assert from "node:assert/strict";
import test from "node:test";
import { observeHiveRcDelegationOpportunity } from "../src/index.mjs";

const NOW = "2026-09-26T19:00:00.000Z";

function fakeFetch({ headBlockNumber = 110257574, rcAccount }) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    let reply;
    if (body.method === "condenser_api.get_dynamic_global_properties") {
      reply = { result: { head_block_number: headBlockNumber } };
    } else if (body.method === "rc_api.find_rc_accounts") {
      reply = { result: { rc_accounts: rcAccount === undefined ? [] : [rcAccount] } };
    } else {
      throw new Error(`unmocked method ${body.method}`);
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  };
}

test("reports idle RC above what is already delegated out, from a real-shaped rc_api row", async () => {
  const opportunity = await observeHiveRcDelegationOpportunity(
    { account: "michael561" },
    {
      now: () => new Date(NOW),
      fetchImpl: fakeFetch({
        rcAccount: {
          account: "michael561",
          rc_manabar: { current_mana: 4898778148, last_update_time: 1790450430 },
          max_rc: 6707858976,
          delegated_rc: 37315965610,
          received_delegated_rc: 1618000000,
        },
      }),
    },
  );

  assert.equal(opportunity.type, "NormalizedEarningOpportunity");
  assert.equal(opportunity.id, "hive:rc-delegation:michael561");
  assert.equal(opportunity.apy.availability, "unavailable");
  assert.equal(opportunity.apy.value, null);
  assert.equal(opportunity.liquidity.accountAvailable.currentMana, "4898778148");
  assert.equal(opportunity.liquidity.accountAvailable.alreadyDelegatedOut, "37315965610");
  // delegated_rc here exceeds current_mana, so idle-above-delegated floors at zero rather than going negative.
  assert.equal(opportunity.liquidity.accountAvailable.idleAboveDelegated, "0");
  assert.equal(opportunity.freshness.chainBoundary.blockNumber, 110257574);
});

test("idleAboveDelegated is the positive remainder when current mana exceeds what is already delegated out", async () => {
  const opportunity = await observeHiveRcDelegationOpportunity(
    { account: "emsenn0" },
    {
      now: () => new Date(NOW),
      fetchImpl: fakeFetch({
        rcAccount: {
          account: "emsenn0",
          rc_manabar: { current_mana: 1043551998465, last_update_time: 1790448987 },
          max_rc: 1043641042700,
          delegated_rc: 0,
          received_delegated_rc: 0,
        },
      }),
    },
  );
  assert.equal(opportunity.liquidity.accountAvailable.idleAboveDelegated, "1043551998465");
});

test("refuses an invalid account name", async () => {
  await assert.rejects(() => observeHiveRcDelegationOpportunity({ account: "NOT-VALID" }), TypeError);
});

test("refuses when rc_api returns no row for the requested account", async () => {
  await assert.rejects(
    () =>
      observeHiveRcDelegationOpportunity(
        { account: "michael561" },
        { now: () => new Date(NOW), fetchImpl: fakeFetch({ rcAccount: undefined }) },
      ),
    /returned no row/,
  );
});

test("refuses when the head block advances mid-observation", async () => {
  let call = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    let reply;
    if (body.method === "condenser_api.get_dynamic_global_properties") {
      call += 1;
      reply = { result: { head_block_number: call === 1 ? 100 : 101 } };
    } else {
      reply = { result: { rc_accounts: [{ account: "michael561", rc_manabar: { current_mana: 1, last_update_time: 0 }, max_rc: 1, delegated_rc: 0, received_delegated_rc: 0 }] } };
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  await assert.rejects(
    () => observeHiveRcDelegationOpportunity({ account: "michael561" }, { now: () => new Date(NOW), fetchImpl }),
    /head block advanced/,
  );
});
