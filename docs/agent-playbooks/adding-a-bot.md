# Adding a New Bot

## When to Use

When adding a Telegram feed bot for a new Bitsocial client (e.g. Seedit).

## Steps

### 1. Find or Create the Community List

Each client's community list lives in `bitsocialnet/lists` on GitHub. Examples:

- 5chan: `5chan-directories.json`
- Seedit: (needs to be created, e.g. `seedit-communities.json`)

The raw URL format is:
```
https://raw.githubusercontent.com/bitsocialnet/lists/master/<filename>.json
```

### 2. Add a Bot Config

In `src/bot-configs.ts`, add a new `BotConfig` object:

```typescript
const seeditFeed: BotConfig = {
  name: 'seedit-feed',
  clientName: 'Seedit',
  clientBaseUrl: 'https://seedit.app',
  listUrl: 'https://raw.githubusercontent.com/bitsocialnet/lists/master/seedit-communities.json',

  parseCommunities(data: any): CommunityInfo[] {
    // Parse the JSON structure for this client's list
    return data.subplebbits.map((s: any) => ({
      address: s.address,
      title: s.title,
      // ...other fields
    }));
  },

  getPostUrl(community: CommunityInfo, cid: string): string {
    return `${this.clientBaseUrl}/#/p/${community.address}/c/${cid}`;
  },

  getPostButtons(community: CommunityInfo, cid: string) {
    // Only link to this client — never cross-link
    return [{ text: 'View on Seedit', url: this.getPostUrl(community, cid) }];
  },

  getCommunityLabel(community: CommunityInfo): string {
    return `p/${community.title || community.address}`;
  },
};
```

### 3. Register the Config

Add the config to the `botConfigs` map in `src/bot-configs.ts`:

```typescript
export const botConfigs: Record<string, BotConfig> = {
  '5chan-feed': fiveChanFeed,
  'seedit-feed': seeditFeed,
};
```

### 4. Add a Start Script

In `package.json`:

```json
"start:seedit-feed": "BOT_NAME=seedit-feed npx tsx src/index.ts"
```

### 5. Deploy

Each bot needs its own:

- `BOT_TOKEN` (create a separate Telegram bot via @BotFather)
- `BOT_NAME` pointing to the new config name
- `FEED_BOT_CHAT` / `FEED_BOT_GROUP` for its Telegram destination

### 6. Verify

```bash
BOT_NAME=seedit-feed yarn build
```

## Key Constraint

Each bot MUST only link to its own client. Never add buttons or links to other Bitsocial clients.
