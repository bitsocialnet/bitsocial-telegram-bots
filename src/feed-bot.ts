import * as fs from 'node:fs';
import { Scenes, Telegraf } from 'telegraf';
import { log, pkc } from './index.js';
import fetch from 'node-fetch';
import PQueue from 'p-queue';
import { getShortAddress } from '@pkcprotocol/pkc-js';
import type { BotConfig, CommunityInfo } from './types.js';
import { getMediaTypeFromUrl, isTwitterVideoUrl, escapeHtml, truncatePost } from './utils.js';

const queue = new PQueue({ concurrency: 1 });
const historyCidsFile = 'history.json';
const historyTempFile = `${historyCidsFile}.tmp`;
// Delivery history, persisted as history.json `Cids`. A bare post CID means the post reached every chat.
// `${chatId}:${cid}` means it reached that chat while a send to another chat failed; the other chats are
// retried on later cycles, and the entries collapse into the bare CID once every chat has the post.
let processedCids: Set<string> = new Set();

let isShuttingDown = false;

export function setShuttingDown(value: boolean) {
  isShuttingDown = value;
}

// Resolves when the send queue is idle, i.e. a send already in flight has finished and been recorded in
// history.json, or after timeoutMs. Call after setShuttingDown(true): queued sends then start no new send.
export async function waitForPendingSends(timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([queue.onIdle(), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}

export async function sendMediaToChat(
  tgBotInstance: Telegraf<Scenes.WizardContext>,
  chatId: string,
  url: string,
  caption: string,
  replyMarkup: any,
  hasSpoiler: boolean,
  mediaType: 'image' | 'video' | 'audio' | 'animation' | 'embeddable' | null,
): Promise<void> {
  try {
    switch (mediaType) {
      case 'image':
        await tgBotInstance.telegram.sendPhoto(chatId, url, {
          parse_mode: 'HTML',
          caption,
          has_spoiler: hasSpoiler,
          reply_markup: replyMarkup,
        });
        break;

      case 'video':
        try {
          await tgBotInstance.telegram.sendVideo(chatId, url, {
            parse_mode: 'HTML',
            caption,
            has_spoiler: hasSpoiler,
            reply_markup: replyMarkup,
          });
        } catch (videoError) {
          if (isTwitterVideoUrl(url)) {
            try {
              await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🎥 <i>Video attachment (click to view):</i> ${url}`, {
                parse_mode: 'HTML',
                reply_markup: replyMarkup,
              });
              return;
            } catch {
              // fall through to rethrow
            }
          }
          throw videoError;
        }
        break;

      case 'audio':
        await tgBotInstance.telegram.sendAudio(chatId, url, {
          parse_mode: 'HTML',
          caption,
          reply_markup: replyMarkup,
        });
        break;

      case 'animation':
        await tgBotInstance.telegram.sendAnimation(chatId, url, {
          parse_mode: 'HTML',
          caption,
          has_spoiler: hasSpoiler,
          reply_markup: replyMarkup,
        });
        break;

      case 'embeddable':
        if (hasSpoiler) {
          try {
            await tgBotInstance.telegram.sendVideo(chatId, url, {
              parse_mode: 'HTML',
              caption,
              has_spoiler: true,
              reply_markup: replyMarkup,
            });
          } catch {
            await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🔗 <tg-spoiler>${url}</tg-spoiler>`, {
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            });
          }
        } else {
          try {
            await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🔗 ${url}`, {
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            });
          } catch {
            await tgBotInstance.telegram.sendPhoto(chatId, url, {
              parse_mode: 'HTML',
              caption,
              has_spoiler: false,
              reply_markup: replyMarkup,
            });
          }
        }
        break;

      default:
        await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🔗 ${url}`, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
        break;
    }
  } catch (error) {
    const mediaEmoji = mediaType === 'video' ? '🎥' : mediaType === 'image' ? '🖼️' : mediaType === 'audio' ? '🎵' : mediaType === 'animation' ? '🎞️' : '🔗';

    await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n${mediaEmoji} ${url}`, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }
}

async function scrollPosts(community: CommunityInfo, tgBotInstance: Telegraf<Scenes.WizardContext>, pkcInstance: any, communityInstance: any, config: BotConfig) {
  const address = community.address;
  try {
    let posts: any[] = [];

    try {
      if (communityInstance.posts?.pageCids?.new) {
        const newPage = await communityInstance.posts.getPage(communityInstance.posts.pageCids.new);
        posts = newPage.comments || [];
        if (posts.length > 10) {
          log.info(`Loaded ${posts.length} posts from 'new' page for ${config.getCommunityLabel(community)}`);
        }
      } else if (communityInstance.posts?.pages?.hot?.comments) {
        posts = communityInstance.posts.pages.hot.comments;
        if (posts.length > 10) {
          log.info(`Using ${posts.length} preloaded posts from 'hot' page for ${config.getCommunityLabel(community)}`);
        }
      } else {
        log.warn(`No posts pages available for ${config.getCommunityLabel(community)}, falling back to manual traversal`);
        let currentPostCid = communityInstance.lastPostCid;
        let counter = 0;
        while (currentPostCid && counter < 20) {
          counter += 1;
          const post = await pkcInstance.getComment({ cid: currentPostCid });
          posts.push(post);
          currentPostCid = post.previousCid;
        }
      }
    } catch (pageError) {
      log.warn(`Error loading posts page for ${config.getCommunityLabel(community)}, falling back to manual traversal:`, pageError);
      let currentPostCid = communityInstance.lastPostCid;
      let counter = 0;
      while (currentPostCid && counter < 20) {
        counter += 1;
        const post = await pkcInstance.getComment({ cid: currentPostCid });
        posts.push(post);
        currentPostCid = post.previousCid;
      }
    }

    for (const newPost of posts.slice(0, 20)) {
      if (newPost.cid && getUndeliveredChatIds(newPost.cid).length > 0) {
        // Age and deletion come from the page data. Check them before subscribing to comment updates,
        // otherwise every old post in the first 20 is re-verified over the network on every cycle.
        const currentTime = Math.floor(Date.now() / 1000);
        const maxAge = 2 * 24 * 60 * 60;
        if (currentTime - newPost.timestamp > maxAge) continue;
        if (newPost.deleted) continue;

        const comment = await pkcInstance.createComment({ cid: newPost.cid });
        await comment.update();

        await Promise.race([
          new Promise<void>((resolve) => {
            const updateListener = () => {
              if (typeof comment.updatedAt === 'number') {
                comment.removeListener('update', updateListener);
                resolve();
              }
            };
            comment.on('update', updateListener);
          }),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 10000);
          }),
        ]);

        const isRemoved = comment.removed === true;
        if (isRemoved) {
          await comment.stop();
          continue;
        }
        await comment.stop();

        let title = escapeHtml(newPost.title || '');
        let content = escapeHtml(newPost.content || '');
        ({ title, content } = truncatePost(title, content, 900));

        const communityLabel = config.getCommunityLabel(community);
        const spoilerTag = newPost.spoiler ? '[SPOILER]' : newPost.nsfw ? '[NSFW]' : '';
        const captionMessage = `<b>${title ? title + ' ' : ''}${spoilerTag}</b>\n${content}\n\nPosted on <b>${communityLabel}</b> by ${getShortAddress({ name: newPost.author.address })}`;

        const buttons = config.getPostButtons(community, newPost.cid);
        const replyMarkup = {
          inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))],
        };

        // Each queued task picks its chats when it runs. The queue runs one task at a time, and a crawl abandoned
        // by the 6-minute timeout keeps running, so another crawl may have sent this post since the check above.
        // No new send starts once shutdown has begun (see waitForPendingSends).
        if (newPost.link) {
          await queue.add(async () => {
            const chatIds = getUndeliveredChatIds(newPost.cid);
            if (isShuttingDown || chatIds.length === 0) return;
            const mediaType = getMediaTypeFromUrl(newPost.link);

            const sendPromises = chatIds.map((chatId) =>
              sendMediaToChat(tgBotInstance, chatId, newPost.link, captionMessage, replyMarkup, newPost.spoiler || newPost.nsfw, mediaType).catch((error: any) => {
                log.error(`Error sending media to ${chatId}:`, error);
                return false;
              }),
            );

            const results = await Promise.allSettled(sendPromises);
            const deliveredChatIds = chatIds.filter((_, i) => {
              const result = results[i];
              return result.status === 'fulfilled' && result.value !== false;
            });
            recordDelivery(newPost.cid, deliveredChatIds);
          });
        } else {
          await queue.add(async () => {
            const chatIds = getUndeliveredChatIds(newPost.cid);
            if (isShuttingDown || chatIds.length === 0) return;
            const sendPromises = chatIds.map((chatId) =>
              tgBotInstance.telegram
                .sendMessage(chatId, captionMessage, {
                  parse_mode: 'HTML',
                  reply_markup: replyMarkup,
                })
                .catch((error: any) => {
                  log.error(`Error sending message to ${chatId}:`, error);
                  return false;
                }),
            );

            const results = await Promise.allSettled(sendPromises);
            const deliveredChatIds = chatIds.filter((_, i) => {
              const result = results[i];
              return result.status === 'fulfilled' && result.value !== false;
            });
            recordDelivery(newPost.cid, deliveredChatIds);
          });
        }

        log.info(`📩 New post: "${title || 'No title'}" on ${communityLabel}`);
      }
    }
  } catch (e) {
    log.error(`Error in scrollPosts for ${config.getCommunityLabel(community)}:`, e instanceof Error ? e.message : String(e));
  }
}

export function getChatIds(): string[] {
  const chatIds: string[] = [];
  if (process.env.FEED_BOT_CHAT) chatIds.push(process.env.FEED_BOT_CHAT);
  if (process.env.FEED_BOT_GROUP) chatIds.push(process.env.FEED_BOT_GROUP);
  return chatIds;
}

function getUndeliveredChatIds(cid: string): string[] {
  if (processedCids.has(cid)) return [];
  return getChatIds().filter((chatId) => !processedCids.has(`${chatId}:${cid}`));
}

function recordDelivery(cid: string, deliveredChatIds: string[]) {
  if (deliveredChatIds.length === 0) return;
  for (const chatId of deliveredChatIds) processedCids.add(`${chatId}:${cid}`);
  const chatIds = getChatIds();
  if (chatIds.every((chatId) => processedCids.has(`${chatId}:${cid}`))) {
    for (const chatId of chatIds) processedCids.delete(`${chatId}:${cid}`);
    processedCids.add(cid);
  }
  savePosts();
}

export function loadOldPosts() {
  try {
    const data = fs.readFileSync(historyCidsFile, 'utf8');
    const parsedData = JSON.parse(data);
    const loadedCids = parsedData.Cids || [];
    processedCids = new Set(loadedCids);
    log.info(`Loaded ${loadedCids.length} previously processed post CIDs from history`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      log.info('No history file found, starting with empty history');
    } else {
      log.warn('Could not load history file, starting with empty history:', error instanceof Error ? error.message : String(error));
    }
    processedCids = new Set();
  }
}

export function savePosts() {
  try {
    const dataToSave = { Cids: Array.from(processedCids) };
    // Write a temp file and rename it over history.json, so a failed or interrupted write (ENOSPC, crash)
    // keeps the previous history instead of leaving a truncated file that loads as empty.
    fs.writeFileSync(historyTempFile, JSON.stringify(dataToSave, null, 2), 'utf8');
    fs.renameSync(historyTempFile, historyCidsFile);
  } catch (error) {
    log.error('Error saving history file:', error instanceof Error ? error.message : String(error));
  }
}

export function _getProcessedCids(): Set<string> {
  return processedCids;
}

export function _resetState(): void {
  processedCids = new Set();
  isShuttingDown = false;
}

export async function fetchCommunities(config: BotConfig): Promise<CommunityInfo[]> {
  try {
    const response = await fetch(config.listUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch community list: ${response.status}`);
    }
    const data: any = await response.json();
    let communities = config.parseCommunities(data);

    if (config.filterNsfw) {
      communities = communities.filter((c) => c.safeForWork !== false);
    }

    return communities;
  } catch (error) {
    log.error('Error fetching communities:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

export async function startFeedBot(tgBotInstance: Telegraf<Scenes.WizardContext>, config: BotConfig) {
  log.info(`Starting ${config.name} feed bot (${config.clientName})`);

  if (!process.env.FEED_BOT_CHAT && !process.env.FEED_BOT_GROUP) {
    throw new Error('At least one of FEED_BOT_CHAT or FEED_BOT_GROUP must be set');
  }

  if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN not set');
  }

  // Load once. While running, the in-memory set is authoritative: reloading it from disk would drop
  // posts sent after a failed save and send them again.
  loadOldPosts();

  const subErrorCounts = new Map<string, { count: number; lastLogged: number }>();
  const SUB_ERROR_LOG_INTERVAL = 300000;
  const SUB_ERROR_CLEANUP_INTERVAL = 3600000;
  const SUB_ERROR_RETENTION_TIME = 7200000;

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of subErrorCounts.entries()) {
      if (now - value.lastLogged > SUB_ERROR_RETENTION_TIME) {
        subErrorCounts.delete(key);
      }
    }
  }, SUB_ERROR_CLEANUP_INTERVAL);

  let cycleCount = 0;

  while (!isShuttingDown) {
    cycleCount++;
    const cycleStartTime = Date.now();

    log.info(`Starting cycle ${cycleCount} with ${processedCids.size} processed posts`);

    const communities = await fetchCommunities(config);
    log.info(`Fetched ${communities.length} communities to process`);

    if (isShuttingDown) break;

    const batchSize = 5;
    let processedCount = 0;
    let newPostsFound = 0;

    for (let i = 0; i < communities.length; i += batchSize) {
      if (isShuttingDown) break;

      const batch = communities.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (community: CommunityInfo, batchIndex: number) => {
          const globalIndex = i + batchIndex + 1;
          const label = config.getCommunityLabel(community);
          log.info(`Processing: (${globalIndex}/${communities.length}) ${label}`);
          processedCount++;
          try {
            if (isShuttingDown) return { postsFound: 0 };

            const communityInstance: any = await Promise.race([
              pkc.getCommunity({ address: community.address }),
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Operation timed out after 5 minutes')), 5 * 60 * 1000);
              }),
            ]);

            if (isShuttingDown) return { postsFound: 0 };

            if (communityInstance.address) {
              const postsBefore = processedCids.size;
              await Promise.race([
                scrollPosts(community, tgBotInstance, pkc, communityInstance, config),
                new Promise((_, reject) => {
                  setTimeout(() => reject(new Error(`Timed out after 6 minutes of post crawling on ${label}`)), 6 * 60 * 1000);
                }),
              ]);
              return { postsFound: processedCids.size - postsBefore };
            }
            return { postsFound: 0 };
          } catch (e) {
            const errorKey = `${community.address}:${e instanceof Error ? e.message : String(e)}`;
            const now = Date.now();
            const errorInfo = subErrorCounts.get(errorKey) || { count: 0, lastLogged: 0 };

            errorInfo.count++;

            const isIPNSError = e instanceof Error && e.message.includes('Failed to resolve IPNS');
            const logInterval = isIPNSError ? 15 * 60 * 1000 : SUB_ERROR_LOG_INTERVAL;

            if (now - errorInfo.lastLogged > logInterval) {
              errorInfo.lastLogged = now;

              if (isIPNSError && errorInfo.count === 1) {
                log.warn(`Community ${label} offline (IPNS resolution failed)`);
              } else if (!isIPNSError) {
                log.error(`Error processing ${label}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            subErrorCounts.set(errorKey, errorInfo);
            return { postsFound: 0 };
          }
        }),
      );

      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          newPostsFound += result.value.postsFound || 0;
        }
      });

      if (i + batchSize < communities.length && !isShuttingDown) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (isShuttingDown) break;

    savePosts();

    const cycleDuration = Date.now() - cycleStartTime;
    log.info(
      `Cycle ${cycleCount} completed: ${processedCount}/${communities.length} communities processed, ${newPostsFound} new posts found (${Math.round(cycleDuration / 1000)}s)`,
    );

    log.info('Waiting 30 seconds before next cycle...');
    const CYCLE_DELAY = 30 * 1000;
    const delayChunks = 6;
    const chunkDelay = CYCLE_DELAY / delayChunks;

    for (let i = 0; i < delayChunks && !isShuttingDown; i++) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelay));
    }
  }

  clearInterval(cleanupInterval);
  log.info('Bot feed processing stopped due to shutdown signal');
}
