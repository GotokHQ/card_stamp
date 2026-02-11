/**
 * Comprehensive tests for the CloseStamp instruction on the Card program
 * (cardWhHWcRsRMGw2xoudhYKtby35TD3sCQTGTSHGtrg)
 *
 * Since the Init instruction requires a full token transfer setup
 * (mints, ATAs, funded wallets), we use bankrun's addAccount to directly
 * inject stamp PDA accounts for CloseStamp testing. This isolates the
 * close logic and tests all security invariants.
 *
 * Production convention: the `destination` for reclaimed rent should always be
 * the FEE_PAYER wallet, since it is the one that originally paid the rent
 * when creating the stamp via InitCard. The on-chain program is flexible
 * and accepts any destination, but the backend enforces this convention.
 *
 * Test categories:
 * 1. Happy path — close a valid stamp and reclaim rent to fee payer
 * 2. Double-close protection
 * 3. Authority / signer checks
 * 4. Ownership checks (reject non-program-owned accounts)
 * 5. Uninitialized stamp rejection
 * 6. Multiple stamp reclamation
 * 7. PDA derivation consistency
 */
import test from 'tape';
import { start, ProgramTestContext } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  AccountInfo,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { CardProgram } from '../src/card_program';
import { closeStampInstruction } from '../src/client';
import { CloseStampArgs } from '../src/transactions';

const PROGRAM_ID = CardProgram.PUBKEY;

// Minimum rent for a 1-byte account (stamp)
// This is approximately 890,880 lamports but bankrun will use the runtime's value.
// We use a generous amount when injecting test accounts.
const STAMP_RENT_LAMPORTS = 1_000_000;

/**
 * Helper: create a base58-encoded reference from a string
 * Mirrors the production encoding: bs58.encode(Buffer.from(prefix + id))
 */
function makeReference(id: string): string {
  return bs58.encode(Buffer.from(id));
}

/**
 * Helper: derive the stamp PDA for a given reference
 */
function findStamp(reference: string): [PublicKey, number] {
  return CardProgram.findStampAccount(reference);
}

/**
 * Helper: create raw account data for an initialized stamp (1 byte, is_initialized = true)
 */
function makeStampData(initialized: boolean): Buffer {
  const buf = Buffer.alloc(1);
  buf[0] = initialized ? 1 : 0;
  return buf;
}

/**
 * Helper: start bankrun with pre-injected stamp accounts.
 * We inject stamp PDA accounts directly rather than going through Init,
 * because Init requires a full token transfer setup.
 */
async function startWithStamps(stamps: Array<{ reference: string; initialized?: boolean }>) {
  const accounts: Array<{ address: PublicKey; info: { lamports: number; data: Buffer; owner: PublicKey; executable: boolean } }> = [];

  for (const s of stamps) {
    const [pda] = findStamp(s.reference);
    const initialized = s.initialized !== undefined ? s.initialized : true;
    accounts.push({
      address: pda,
      info: {
        lamports: STAMP_RENT_LAMPORTS,
        data: makeStampData(initialized),
        owner: PROGRAM_ID,
        executable: false,
      },
    });
  }

  return start(
    [{ name: 'card', programId: PROGRAM_ID }],
    accounts,
  );
}

// ============================================================================
// 1. Happy Path — rent reclaimed to fee payer
// ============================================================================

