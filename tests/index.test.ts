import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// src/index.ts runs at import time: it registers process handlers, launches Telegram, initializes PKC and starts
// the real feed loop from src/feed-bot.ts. Telegram, PKC, the network and the filesystem are mocked.
const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  stop: vi.fn(),
  getMe: vi.fn(),
  sendMessage: vi.fn(),
  pkcFactory: vi.fn(),
  pkcInstance: { on: vi.fn(), destroy: vi.fn(), getCommunity: vi.fn(), createComment: vi.fn(), getComment: vi.fn() },
  fetch: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

vi.mock('tslog', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('telegraf', () => ({
  Scenes: {},
  Telegraf: class {
    telegram = { getMe: mocks.getMe, sendMessage: mocks.sendMessage };
    launch = mocks.launch;
    stop = mocks.stop;
  },
}));

vi.mock('@pkcprotocol/pkc-js', () => ({
  default: mocks.pkcFactory,
  getShortAddress: vi.fn(({ name }: { name: string }) => name.slice(0, 12)),
}));

vi.mock('node-fetch', () => ({ default: mocks.fetch }));

vi.mock('node:fs', () => ({
  readFileSync: (...args: any[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: any[]) => mocks.writeFileSync(...args),
  renameSync: (...args: any[]) => mocks.renameSync(...args),
}));

const CHAT = '-100111';
const PROCESS_EVENTS = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'uncaughtException', 'unhandledRejection'];
const savedEnv = { ...process.env };

let handlers: Map<string, (...args: any[]) => unknown>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function serveCommunityWithPost(cid: string) {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ directories: [{ communityAddress: 'board.eth', directoryCode: 'b', features: { safeForWork: true } }] }),
  });
  mocks.pkcInstance.getCommunity.mockResolvedValue({
    address: 'board.eth',
    posts: { pages: { hot: { comments: [{ cid, title: 'Title', content: 'Body', timestamp: Math.floor(Date.now() / 1000), author: { address: '12D3KooWAuthor' } }] } } },
  });
  mocks.pkcInstance.createComment.mockImplementation(async () => ({
    updatedAt: Math.floor(Date.now() / 1000),
    removed: false,
    update: vi.fn(async () => {}),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'update') listener();
    }),
    removeListener: vi.fn(),
    stop: vi.fn(async () => {}),
  }));
}

async function startBot() {
  vi.resetModules();
  await import('../src/index.js');
  // start() waits 2s for Telegram polling, then initializes PKC and enters the feed loop.
  await vi.advanceTimersByTimeAsync(2_000);
}

async function emit(event: string, ...args: any[]) {
  handlers.get(event)!(...args);
  await vi.advanceTimersByTimeAsync(1_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env = { ...savedEnv, BOT_TOKEN: 'test-token', FEED_BOT_CHAT: CHAT };
  delete process.env.FEED_BOT_GROUP;
  delete process.env.BOT_NAME;

  handlers = new Map();
  const originalOn = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => unknown) => {
    if (!PROCESS_EVENTS.includes(event)) return originalOn(event, handler);
    handlers.set(event, handler);
    return process;
  }) as typeof process.on);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  // Telegram polling keeps running until stop().
  mocks.launch.mockReset().mockImplementation(() => new Promise(() => {}));
  mocks.stop.mockReset();
  mocks.getMe.mockReset().mockResolvedValue({ username: 'test_bot' });
  mocks.sendMessage.mockReset().mockResolvedValue({});
  mocks.pkcFactory.mockReset().mockResolvedValue(mocks.pkcInstance);
  mocks.pkcInstance.on.mockReset();
  mocks.pkcInstance.destroy.mockReset().mockResolvedValue(undefined);
  mocks.pkcInstance.getCommunity.mockReset();
  mocks.pkcInstance.createComment.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ directories: [] }) });
  mocks.readFileSync.mockReset().mockImplementation(() => {
    throw new Error('ENOENT: no such file or directory');
  });
  mocks.writeFileSync.mockReset();
  mocks.renameSync.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

describe('shutdown', () => {
  test('exits with code 0 after SIGTERM', async () => {
    await startBot();

    await emit('SIGTERM');

    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.pkcInstance.destroy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('exits with a failure code when the feed bot fails to start', async () => {
    delete process.env.FEED_BOT_CHAT;

    await startBot();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test.each([
    ['uncaughtException', new Error('boom')],
    ['unhandledRejection', new Error('boom')],
  ])('exits with a failure code after %s', async (event, error) => {
    await startBot();

    await emit(event, error);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('still destroys PKC and exits 0 on SIGTERM when Telegram polling never started', async () => {
    mocks.launch.mockReset().mockRejectedValue(new Error('401: Unauthorized'));
    // Telegraf's stop() throws when polling was never set up.
    mocks.stop.mockImplementation(() => {
      throw new Error('Bot is not running!');
    });
    await startBot();

    await emit('SIGTERM');

    expect(mocks.pkcInstance.destroy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('waits for an in-flight send to be recorded in history.json before exiting', async () => {
    serveCommunityWithPost('QmPost1');
    let releaseSend!: () => void;
    mocks.sendMessage.mockImplementation(() => new Promise((resolve) => (releaseSend = () => resolve({}))));
    await startBot();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await emit('SIGTERM');
    expect(exitSpy).not.toHaveBeenCalled();

    releaseSend();
    await vi.advanceTimersByTimeAsync(100);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(JSON.parse(mocks.writeFileSync.mock.calls.at(-1)![1]).Cids).toEqual(['QmPost1']);
    expect(mocks.renameSync.mock.invocationCallOrder.at(-1)!).toBeLessThan(exitSpy.mock.invocationCallOrder[0]);
  });

  test('stops waiting for a stuck send after the shutdown bound', async () => {
    serveCommunityWithPost('QmPost1');
    mocks.sendMessage.mockImplementation(() => new Promise(() => {}));
    await startBot();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await emit('SIGTERM');
    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.pkcInstance.destroy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
