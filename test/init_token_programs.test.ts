/**
 * Init instruction tests across both token programs.
 *
 * Init must settle mints owned by the classic SPL Token program and by
 * Token-2022 (OUSD, PYUSD), whether or not the recipient, fee and fee-payer
 * token accounts already exist. Before accepting an existing account it
 * checks that the account belongs to the mint's token program and is held by
 * the expected wallet; accounts it creates in the same call skip that check.
 *
 * Each case starts a fresh bankrun context with a 6-decimal mint, funds the
 * sender's associated token account, optionally pre-creates the other
 * accounts, runs one Init and checks every balance. The Token-2022 mint
 * carries a permanent delegate so its data has extensions, as OUSD's does.
 *
 * Test categories:
 * 1. A new recipient: Init creates the recipient's and fee payer's accounts
 * 2. A repeat payment: every account already exists, with platform and
 *    referrer fees and a network fee
 * 3. The card top-up shape: no fees, a zero network fee, recipient and fee
 *    payer accounts already exist
 * 4. Rejections before any transfer: a mint under a different token program,
 *    a program that is not a token program, and a recipient account held by
 *    another wallet
 */
import test from 'tape';
import { start, ProgramTestContext } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializePermanentDelegateInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  unpackAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { CardProgram } from '../src/card_program';
import { initCardInstruction } from '../src/client';

const PROGRAM_ID = CardProgram.PUBKEY;
const DECIMALS = 6;
const FUNDED = BigInt(1_000_000_000); // 1,000 tokens in the sender's account
const tokens = (n: number) => BigInt(Math.round(n * 10 ** DECIMALS));

/** Position of the recipient's token account in the Init account list. */
const DESTINATION_TOKEN_INDEX = 9;

interface TokenProgram {
  label: string;
  id: PublicKey;
}

const SPL_TOKEN: TokenProgram = { label: 'SPL Token', id: TOKEN_PROGRAM_ID };
const TOKEN_2022: TokenProgram = { label: 'Token-2022', id: TOKEN_2022_PROGRAM_ID };

interface Fixture {
  context: ProgramTestContext;
  program: TokenProgram;
  mint: PublicKey;
  wallet: Keypair;
  destination: PublicKey;
  platform: PublicKey;
  referrer: PublicKey;
}

interface Existing {
  destination?: boolean;
  platform?: boolean;
  referrer?: boolean;
  feePayer?: boolean;
}

interface Payment {
  amount: bigint;
  networkFee?: bigint;
  platformFee?: bigint;
  referrerFee?: bigint;
  /** Token program passed to Init; defaults to the mint's own. */
  tokenProgramId?: PublicKey;
}

let referenceCounter = 0;

/** A unique base58 reference; its decoded bytes seed the stamp PDA. */
function nextReference(): string {
  referenceCounter += 1;
  return bs58.encode(Buffer.from(`PRW-init-${referenceCounter}`));
}

async function send(
  context: ProgramTestContext,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
) {
  const tx = new Transaction();
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.add(...instructions);
  tx.sign(context.payer, ...signers);
  return context.banksClient.tryProcessTransaction(tx);
}

async function sendOrThrow(
  context: ProgramTestContext,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
) {
  const result = await send(context, instructions, signers);
  if (result.result) {
    throw new Error(`setup failed: ${result.result}\n${result.meta?.logMessages.join('\n')}`);
  }
}

function ata(fixture: Pick<Fixture, 'mint' | 'program'>, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(fixture.mint, owner, true, fixture.program.id);
}

