/**
 * Keyless discovery of one Hive account's spare Resource Credit (RC) capacity, as a candidate
 * for RC delegation leasing (delegate_rc custom_json) — see the house glossary term
 * "Resource Credits (RC)" and the 2026-09-26 smart-contracts-on-Hive research note (S5, S7): a
 * real, currently thin, mostly-unbrokered market. This operation only observes; it never signs
 * or proposes a delegation.
 */
import { RpcClient, DEFAULT_NODES } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { normalizeEarningOpportunity } from "@red-cup-engineering/normalize-earning-opportunity-service";

const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;

function validateInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("hive rc-delegation opportunity: input must be an object");
  }
  if (!ACCOUNT.test(input.account ?? "")) {
    throw new TypeError("hive rc-delegation opportunity: invalid public account");
  }
  return Object.freeze({ account: input.account });
}

function nonNegativeInteger(path, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Hive rc_api ${path} must be a non-negative integer`);
  }
  return value;
}

/**
 * Read `rc_api.find_rc_accounts` (a public condenser-family read) and report how much RC the
 * account currently holds idle above what it has already delegated out, as an
 * order-of-magnitude candidate for delegation leasing — not a priced quote, since no established
 * public RC-delegation market rate exists to cite (see the changedRisks and apy.reason below).
 * @param {object} input
 * @param {string} input.account The Hive account to observe.
 * @param {object} [injected]
 * @param {typeof fetch} [injected.fetchImpl]
 * @param {number} [injected.timeoutMs]
 * @param {() => Date} [injected.now]
 * @param {readonly string[]} [injected.nodes]
 * @returns {Promise<object>} A NormalizedEarningOpportunity.
 */
export async function observeHiveRcDelegationOpportunity(input, injected = {}) {
  const { account } = validateInput(input);
  const fetchImpl = injected.fetchImpl ?? fetch;
  const timeoutMs = injected.timeoutMs ?? 15_000;
  const now = injected.now ?? (() => new Date());
  const observedDate = now();
  if (!(observedDate instanceof Date) || !Number.isFinite(observedDate.getTime())) {
    throw new TypeError("hive rc-delegation opportunity: now() must return a valid Date");
  }
  const nodes = injected.nodes ?? DEFAULT_NODES;
  const rpc = new RpcClient({ nodes, fetch: fetchImpl, timeout: timeoutMs });

  const beforeProperties = await rpc.call("condenser_api.get_dynamic_global_properties", []);
  const rcResult = await rpc.call("rc_api.find_rc_accounts", { accounts: [account] });
  const afterProperties = await rpc.call("condenser_api.get_dynamic_global_properties", []);

  const rcAccount = Array.isArray(rcResult?.rc_accounts) ? rcResult.rc_accounts[0] : undefined;
  if (!rcAccount || rcAccount.account !== account) {
    throw new Error(`Hive rc_api.find_rc_accounts returned no row for ${account}`);
  }
  const maxRc = nonNegativeInteger("max_rc", rcAccount.max_rc);
  const currentMana = nonNegativeInteger("rc_manabar.current_mana", rcAccount.rc_manabar?.current_mana);
  const delegatedRc = nonNegativeInteger("delegated_rc", rcAccount.delegated_rc);
  const receivedDelegatedRc = nonNegativeInteger("received_delegated_rc", rcAccount.received_delegated_rc);
  if (currentMana > maxRc) throw new Error("Hive rc_api.find_rc_accounts returned current_mana above max_rc");

  const blockNumber = beforeProperties.head_block_number;
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error("Hive rc_api observation's block boundary is invalid");
  }
  if (afterProperties.head_block_number !== blockNumber) {
    throw new Error("Hive head block advanced during the rc-delegation opportunity observation");
  }

  const provenance = [
    { endpoint: nodes[0], method: "condenser_api.get_dynamic_global_properties", params: [] },
    { endpoint: nodes[0], method: "rc_api.find_rc_accounts", params: { accounts: [account] } },
    { endpoint: nodes[0], method: "condenser_api.get_dynamic_global_properties", params: [] },
  ];

  return normalizeEarningOpportunity({
    id: `hive:rc-delegation:${account}`,
    chain: "hive:mainnet",
    account,
    provider: "Hive Resource Credits (native, no intermediary)",
    mechanism: "delegate idle Resource Credits to another account or app (delegate_rc custom_json) in exchange for a bilaterally negotiated fee -- there is no house or public open market quoting a per-RC lease rate today",
    underlyings: ["RC"],
    apy: {
      availability: "unavailable",
      value: null,
      denomination: "RC per year",
      method: "no established public RC-delegation market rate exists to price against",
      reason: "RC delegation is transacted bilaterally (an app or guild delegating to its own users), not on an open exchange, so no observable clearing price exists",
    },
    liquidity: {
      kind: "resource-credit-manabar",
      capacity: { maxRc: String(maxRc) },
      accountAvailable: {
        currentMana: String(currentMana),
        alreadyDelegatedOut: String(delegatedRc),
        receivedFromOthers: String(receivedDelegatedRc),
        idleAboveDelegated: String(Math.max(0, currentMana - delegatedRc)),
      },
    },
    changedRisks: [
      "delegated RC is unavailable to the delegator for its own transactions until the delegation is reduced or removed",
      "RC delegation removal is believed to carry a return-period cooldown similar to vesting delegation, but the exact cooldown was not independently confirmed this session -- verify against condenser_api/rc_api docs before delegating for real",
      "the delegatee's transaction volume, not the delegator's, determines how quickly delegated RC is drawn down",
      "no counterparty-default protection exists on a bilateral delegation: the delegator cannot force payment for RC already delegated",
    ],
    exit: {
      operation: "delegate_rc custom_json to the same delegatee with a reduced (or zero) max_rc",
      receives: ["RC"],
      constraints: [
        "requires the account's own active or RC-delegation authority",
        "a return-period cooldown may apply before the RC is fully usable again by the delegator (unconfirmed, see changedRisks)",
      ],
    },
    freshness: {
      observedAt: observedDate.toISOString(),
      chainBoundary: { blockNumber },
      provenance,
    },
  });
}