test('CloseStamp: successfully closes a stamp and reclaims rent to fee payer wallet', async (t) => {
  const reference = makeReference('PRW-closetest00000001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;
  const [stampPda] = findStamp(reference);

  // In production, the fee payer (FEE_PAYER_PUB_KEY) is a separate wallet that
  // originally paid the rent when creating the stamp via InitCard.
  // Here we simulate that with a dedicated feePayer keypair.
  const feePayer = Keypair.generate();

  // Verify stamp exists before close
  const stampBefore = await client.getAccount(stampPda);
  t.ok(stampBefore, 'Stamp PDA should exist before close');
  t.equal(stampBefore!.owner.toBase58(), PROGRAM_ID.toBase58(), 'Stamp should be owned by program');
  t.equal(stampBefore!.data[0], 1, 'Stamp should be initialized');
  t.equal(Number(stampBefore!.lamports), STAMP_RENT_LAMPORTS, 'Stamp should have rent lamports');

  // Verify fee payer destination starts empty (no SOL yet)
  const feePayerBefore = await client.getAccount(feePayer.publicKey);
  t.equal(feePayerBefore, null, 'Fee payer destination should not exist yet');

  // Close the stamp — rent goes to fee payer
  const ix = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: feePayer.publicKey.toBase58(),
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await client.processTransaction(tx);

  // Verify stamp is gone
  const stampAfter = await client.getAccount(stampPda);
  t.equal(stampAfter, null, 'Stamp PDA should not exist after close');

  // Verify fee payer received the rent
  const feePayerAfter = await client.getAccount(feePayer.publicKey);
  t.ok(feePayerAfter, 'Fee payer should now have an account');
  t.equal(
    Number(feePayerAfter!.lamports),
    STAMP_RENT_LAMPORTS,
    `Fee payer should have received exactly ${STAMP_RENT_LAMPORTS} lamports (rent reclaimed)`,
  );

  t.end();
});

test('CloseStamp: rent adds to existing fee payer balance', async (t) => {
  const reference = makeReference('PRW-existdest00000001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;
  const [stampPda] = findStamp(reference);

  // In production the fee payer already has SOL (it pays for all tx fees).
  // Here we simulate that by using the test payer (which has SOL) as the
  // fee payer destination — rent should be added to its existing balance.
  const feePayerBefore = await client.getAccount(payer.publicKey);
  const feePayerLamportsBefore = feePayerBefore!.lamports;

  const ix = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: payer.publicKey.toBase58(),
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await client.processTransaction(tx);

  const feePayerAfter = await client.getAccount(payer.publicKey);
  // Fee payer should have gained STAMP_RENT_LAMPORTS minus tx fees
  const netGain = Number(feePayerAfter!.lamports) - Number(feePayerLamportsBefore);
  t.ok(netGain > 0, `Fee payer should have a net gain (got ${netGain} lamports after fees)`);
  t.ok(
    netGain > STAMP_RENT_LAMPORTS - 100_000, // Allow for tx fee
    'Net gain should be approximately the stamp rent minus transaction fee',
  );

  t.end();
});

// ============================================================================
// 2. Double-close Protection
// ============================================================================

test('CloseStamp: cannot close the same stamp twice', async (t) => {
  const reference = makeReference('CWD-doubleclose0001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;

  // First close — should succeed
  const ix1 = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: payer.publicKey.toBase58(),
  });

  const tx1 = new Transaction();
  tx1.add(ix1);
  tx1.recentBlockhash = context.lastBlockhash;
  tx1.feePayer = payer.publicKey;
  tx1.sign(payer);
  await client.processTransaction(tx1);

  // Second close — should fail
  const ix2 = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: payer.publicKey.toBase58(),
  });

  const tx2 = new Transaction();
  tx2.add(ix2);
  tx2.recentBlockhash = context.lastBlockhash;
  tx2.feePayer = payer.publicKey;
  tx2.sign(payer);

  try {
    await client.processTransaction(tx2);
    t.fail('Second CloseStamp should have failed');
  } catch (err) {
    t.pass('Second CloseStamp correctly rejected (double-close protection)');
  }

  t.end();
});

// ============================================================================
// 3. Authority / Signer Checks
// ============================================================================

