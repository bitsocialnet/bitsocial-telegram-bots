import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockFetch, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('../src/index.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  plebbit: {},
}));

vi.mock('@plebbit/plebbit-js', () => ({
  getShortAddress: vi.fn((addr: string) => `${addr.slice(0, 12)}...`),
}));

vi.mock('node-fetch', () => ({ default: mockFetch }));

vi.mock('node:fs', () => ({
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

import { fetchCommunities, getChatIds, sendMediaToChat, loadOldPosts, savePosts, startFeedBot, _getProcessedCids, _resetState } from '../src/feed-bot.js';
import type { BotConfig, CommunityInfo } from '../src/types.js';

function makeMockBot() {
  return {
    telegram: {
      sendPhoto: vi.fn().mockResolvedValue({}),
      sendVideo: vi.fn().mockResolvedValue({}),
      sendAudio: vi.fn().mockResolvedValue({}),
      sendAnimation: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

function makeMockConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    name: 'test-bot',
    clientName: 'TestClient',
    clientBaseUrl: 'https://test.app',
    listUrl: 'https://example.com/list.json',
    parseCommunities: vi.fn((data: any) => data.communities || []),
    getPostUrl: vi.fn((c: CommunityInfo, cid: string) => `https://test.app/#/${c.address}/${cid}`),
    getPostButtons: vi.fn((c: CommunityInfo, cid: string) => [{ text: 'View', url: `https://test.app/#/${c.address}/${cid}` }]),
    getCommunityLabel: vi.fn((c: CommunityInfo) => c.address),
    filterNsfw: false,
    ...overrides,
  };
}

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  _resetState();
  process.env = { ...savedEnv };
  delete process.env.FEED_BOT_CHAT;
  delete process.env.FEED_BOT_GROUP;
  delete process.env.BOT_TOKEN;
});

// ---------------------------------------------------------------------------
// getChatIds
// ---------------------------------------------------------------------------
describe('getChatIds', () => {
  test('returns both IDs when both env vars are set', () => {
    process.env.FEED_BOT_CHAT = '-100111';
    process.env.FEED_BOT_GROUP = '-100222';
    expect(getChatIds()).toEqual(['-100111', '-100222']);
  });

  test('returns only FEED_BOT_CHAT when only it is set', () => {
    process.env.FEED_BOT_CHAT = '-100111';
    expect(getChatIds()).toEqual(['-100111']);
  });

  test('returns only FEED_BOT_GROUP when only it is set', () => {
    process.env.FEED_BOT_GROUP = '-100222';
    expect(getChatIds()).toEqual(['-100222']);
  });

  test('returns empty array when neither is set', () => {
    expect(getChatIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadOldPosts / savePosts
// ---------------------------------------------------------------------------
describe('loadOldPosts', () => {
  test('loads CIDs from history file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ Cids: ['cid1', 'cid2', 'cid3'] }));

    loadOldPosts();

    expect(mockReadFileSync).toHaveBeenCalledWith('history.json', 'utf8');
    const cids = _getProcessedCids();
    expect(cids.size).toBe(3);
    expect(cids.has('cid1')).toBe(true);
    expect(cids.has('cid2')).toBe(true);
    expect(cids.has('cid3')).toBe(true);
  });

  test('handles missing history file (ENOENT)', () => {
    const error = new Error('ENOENT: no such file or directory');
    mockReadFileSync.mockImplementation(() => {
      throw error;
    });

    loadOldPosts();

    expect(_getProcessedCids().size).toBe(0);
  });

  test('handles corrupt JSON in history file', () => {
    mockReadFileSync.mockReturnValue('not valid json{{{');

    loadOldPosts();

    expect(_getProcessedCids().size).toBe(0);
  });

  test('handles history file with missing Cids key', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    loadOldPosts();

    expect(_getProcessedCids().size).toBe(0);
  });
});

describe('savePosts', () => {
  test('writes processedCids to history file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ Cids: ['a', 'b'] }));
    loadOldPosts();

    savePosts();

    expect(mockWriteFileSync).toHaveBeenCalledWith('history.json', expect.any(String), 'utf8');

    const writtenData = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(writtenData.Cids).toEqual(expect.arrayContaining(['a', 'b']));
    expect(writtenData.Cids).toHaveLength(2);
  });

  test('handles write errors gracefully', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => savePosts()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sendMediaToChat
// ---------------------------------------------------------------------------
describe('sendMediaToChat', () => {
  const caption = 'Test caption';
  const replyMarkup = { inline_keyboard: [[{ text: 'View', url: 'https://test.app' }]] };

  test('sends photo for image type', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://img.com/pic.jpg', caption, replyMarkup, false, 'image');

    expect(bot.telegram.sendPhoto).toHaveBeenCalledWith('chat1', 'https://img.com/pic.jpg', {
      parse_mode: 'HTML',
      caption,
      has_spoiler: false,
      reply_markup: replyMarkup,
    });
  });

  test('sends video for video type', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://vid.com/clip.mp4', caption, replyMarkup, false, 'video');

    expect(bot.telegram.sendVideo).toHaveBeenCalledWith('chat1', 'https://vid.com/clip.mp4', {
      parse_mode: 'HTML',
      caption,
      has_spoiler: false,
      reply_markup: replyMarkup,
    });
  });

  test('sends audio for audio type', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://snd.com/song.mp3', caption, replyMarkup, false, 'audio');

    expect(bot.telegram.sendAudio).toHaveBeenCalledWith('chat1', 'https://snd.com/song.mp3', {
      parse_mode: 'HTML',
      caption,
      reply_markup: replyMarkup,
    });
  });

  test('sends animation for animation type', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://img.com/anim.gif', caption, replyMarkup, false, 'animation');

    expect(bot.telegram.sendAnimation).toHaveBeenCalledWith('chat1', 'https://img.com/anim.gif', {
      parse_mode: 'HTML',
      caption,
      has_spoiler: false,
      reply_markup: replyMarkup,
    });
  });

  test('sends message with link for embeddable without spoiler', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://youtube.com/watch?v=abc', caption, replyMarkup, false, 'embeddable');

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', `${caption}\n\n🔗 https://youtube.com/watch?v=abc`, { parse_mode: 'HTML', reply_markup: replyMarkup });
  });

  test('tries sendVideo for embeddable with spoiler, falls back to message', async () => {
    const bot = makeMockBot();
    bot.telegram.sendVideo.mockRejectedValueOnce(new Error('unsupported'));

    await sendMediaToChat(bot, 'chat1', 'https://youtube.com/watch?v=abc', caption, replyMarkup, true, 'embeddable');

    expect(bot.telegram.sendVideo).toHaveBeenCalled();
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', expect.stringContaining('<tg-spoiler>'), expect.objectContaining({ parse_mode: 'HTML' }));
  });

  test('sends plain message with link for null media type', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://example.com/file', caption, replyMarkup, false, null);

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', `${caption}\n\n🔗 https://example.com/file`, { parse_mode: 'HTML', reply_markup: replyMarkup });
  });

  test('falls back to plain message when sendPhoto fails', async () => {
    const bot = makeMockBot();
    bot.telegram.sendPhoto.mockRejectedValueOnce(new Error('file too large'));

    await sendMediaToChat(bot, 'chat1', 'https://img.com/huge.jpg', caption, replyMarkup, false, 'image');

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', expect.stringContaining('🖼️'), expect.objectContaining({ parse_mode: 'HTML' }));
  });

  test('falls back to plain message when sendAnimation fails', async () => {
    const bot = makeMockBot();
    bot.telegram.sendAnimation.mockRejectedValueOnce(new Error('bad gateway'));

    await sendMediaToChat(bot, 'chat1', 'https://img.com/anim.gif', caption, replyMarkup, false, 'animation');

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', expect.stringContaining('🎞️'), expect.objectContaining({ parse_mode: 'HTML' }));
  });

  test('Twitter video: falls back to message with link when sendVideo fails', async () => {
    const bot = makeMockBot();
    bot.telegram.sendVideo.mockRejectedValueOnce(new Error('video too large'));

    await sendMediaToChat(bot, 'chat1', 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/abc.mp4', caption, replyMarkup, false, 'video');

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      'chat1',
      expect.stringContaining('Video attachment (click to view)'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
  });

  test('non-Twitter video: falls back to emoji message when sendVideo fails', async () => {
    const bot = makeMockBot();
    bot.telegram.sendVideo.mockRejectedValueOnce(new Error('video too large'));

    await sendMediaToChat(bot, 'chat1', 'https://example.com/clip.mp4', caption, replyMarkup, false, 'video');

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('chat1', expect.stringContaining('🎥'), expect.objectContaining({ parse_mode: 'HTML' }));
  });

  test('passes hasSpoiler flag to sendPhoto', async () => {
    const bot = makeMockBot();
    await sendMediaToChat(bot, 'chat1', 'https://img.com/nsfw.jpg', caption, replyMarkup, true, 'image');

    expect(bot.telegram.sendPhoto).toHaveBeenCalledWith('chat1', expect.any(String), expect.objectContaining({ has_spoiler: true }));
  });

  test('embeddable without spoiler falls back to sendPhoto when sendMessage fails', async () => {
    const bot = makeMockBot();
    bot.telegram.sendMessage.mockRejectedValueOnce(new Error('bad request'));

    await sendMediaToChat(bot, 'chat1', 'https://youtube.com/watch?v=abc', caption, replyMarkup, false, 'embeddable');

    expect(bot.telegram.sendPhoto).toHaveBeenCalledWith('chat1', 'https://youtube.com/watch?v=abc', expect.objectContaining({ parse_mode: 'HTML', has_spoiler: false }));
  });
});

// ---------------------------------------------------------------------------
// fetchCommunities
// ---------------------------------------------------------------------------
describe('fetchCommunities', () => {
  test('fetches and parses communities successfully', async () => {
    const communities: CommunityInfo[] = [
      { address: 'a.eth', title: 'A' },
      { address: 'b.eth', title: 'B' },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ communities }),
    });

    const config = makeMockConfig();
    (config.parseCommunities as any).mockReturnValue(communities);

    const result = await fetchCommunities(config);
    expect(result).toEqual(communities);
    expect(mockFetch).toHaveBeenCalledWith(config.listUrl);
  });

  test('returns empty array on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await fetchCommunities(makeMockConfig());
    expect(result).toEqual([]);
  });

  test('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchCommunities(makeMockConfig());
    expect(result).toEqual([]);
  });

  test('filters NSFW communities when filterNsfw is true', async () => {
    const communities: CommunityInfo[] = [{ address: 'safe.eth', safeForWork: true }, { address: 'nsfw.eth', safeForWork: false }, { address: 'unknown.eth' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ communities }),
    });

    const config = makeMockConfig({ filterNsfw: true });
    (config.parseCommunities as any).mockReturnValue(communities);

    const result = await fetchCommunities(config);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.address)).toEqual(['safe.eth', 'unknown.eth']);
  });

  test('does not filter when filterNsfw is false', async () => {
    const communities: CommunityInfo[] = [
      { address: 'safe.eth', safeForWork: true },
      { address: 'nsfw.eth', safeForWork: false },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ communities }),
    });

    const config = makeMockConfig({ filterNsfw: false });
    (config.parseCommunities as any).mockReturnValue(communities);

    const result = await fetchCommunities(config);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// startFeedBot env validation
// ---------------------------------------------------------------------------
describe('startFeedBot', () => {
  test('throws if neither FEED_BOT_CHAT nor FEED_BOT_GROUP is set', async () => {
    process.env.BOT_TOKEN = 'test-token';
    const bot = makeMockBot();

    await expect(startFeedBot(bot, makeMockConfig())).rejects.toThrow('At least one of FEED_BOT_CHAT or FEED_BOT_GROUP must be set');
  });

  test('throws if BOT_TOKEN is not set', async () => {
    process.env.FEED_BOT_CHAT = '-100111';
    const bot = makeMockBot();

    await expect(startFeedBot(bot, makeMockConfig())).rejects.toThrow('BOT_TOKEN not set');
  });
});

// ---------------------------------------------------------------------------
// _resetState
// ---------------------------------------------------------------------------
describe('_resetState', () => {
  test('clears processedCids', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ Cids: ['a', 'b'] }));
    loadOldPosts();
    expect(_getProcessedCids().size).toBe(2);

    _resetState();
    expect(_getProcessedCids().size).toBe(0);
  });
});
