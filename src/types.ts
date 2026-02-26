export interface CommunityInfo {
  address: string;
  title?: string;
  directoryCode?: string;
  safeForWork?: boolean;
}

export interface BotConfig {
  name: string;
  clientName: string;
  clientBaseUrl: string;
  listUrl: string;
  parseCommunities: (data: any) => CommunityInfo[];
  getPostUrl: (community: CommunityInfo, cid: string) => string;
  getPostButtons: (community: CommunityInfo, cid: string) => { text: string; url: string }[];
  getCommunityLabel: (community: CommunityInfo) => string;
  filterNsfw?: boolean;
}
