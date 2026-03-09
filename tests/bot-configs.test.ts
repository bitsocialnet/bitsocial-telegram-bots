import { describe, test, expect, vi } from 'vitest';

vi.mock('@plebbit/plebbit-js', () => ({
  getShortAddress: vi.fn((addr: string) => `${addr.slice(0, 12)}...`),
}));

import { botConfigs, getBotConfig } from '../src/bot-configs.js';
import type { CommunityInfo } from '../src/types.js';

const fiveChanConfig = botConfigs['5chan-feed'];

describe('getBotConfig', () => {
  test('returns config for valid bot name', () => {
    const config = getBotConfig('5chan-feed');
    expect(config).toBeDefined();
    expect(config.name).toBe('5chan-feed');
  });

  test('throws for unknown bot name', () => {
    expect(() => getBotConfig('nonexistent')).toThrow('Unknown bot "nonexistent"');
  });

  test('error message includes available bots', () => {
    expect(() => getBotConfig('bad')).toThrow('Available bots: 5chan-feed');
  });
});

describe('5chan-feed config', () => {
  test('has correct name and client info', () => {
    expect(fiveChanConfig.name).toBe('5chan-feed');
    expect(fiveChanConfig.clientName).toBe('5chan');
    expect(fiveChanConfig.clientBaseUrl).toBe('https://5chan.app');
  });

  test('has correct list URL pointing to bitsocialnet/lists', () => {
    expect(fiveChanConfig.listUrl).toContain('bitsocialnet/lists');
    expect(fiveChanConfig.listUrl).toContain('5chan-directories.json');
  });

  test('has filterNsfw enabled', () => {
    expect(fiveChanConfig.filterNsfw).toBe(true);
  });

  describe('parseCommunities', () => {
    test('parses valid directory data', () => {
      const data = {
        directories: [
          {
            communityAddress: 'news.eth',
            title: 'News',
            directoryCode: 'n',
            features: { safeForWork: true },
          },
          {
            communityAddress: 'tech.eth',
            title: 'Technology',
            directoryCode: 'g',
            features: { safeForWork: false },
          },
        ],
      };

      const result = fiveChanConfig.parseCommunities(data);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        address: 'news.eth',
        title: 'News',
        directoryCode: 'n',
        safeForWork: true,
      });
      expect(result[1]).toEqual({
        address: 'tech.eth',
        title: 'Technology',
        directoryCode: 'g',
        safeForWork: false,
      });
    });

    test('returns empty array for null data', () => {
      expect(fiveChanConfig.parseCommunities(null)).toEqual([]);
    });

    test('returns empty array for undefined data', () => {
      expect(fiveChanConfig.parseCommunities(undefined)).toEqual([]);
    });

    test('returns empty array when directories is missing', () => {
      expect(fiveChanConfig.parseCommunities({})).toEqual([]);
    });

    test('returns empty array when directories is not an array', () => {
      expect(fiveChanConfig.parseCommunities({ directories: 'invalid' })).toEqual([]);
    });

    test('defaults safeForWork to true when features.safeForWork is undefined', () => {
      const data = {
        directories: [{ communityAddress: 'test.eth', title: 'Test', directoryCode: 't' }],
      };
      const result = fiveChanConfig.parseCommunities(data);
      expect(result[0].safeForWork).toBe(true);
    });

    test('defaults safeForWork to true when features is missing', () => {
      const data = {
        directories: [{ communityAddress: 'test.eth' }],
      };
      const result = fiveChanConfig.parseCommunities(data);
      expect(result[0].safeForWork).toBe(true);
    });

    test('maps all fields correctly', () => {
      const data = {
        directories: [
          {
            communityAddress: 'addr.eth',
            title: 'My Community',
            directoryCode: 'mc',
            features: { safeForWork: false },
          },
        ],
      };
      const result = fiveChanConfig.parseCommunities(data);
      expect(result[0]).toEqual({
        address: 'addr.eth',
        title: 'My Community',
        directoryCode: 'mc',
        safeForWork: false,
      });
    });
  });

  describe('getPostUrl', () => {
    test('uses directoryCode when present', () => {
      const community: CommunityInfo = {
        address: 'news.eth',
        directoryCode: 'n',
      };
      const url = fiveChanConfig.getPostUrl(community, 'QmAbc123');
      expect(url).toBe('https://5chan.app/#/n/thread/QmAbc123');
    });

    test('falls back to short address when no directoryCode', () => {
      const community: CommunityInfo = { address: 'some-long-address.eth' };
      const url = fiveChanConfig.getPostUrl(community, 'QmAbc123');
      expect(url).toContain('https://5chan.app/#/');
      expect(url).toContain('/thread/QmAbc123');
    });

    test('includes the CID in the URL', () => {
      const community: CommunityInfo = { address: 'test.eth', directoryCode: 't' };
      const cid = 'QmXyz789';
      expect(fiveChanConfig.getPostUrl(community, cid)).toContain(cid);
    });
  });

  describe('getPostButtons', () => {
    test("returns a single button with 'View on 5chan'", () => {
      const community: CommunityInfo = { address: 'test.eth', directoryCode: 't' };
      const buttons = fiveChanConfig.getPostButtons(community, 'QmAbc123');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].text).toBe('View on 5chan');
    });

    test('button URL matches getPostUrl output', () => {
      const community: CommunityInfo = { address: 'test.eth', directoryCode: 't' };
      const cid = 'QmAbc123';
      const buttons = fiveChanConfig.getPostButtons(community, cid);
      expect(buttons[0].url).toBe(fiveChanConfig.getPostUrl(community, cid));
    });
  });

  describe('getCommunityLabel', () => {
    test('returns /code/ format with directoryCode', () => {
      const community: CommunityInfo = { address: 'news.eth', directoryCode: 'n' };
      expect(fiveChanConfig.getCommunityLabel(community)).toBe('/n/');
    });

    test('returns p/shortAddr format without directoryCode', () => {
      const community: CommunityInfo = { address: 'long-address.eth' };
      const label = fiveChanConfig.getCommunityLabel(community);
      expect(label).toMatch(/^p\//);
    });
  });
});
