import {
  parseAmount, formatAmount, keypairSigner, cosignPreparedTransaction, signPreparedTransaction,
  createFuulRpcServer, claimAuthorizations, createClaimCheck, claimReason, currencyType,
  FactoryContract, readSorobanResourceLimits,
} from "../../src/index.js";
import {
  Account, Asset, Keypair, Operation, TransactionBuilder, StrKey, xdr, Address,
  authorizeEntry, inspectAuthEntry, hash, buildAuthorizationEntryPreimage,
} from "@stellar/stellar-sdk";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function check() {
  assert(globalThis.Buffer === undefined, "Browser test must start without a Buffer global");
  const amount = 9007199254740993n;
  assert(parseAmount(formatAmount(amount)) === amount, "Exact amount roundtrip");
  const key = Keypair.random();
  const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), {
    fee: "100", networkPassphrase: "browser consumer",
  }).addOperation(Operation.payment({
    destination: key.publicKey(), asset: Asset.native(), amount: "1",
  })).setTimeout(60).build();
  const directlySigned = await signPreparedTransaction(tx, keypairSigner(key), 1000n);
  assert(key.verify(directlySigned.hash(), directlySigned.signatures[0]!.signature.toBytes()), "Direct browser transaction signature");
  const signed = await cosignPreparedTransaction(tx, keypairSigner(key), {
    expectedSource: key.publicKey(), maxFeeStroops: 1000n,
    expectedHash: Array.from(tx.hash(), value => value.toString(16).padStart(2, "0")).join(""),
  });
  assert(key.verify(signed.hash(), signed.signatures[0]!.signature.toBytes()), "Browser cosigning signature");

  const manager = StrKey.encodeContract(new Uint8Array(32));
  const claim = createClaimCheck({
    project: manager, to: key.publicKey(), currency: manager,
    currencyType: currencyType.stellarAsset, amount, deadline: 9999999999n,
    reason: claimReason.endUserPayout, proof: new Uint8Array(32), signers: [key.publicKey()],
  });
  const root = xdr.SorobanAuthorizedInvocation.fromXdr(claimAuthorizations(manager, [claim])[0]!.invocation, "base64");
  const entry = new xdr.SorobanAuthorizationEntry({
    rootInvocation: root,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(key.publicKey()).toScAddress(), nonce: 123n,
      signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid(),
    })),
  });
  const auth = await authorizeEntry(entry, key, 200, "browser consumer");
  const signatures = inspectAuthEntry(auth).signers[0]!.signatures;
  assert(signatures?.length, "Missing browser claim signature");
  assert(key.verify(hash(buildAuthorizationEntryPreimage(auth, 200, "browser consumer").toXdr()), signatures[0]!.signature),
    "Browser claim authorization signature");
  const factory = new FactoryContract.Client({
    contractId: manager, networkPassphrase: "browser consumer", rpcUrl: "https://example.invalid",
  });
  assert(factory.spec.funcResToNative("project_wasm_hash", xdr.ScVal.scvBytes(new Uint8Array(32))) instanceof Uint8Array,
    "Browser byte results");
  assert(typeof readSorobanResourceLimits === "function" && !!createFuulRpcServer("https://example.invalid").httpClient,
    "Browser RPC construction");
  assert(globalThis.Buffer === undefined, "SDK must not install a Buffer global");
  return { passed: true, checks: ["amounts", "signing", "cosigning", "claim authorization", "bindings", "RPC", "no Buffer global"] };
}

export default await check();