/** Starts bankrun with a funded sender and the accounts `existing` asks for. */
async function setup(program: TokenProgram, existing: Existing = {}): Promise<Fixture> {
  const context = await start([{ name: 'card', programId: PROGRAM_ID }], []);
  const payer = context.payer;
  const mint = Keypair.generate();
  const fixture: Fixture = {
    context,
    program,
    mint: mint.publicKey,
    wallet: Keypair.generate(),
    destination: Keypair.generate().publicKey,
    platform: Keypair.generate().publicKey,
    referrer: Keypair.generate().publicKey,
  };

  const extensions = program === TOKEN_2022 ? [ExtensionType.PermanentDelegate] : [];
  const mintLen = getMintLen(extensions);
  const rent = await context.banksClient.getRent();
  const createMint: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: Number(rent.minimumBalance(BigInt(mintLen))),
      programId: program.id,
    }),
  ];
  if (extensions.length > 0) {
    createMint.push(
      createInitializePermanentDelegateInstruction(mint.publicKey, payer.publicKey, program.id),
    );
  }
  createMint.push(
    createInitializeMint2Instruction(mint.publicKey, DECIMALS, payer.publicKey, null, program.id),
  );
  await sendOrThrow(context, createMint, [mint]);

  const createAta = (owner: PublicKey) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata(fixture, owner),
      owner,
      fixture.mint,
      program.id,
    );
  const accounts = [
    createAta(fixture.wallet.publicKey),
    createMintToCheckedInstruction(
      fixture.mint,
      ata(fixture, fixture.wallet.publicKey),
      payer.publicKey,
      FUNDED,
      DECIMALS,
      [],
      program.id,
    ),
  ];
  if (existing.destination) accounts.push(createAta(fixture.destination));
  if (existing.platform) accounts.push(createAta(fixture.platform));
  if (existing.referrer) accounts.push(createAta(fixture.referrer));
  if (existing.feePayer) accounts.push(createAta(payer.publicKey));
  await sendOrThrow(context, accounts);

  return fixture;
}

function initInstruction(fixture: Fixture, reference: string, payment: Payment) {
  const tokenProgramId = (payment.tokenProgramId ?? fixture.program.id).toBase58();
  return initCardInstruction({
    reference,
    feePayer: fixture.context.payer.publicKey.toBase58(),
    wallet: fixture.wallet.publicKey.toBase58(),
    sourceMint: fixture.mint.toBase58(),
    sourceTokenProgramId: tokenProgramId,
    destinationMint: fixture.mint.toBase58(),
    destinationWallet: fixture.destination.toBase58(),
    destinationTokenProgramId: tokenProgramId,
    amount: payment.amount.toString(),
    networkFee: (payment.networkFee ?? BigInt(0)).toString(),
    ...(payment.platformFee
      ? { platformFee: payment.platformFee.toString(), platform: fixture.platform.toBase58() }
      : {}),
    ...(payment.referrerFee
      ? { referrerFee: payment.referrerFee.toString(), referrer: fixture.referrer.toBase58() }
      : {}),
  });
}

/** Balance of `owner`'s associated token account, or null when it doesn't exist. */
async function balance(fixture: Fixture, owner: PublicKey): Promise<bigint | null> {
  const address = ata(fixture, owner);
  const account = await fixture.context.banksClient.getAccount(address);
  if (!account) return null;
  return unpackAccount(address, { ...account, data: Buffer.from(account.data) }, fixture.program.id)
    .amount;
}

async function stampInitialized(fixture: Fixture, reference: string): Promise<boolean> {
  const [stamp] = CardProgram.findStampAccount(reference);
  const account = await fixture.context.banksClient.getAccount(stamp);
  return account !== null && account.owner.equals(PROGRAM_ID) && account.data[0] === 1;
}

/** Runs one Init with the fixture's sender signing and returns the bankrun result. */
async function pay(fixture: Fixture, payment: Payment, reference = nextReference()) {
  const result = await send(
    fixture.context,
    [initInstruction(fixture, reference, payment)],
    [fixture.wallet],
  );
  return { reference, result };
}

function logs(result: { result: string | null; meta: { logMessages: string[] } | null }) {
  return `${result.result}\n${result.meta?.logMessages.join('\n') ?? ''}`;
}

/** Asserts a rejected Init moved nothing and created no stamp. */
async function expectRejected(
  t: test.Test,
  fixture: Fixture,
  outcome: Awaited<ReturnType<typeof pay>>,
  error: RegExp,
) {
  t.ok(outcome.result.result, 'Init should fail');
  t.match(outcome.result.result ?? '', error, `fails with ${error}`);
  t.equal(await balance(fixture, fixture.wallet.publicKey), FUNDED, 'sender keeps every token');
  t.equal(await balance(fixture, fixture.destination), null, 'recipient account not created');
  t.notOk(await stampInitialized(fixture, outcome.reference), 'no stamp created');
}

// ============================================================================
// 1-3. Payments under each token program
// ============================================================================

