import { getShortAddress } from '@plebbit/plebbit-js';
import type { BotConfig, CommunityInfo } from './types.js';

const fiveChanFeed: BotConfig = {
  name: '5chan-feed',
  clientName: '5chan',
  clientBaseUrl: 'https://5chan.app',
  listUrl: 'https://raw.githubusercontent.com/bitsocialnet/lists/master/5chan-directories.json',

  parseCommunities(data: any): CommunityInfo[] {
    if (!data?.directories || !Array.isArray(data.directories)) {
      return [];
    }
    return data.directories.map((d: any) => ({
      address: d.communityAddress,
      title: d.title,
      directoryCode: d.directoryCode,
      safeForWork: d.features?.safeForWork ?? true,
    }));
  },

  getPostUrl(community: CommunityInfo, cid: string): string {
    const board = community.directoryCode || getShortAddress(community.address);
    return `${this.clientBaseUrl}/#/${board}/thread/${cid}`;
  },

  getPostButtons(community: CommunityInfo, cid: string) {
    return [{ text: 'View on 5chan', url: this.getPostUrl(community, cid) }];
  },

  getCommunityLabel(community: CommunityInfo): string {
    if (community.directoryCode) {
      return `/${community.directoryCode}/`;
    }
    return `p/${getShortAddress(community.address)}`;
  },

  filterNsfw: true,
};

export const botConfigs: Record<string, BotConfig> = {
  '5chan-feed': fiveChanFeed,
};

export function getBotConfig(name: string): BotConfig {
  const config = botConfigs[name];
  if (!config) {
    const available = Object.keys(botConfigs).join(', ');
    throw new Error(`Unknown bot "${name}". Available bots: ${available}`);
  }
  return config;
}