test('CloseStamp: authority must be a signer', async (t) => {
  const reference = makeReference('PRW-nosigner0000001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;
  const fakeAuthority = Keypair.generate();
  const [stampPda] = findStamp(reference);

  // Build instruction manually with isSigner=false to simulate missing signature
  const data = CloseStampArgs.serialize({});
  const closeIx: TransactionInstruction = {
    keys: [
      { pubkey: fakeAuthority.publicKey, isSigner: false, isWritable: false },
      { pubkey: stampPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  };

  const tx = new Transaction();
  tx.add(closeIx);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  try {
    await client.processTransaction(tx);
    t.fail('CloseStamp without authority signature should fail');
  } catch (err) {
    t.pass('CloseStamp correctly rejected: authority is not a signer (MissingRequiredSignature)');
  }

  // Verify stamp is still intact
  const stampAfter = await client.getAccount(stampPda);
  t.ok(stampAfter, 'Stamp should still exist after failed close');
  t.equal(stampAfter!.data[0], 1, 'Stamp should still be initialized');

  t.end();
});

test('CloseStamp: any valid signer can close (authority is not hardcoded)', async (t) => {
  const reference = makeReference('PRW-anysigner000001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;
  const randomAuthority = Keypair.generate();
  const [stampPda] = findStamp(reference);

  // Fund the random authority so it can pay for the tx
  const fundIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: randomAuthority.publicKey,
    lamports: LAMPORTS_PER_SOL,
  });
  const fundTx = new Transaction();
  fundTx.add(fundIx);
  fundTx.recentBlockhash = context.lastBlockhash;
  fundTx.feePayer = payer.publicKey;
  fundTx.sign(payer);
  await client.processTransaction(fundTx);

  // Close with a completely different signer
  const ix = closeStampInstruction({
    authority: randomAuthority.publicKey.toBase58(),
    reference,
    destination: randomAuthority.publicKey.toBase58(),
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = randomAuthority.publicKey;
  tx.sign(randomAuthority);
  await client.processTransaction(tx);

  const stampAfter = await client.getAccount(stampPda);
  t.equal(stampAfter, null, 'Stamp should be closed by any valid signer');
  t.pass('Security model confirmed: any signer can close (security relies on reference secrecy)');

  t.end();
});

// ============================================================================
// 4. Ownership Checks
// ============================================================================

test('CloseStamp: rejects account not owned by the program', async (t) => {
  const context = await start(
    [{ name: 'card', programId: PROGRAM_ID }],
    [],
  );
  const client = context.banksClient;
  const payer = context.payer;

  // Create a system-owned account (not a program stamp)
  const fakeStamp = Keypair.generate();
  const fundIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: fakeStamp.publicKey,
    lamports: STAMP_RENT_LAMPORTS,
  });
  const fundTx = new Transaction();
  fundTx.add(fundIx);
  fundTx.recentBlockhash = context.lastBlockhash;
  fundTx.feePayer = payer.publicKey;
  fundTx.sign(payer);
  await client.processTransaction(fundTx);

  // Try to close it via CloseStamp (manually pointing at the fake account)
  const data = CloseStampArgs.serialize({});
  const closeIx: TransactionInstruction = {
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: fakeStamp.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  };

  const closeTx = new Transaction();
  closeTx.add(closeIx);
  closeTx.recentBlockhash = context.lastBlockhash;
  closeTx.feePayer = payer.publicKey;
  closeTx.sign(payer);

  try {
    await client.processTransaction(closeTx);
    t.fail('CloseStamp should reject accounts not owned by the program');
  } catch (err) {
    t.pass('CloseStamp correctly rejected: account not owned by program (IllegalOwner)');
  }

  // Verify the fake account still has its lamports
  const fakeAfter = await client.getAccount(fakeStamp.publicKey);
  t.ok(fakeAfter, 'Fake account should still exist');
  t.equal(Number(fakeAfter!.lamports), STAMP_RENT_LAMPORTS, 'Fake account lamports should be unchanged');

  t.end();
});

// ============================================================================
// 5. Uninitialized Stamp Rejection
// ============================================================================

test('CloseStamp: rejects uninitialized stamp account', async (t) => {
  const reference = makeReference('PRW-uninit000000001');
  // Inject a stamp PDA with is_initialized = false
  const context = await startWithStamps([{ reference, initialized: false }]);
  const client = context.banksClient;
  const payer = context.payer;
  const [stampPda] = findStamp(reference);

  // Verify the stamp exists but is uninitialized
  const stampBefore = await client.getAccount(stampPda);
  t.ok(stampBefore, 'Stamp PDA should exist');
  t.equal(stampBefore!.data[0], 0, 'Stamp should NOT be initialized');

  // Try to close it
  const ix = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: payer.publicKey.toBase58(),
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  try {
    await client.processTransaction(tx);
    t.fail('CloseStamp should reject uninitialized stamps');
  } catch (err) {
    t.pass('CloseStamp correctly rejected: stamp is not initialized (UninitializedAccount)');
  }

  // Stamp should still exist
  const stampAfter = await client.getAccount(stampPda);
  t.ok(stampAfter, 'Uninitialized stamp should still exist after failed close');

  t.end();
});

test('CloseStamp: rejects non-existent stamp (no account at PDA)', async (t) => {
  const context = await start(
    [{ name: 'card', programId: PROGRAM_ID }],
    [],
  );
  const client = context.banksClient;
  const payer = context.payer;

  const reference = makeReference('PRW-noexist000000001');

  const ix = closeStampInstruction({
    authority: payer.publicKey.toBase58(),
    reference,
    destination: payer.publicKey.toBase58(),
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  try {
    await client.processTransaction(tx);
    t.fail('CloseStamp on non-existent stamp should fail');
  } catch (err) {
    t.pass('CloseStamp correctly rejected: stamp PDA does not exist');
  }

  t.end();
});

// ============================================================================
// 6. Multiple Stamp Reclamation
// ============================================================================

test('CloseStamp: close multiple stamps sequentially, all rent reclaimed to fee payer', async (t) => {
  const refs = [
    makeReference('PRW-batch0000000001'),
    makeReference('CWD-batch0000000002'),
    makeReference('PRW-batch0000000003'),
  ];

  const context = await startWithStamps(refs.map((r) => ({ reference: r })));
  const client = context.banksClient;
  const payer = context.payer;
  // Simulate the fee payer wallet as the destination for all reclaimed rent
  const feePayerWallet = Keypair.generate();

  // Close all stamps one by one, sending rent to fee payer
  for (const reference of refs) {
    const ix = closeStampInstruction({
      authority: payer.publicKey.toBase58(),
      reference,
      destination: feePayerWallet.publicKey.toBase58(),
    });
    const tx = new Transaction();
    tx.add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    await client.processTransaction(tx);
  }

  // Verify all stamps are gone
  for (const reference of refs) {
    const [pda] = findStamp(reference);
    const account = await client.getAccount(pda);
    t.equal(account, null, `Stamp for ref should be closed`);
  }

  // Verify fee payer received all rent from all stamps
  const feePayerAccount = await client.getAccount(feePayerWallet.publicKey);
  t.ok(feePayerAccount, 'Fee payer wallet should have an account');
  t.equal(
    Number(feePayerAccount!.lamports),
    STAMP_RENT_LAMPORTS * refs.length,
    `Fee payer should have received ${STAMP_RENT_LAMPORTS * refs.length} total lamports (${refs.length} stamps)`,
  );

  t.end();
});

test('CloseStamp: close multiple stamps in a single transaction (batched), rent to fee payer', async (t) => {
  const refs = [
    makeReference('PRW-singletx000001'),
    makeReference('CWD-singletx000002'),
  ];

  const context = await startWithStamps(refs.map((r) => ({ reference: r })));
  const client = context.banksClient;
  const payer = context.payer;
  // Simulate the fee payer wallet as the destination for all reclaimed rent
  const feePayerWallet = Keypair.generate();

  // Build a single transaction with multiple close instructions, all to fee payer
  const tx = new Transaction();
  for (const reference of refs) {
    const ix = closeStampInstruction({
      authority: payer.publicKey.toBase58(),
      reference,
      destination: feePayerWallet.publicKey.toBase58(),
    });
    tx.add(ix);
  }
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await client.processTransaction(tx);

  // Verify all stamps are gone
  for (const reference of refs) {
    const [pda] = findStamp(reference);
    const account = await client.getAccount(pda);
    t.equal(account, null, `Stamp should be closed in batch tx`);
  }

  // Verify fee payer received all rent from the batch
  const feePayerAccount = await client.getAccount(feePayerWallet.publicKey);
  t.ok(feePayerAccount, 'Fee payer wallet should have an account');
  t.equal(
    Number(feePayerAccount!.lamports),
    STAMP_RENT_LAMPORTS * refs.length,
    `Fee payer should have received ${STAMP_RENT_LAMPORTS * refs.length} total lamports from batch`,
  );

  t.end();
});

// ============================================================================
// 7. PDA Derivation Consistency
// ============================================================================

test('PDA derivation: PRW and CWD references produce different PDAs', async (t) => {
  const orderId = 'abc123def456ghij7890'; // 20-char Firestore-style ID
  const prwRef = makeReference(`PRW-${orderId}`);
  const cwdRef = makeReference(`CWD-${orderId}`);

  const [prwPda] = findStamp(prwRef);
  const [cwdPda] = findStamp(cwdRef);

  t.notEqual(prwPda.toBase58(), cwdPda.toBase58(), 'PRW and CWD should produce different PDAs');

  t.end();
});

test('PDA derivation: is deterministic', async (t) => {
  const reference = makeReference('PRW-deterministic001');

  const [pda1] = findStamp(reference);
  const [pda2] = findStamp(reference);
  const [pda3] = findStamp(reference);

  t.equal(pda1.toBase58(), pda2.toBase58(), 'PDA should be deterministic (1 == 2)');
  t.equal(pda2.toBase58(), pda3.toBase58(), 'PDA should be deterministic (2 == 3)');

  t.end();
});

test('PDA derivation: reference roundtrip is correct', async (t) => {
  const orderId = 'xY9kLm2nPqRsT7uVwZ';
  const prwPrefix = 'PRW-';
  const cwdPrefix = 'CWD-';

  const prwRef = makeReference(`${prwPrefix}${orderId}`);
  const cwdRef = makeReference(`${cwdPrefix}${orderId}`);

  // Decode and verify
  const prwDecoded = Buffer.from(bs58.decode(prwRef)).toString();
  t.equal(prwDecoded, `${prwPrefix}${orderId}`, 'PRW reference should roundtrip correctly');

  const cwdDecoded = Buffer.from(bs58.decode(cwdRef)).toString();
  t.equal(cwdDecoded, `${cwdPrefix}${orderId}`, 'CWD reference should roundtrip correctly');

  t.end();
});

// ============================================================================
// 8. Edge Cases
// ============================================================================

test('CloseStamp: cannot use stamp PDA as destination (self-close)', async (t) => {
  const reference = makeReference('PRW-selfclose000001');
  const context = await startWithStamps([{ reference }]);
  const client = context.banksClient;
  const payer = context.payer;
  const [stampPda] = findStamp(reference);

  // Try to close the stamp to itself
  const data = CloseStampArgs.serialize({});
  const closeIx: TransactionInstruction = {
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: stampPda, isSigner: false, isWritable: true },
      { pubkey: stampPda, isSigner: false, isWritable: true }, // destination = stamp itself
    ],
    programId: PROGRAM_ID,
    data,
  };

  const tx = new Transaction();
  tx.add(closeIx);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  try {
    await client.processTransaction(tx);
    t.fail('Self-close should be rejected');
  } catch (err) {
    t.pass('CloseStamp correctly rejected: stamp cannot be its own destination (InvalidArgument)');
  }

  t.end();
});