for (const program of [SPL_TOKEN, TOKEN_2022]) {
  test(`Init (${program.label}): pays a new recipient, creating its and the fee payer's accounts`, async (t) => {
    const fixture = await setup(program);
    const payment = { amount: tokens(100), networkFee: tokens(0.5) };

    const { reference, result } = await pay(fixture, payment);

    t.equal(result.result, null, `Init should succeed: ${logs(result)}`);
    t.equal(
      await balance(fixture, fixture.destination),
      payment.amount,
      'recipient receives the amount',
    );
    t.equal(
      await balance(fixture, fixture.context.payer.publicKey),
      payment.networkFee,
      'fee payer receives the network fee',
    );
    t.equal(
      await balance(fixture, fixture.wallet.publicKey),
      FUNDED - payment.amount - payment.networkFee,
      'sender pays amount + network fee',
    );
    t.ok(await stampInitialized(fixture, reference), 'stamp created');
  });

  test(`Init (${program.label}): repeat payment into existing accounts with platform and referrer fees`, async (t) => {
    const fixture = await setup(program, {
      destination: true,
      platform: true,
      referrer: true,
      feePayer: true,
    });
    const payment = {
      amount: tokens(100),
      networkFee: tokens(0.5),
      platformFee: tokens(1),
      referrerFee: tokens(0.25),
    };

    const { reference, result } = await pay(fixture, payment);

    t.equal(result.result, null, `Init should succeed: ${logs(result)}`);
    t.equal(
      await balance(fixture, fixture.destination),
      payment.amount,
      'recipient receives the amount',
    );
    t.equal(
      await balance(fixture, fixture.platform),
      payment.platformFee,
      'platform receives its fee',
    );
    t.equal(
      await balance(fixture, fixture.referrer),
      payment.referrerFee,
      'referrer receives its fee',
    );
    t.equal(
      await balance(fixture, fixture.context.payer.publicKey),
      payment.networkFee,
      'fee payer receives the network fee',
    );
    t.equal(
      await balance(fixture, fixture.wallet.publicKey),
      FUNDED - payment.amount - payment.networkFee - payment.platformFee - payment.referrerFee,
      'sender pays the amount and every fee',
    );
    t.ok(await stampInitialized(fixture, reference), 'stamp created');
  });

  test(`Init (${program.label}): card top-up shape, no fees and existing recipient and fee payer accounts`, async (t) => {
    const fixture = await setup(program, { destination: true, feePayer: true });
    const payment = { amount: tokens(25) };

    const { reference, result } = await pay(fixture, payment);

    t.equal(result.result, null, `Init should succeed: ${logs(result)}`);
    t.equal(
      await balance(fixture, fixture.destination),
      payment.amount,
      'recipient receives the amount',
    );
    t.equal(
      await balance(fixture, fixture.context.payer.publicKey),
      BigInt(0),
      'fee payer receives nothing',
    );
    t.equal(
      await balance(fixture, fixture.wallet.publicKey),
      FUNDED - payment.amount,
      'sender pays the amount',
    );
    t.ok(await stampInitialized(fixture, reference), 'stamp created');
  });
}

// ============================================================================
// 4. Rejections before any transfer
// ============================================================================

test('Init: rejects a Token-2022 mint passed with the SPL Token program', async (t) => {
  const fixture = await setup(TOKEN_2022);
  const outcome = await pay(fixture, { amount: tokens(10), tokenProgramId: TOKEN_PROGRAM_ID });
  await expectRejected(t, fixture, outcome, /Provided owner is not allowed/);
});

test('Init: rejects a token program that is neither SPL Token nor Token-2022', async (t) => {
  const fixture = await setup(TOKEN_2022);
  const outcome = await pay(fixture, {
    amount: tokens(10),
    tokenProgramId: SystemProgram.programId,
  });
  await expectRejected(t, fixture, outcome, /incorrect program id/i);
});

test('Init: rejects an existing recipient account held by another wallet', async (t) => {
  const fixture = await setup(TOKEN_2022);
  const stranger = Keypair.generate().publicKey;
  await sendOrThrow(fixture.context, [
    createAssociatedTokenAccountIdempotentInstruction(
      fixture.context.payer.publicKey,
      ata(fixture, stranger),
      stranger,
      fixture.mint,
      TOKEN_2022_PROGRAM_ID,
    ),
  ]);

  const reference = nextReference();
  const instruction = initInstruction(fixture, reference, { amount: tokens(10) });
  instruction.keys[DESTINATION_TOKEN_INDEX] = {
    pubkey: ata(fixture, stranger),
    isSigner: false,
    isWritable: true,
  };
  const result = await send(fixture.context, [instruction], [fixture.wallet]);

  await expectRejected(t, fixture, { reference, result }, /Provided owner is not allowed/);
  t.equal(await balance(fixture, stranger), BigInt(0), "stranger's account receives nothing");
});
