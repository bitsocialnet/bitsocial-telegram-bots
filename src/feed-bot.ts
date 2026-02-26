import * as fs from "fs";
import { Scenes, Telegraf } from "telegraf";
import { log, plebbit } from "./index.js";
import fetch from "node-fetch";
import PQueue from "p-queue";
import { getShortAddress } from "@plebbit/plebbit-js";
import type { BotConfig, CommunityInfo } from "./types.js";

const queue = new PQueue({ concurrency: 1 });
const historyCidsFile = "history.json";
let processedCids: Set<string> = new Set();

let isShuttingDown = false;

export function setShuttingDown(value: boolean) {
  isShuttingDown = value;
}

function getMediaTypeFromUrl(
  url: string,
): "image" | "video" | "audio" | "animation" | "embeddable" | null {
  try {
    const parsedUrl = new URL(url);

    if (isEmbeddablePlatform(parsedUrl)) {
      return "embeddable";
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    const extensionMatch = pathname.match(/\.([^.]+)$/);

    if (extensionMatch) {
      const extension = extensionMatch[1];

      const imageExtensions = ["jpg", "jpeg", "png", "webp", "bmp", "tiff"];
      const videoExtensions = ["mp4", "webm", "avi", "mov", "mkv", "m4v", "3gp", "gifv"];
      const audioExtensions = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"];
      const animationExtensions = ["gif"];

      if (imageExtensions.includes(extension)) return "image";
      if (videoExtensions.includes(extension)) return "video";
      if (audioExtensions.includes(extension)) return "audio";
      if (animationExtensions.includes(extension)) return "animation";
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

function isTwitterVideoUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === "video.twimg.com" && parsedUrl.pathname.includes(".mp4");
  } catch {
    return false;
  }
}

function isEmbeddablePlatform(parsedUrl: URL): boolean {
  const embeddableDomains = [
    "youtube.com",
    "m.youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "mobile.twitter.com",
    "tiktok.com",
    "m.tiktok.com",
    "instagram.com",
    "m.instagram.com",
    "twitch.tv",
    "m.twitch.tv",
    "reddit.com",
    "m.reddit.com",
    "odysee.com",
    "bitchute.com",
    "streamable.com",
    "spotify.com",
    "soundcloud.com",
  ];

  const hostname = parsedUrl.hostname;

  for (const domain of embeddableDomains) {
    if (hostname === domain) return true;
    if (hostname.endsWith(`.${domain}`) && hostname.split(".").length > domain.split(".").length)
      return true;
  }

  return hostname.startsWith("yt.") && parsedUrl.searchParams.has("v");
}

async function sendMediaToChat(
  tgBotInstance: Telegraf<Scenes.WizardContext>,
  chatId: string,
  url: string,
  caption: string,
  replyMarkup: any,
  hasSpoiler: boolean,
  mediaType: "image" | "video" | "audio" | "animation" | "embeddable" | null,
): Promise<void> {
  try {
    switch (mediaType) {
      case "image":
        await tgBotInstance.telegram.sendPhoto(chatId, url, {
          parse_mode: "HTML",
          caption,
          has_spoiler: hasSpoiler,
          reply_markup: replyMarkup,
        });
        break;

      case "video":
        try {
          await tgBotInstance.telegram.sendVideo(chatId, url, {
            parse_mode: "HTML",
            caption,
            has_spoiler: hasSpoiler,
            reply_markup: replyMarkup,
          });
        } catch (videoError) {
          if (isTwitterVideoUrl(url)) {
            try {
              await tgBotInstance.telegram.sendMessage(
                chatId,
                `${caption}\n\n🎥 <i>Video attachment (click to view):</i> ${url}`,
                {
                  parse_mode: "HTML",
                  reply_markup: replyMarkup,
                },
              );
              return;
            } catch {
              // fall through to rethrow
            }
          }
          throw videoError;
        }
        break;

      case "audio":
        await tgBotInstance.telegram.sendAudio(chatId, url, {
          parse_mode: "HTML",
          caption,
          reply_markup: replyMarkup,
        });
        break;

      case "animation":
        await tgBotInstance.telegram.sendAnimation(chatId, url, {
          parse_mode: "HTML",
          caption,
          has_spoiler: hasSpoiler,
          reply_markup: replyMarkup,
        });
        break;

      case "embeddable":
        if (hasSpoiler) {
          try {
            await tgBotInstance.telegram.sendVideo(chatId, url, {
              parse_mode: "HTML",
              caption,
              has_spoiler: true,
              reply_markup: replyMarkup,
            });
          } catch {
            await tgBotInstance.telegram.sendMessage(
              chatId,
              `${caption}\n\n🔗 <tg-spoiler>${url}</tg-spoiler>`,
              {
                parse_mode: "HTML",
                reply_markup: replyMarkup,
              },
            );
          }
        } else {
          try {
            await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🔗 ${url}`, {
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            });
          } catch {
            await tgBotInstance.telegram.sendPhoto(chatId, url, {
              parse_mode: "HTML",
              caption,
              has_spoiler: false,
              reply_markup: replyMarkup,
            });
          }
        }
        break;

      default:
        await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n🔗 ${url}`, {
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        });
        break;
    }
  } catch (error) {
    const mediaEmoji =
      mediaType === "video"
        ? "🎥"
        : mediaType === "image"
          ? "🖼️"
          : mediaType === "audio"
            ? "🎵"
            : mediaType === "animation"
              ? "🎞️"
              : "🔗";

    await tgBotInstance.telegram.sendMessage(chatId, `${caption}\n\n${mediaEmoji} ${url}`, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/<spoiler>(.*?)<\/spoiler>/g, "||$1||")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncatePost(
  title: string,
  content: string,
  maxLength: number,
): { title: string; content: string } {
  if (title.length + content.length <= maxLength) return { title, content };

  if (title.length > maxLength) {
    return {
      title: title.substring(0, maxLength - 3) + "...",
      content: content.substring(0, maxLength) + "...",
    };
  }

  const remaining = maxLength - title.length;
  return {
    title,
    content: content.substring(0, remaining - 3) + "...",
  };
}

async function scrollPosts(
  community: CommunityInfo,
  tgBotInstance: Telegraf<Scenes.WizardContext>,
  plebbitInstance: any,
  subInstance: any,
  config: BotConfig,
) {
  const address = community.address;
  try {
    let posts: any[] = [];

    try {
      if (subInstance.posts?.pageCids?.new) {
        const newPage = await subInstance.posts.getPage(subInstance.posts.pageCids.new);
        posts = newPage.comments || [];
        if (posts.length > 10) {
          log.info(
            `Loaded ${posts.length} posts from 'new' page for ${config.getCommunityLabel(community)}`,
          );
        }
      } else if (subInstance.posts?.pages?.hot?.comments) {
        posts = subInstance.posts.pages.hot.comments;
        if (posts.length > 10) {
          log.info(
            `Using ${posts.length} preloaded posts from 'hot' page for ${config.getCommunityLabel(community)}`,
          );
        }
      } else {
        log.warn(
          `No posts pages available for ${config.getCommunityLabel(community)}, falling back to manual traversal`,
        );
        let currentPostCid = subInstance.lastPostCid;
        let counter = 0;
        while (currentPostCid && counter < 20) {
          counter += 1;
          const post = await plebbitInstance.getComment(currentPostCid);
          posts.push(post);
          currentPostCid = post.previousCid;
        }
      }
    } catch (pageError) {
      log.warn(
        `Error loading posts page for ${config.getCommunityLabel(community)}, falling back to manual traversal:`,
        pageError,
      );
      let currentPostCid = subInstance.lastPostCid;
      let counter = 0;
      while (currentPostCid && counter < 20) {
        counter += 1;
        const post = await plebbitInstance.getComment(currentPostCid);
        posts.push(post);
        currentPostCid = post.previousCid;
      }
    }

    for (const newPost of posts.slice(0, 20)) {
      if (newPost.cid && !processedCids.has(newPost.cid)) {
        const comment = await plebbitInstance.createComment({ cid: newPost.cid });
        await comment.update();

        await Promise.race([
          new Promise<void>((resolve) => {
            const updateListener = () => {
              if (typeof comment.updatedAt === "number") {
                comment.removeListener("update", updateListener);
                resolve();
              }
            };
            comment.on("update", updateListener);
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

        const currentTime = Math.floor(Date.now() / 1000);
        const maxAge = 2 * 24 * 60 * 60;
        if (currentTime - newPost.timestamp > maxAge) continue;
        if (newPost.deleted) continue;

        let title = escapeHtml(newPost.title || "");
        let content = escapeHtml(newPost.content || "");
        ({ title, content } = truncatePost(title, content, 900));

        const communityLabel = config.getCommunityLabel(community);
        const spoilerTag = newPost.spoiler ? "[SPOILER]" : newPost.nsfw ? "[NSFW]" : "";
        const captionMessage = `<b>${title ? title + " " : ""}${spoilerTag}</b>\n${content}\n\nPosted on <b>${communityLabel}</b> by ${getShortAddress(newPost.author.address)}`;

        const chatIds = getChatIds();
        const buttons = config.getPostButtons(community, newPost.cid);
        const replyMarkup = {
          inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))],
        };

        if (newPost.link) {
          await queue.add(async () => {
            const mediaType = getMediaTypeFromUrl(newPost.link);

            const sendPromises = chatIds.map((chatId) =>
              sendMediaToChat(
                tgBotInstance,
                chatId,
                newPost.link,
                captionMessage,
                replyMarkup,
                newPost.spoiler || newPost.nsfw,
                mediaType,
              ).catch((error: any) => {
                log.error(`Error sending media to ${chatId}:`, error);
                return false;
              }),
            );

            const results = await Promise.allSettled(sendPromises);
            const hasSuccessfulSend = results.some(
              (r) => r.status === "fulfilled" && r.value !== false,
            );

            if (newPost.cid && hasSuccessfulSend) {
              processedCids.add(newPost.cid);
              savePosts();
            }
          });
        } else {
          await queue.add(async () => {
            const sendPromises = chatIds.map((chatId) =>
              tgBotInstance.telegram
                .sendMessage(chatId, captionMessage, {
                  parse_mode: "HTML",
                  reply_markup: replyMarkup,
                })
                .catch((error: any) => {
                  log.error(`Error sending message to ${chatId}:`, error);
                  return false;
                }),
            );

            const results = await Promise.allSettled(sendPromises);
            const hasSuccessfulSend = results.some(
              (r) => r.status === "fulfilled" && r.value !== false,
            );

            if (newPost.cid && hasSuccessfulSend) {
              processedCids.add(newPost.cid);
              savePosts();
            }
          });
        }

        log.info(`📩 New post: "${title || "No title"}" on ${communityLabel}`);
      }
    }
  } catch (e) {
    log.error(
      `Error in scrollPosts for ${config.getCommunityLabel(community)}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

function getChatIds(): string[] {
  const chatIds: string[] = [];
  if (process.env.FEED_BOT_CHAT) chatIds.push(process.env.FEED_BOT_CHAT);
  if (process.env.FEED_BOT_GROUP) chatIds.push(process.env.FEED_BOT_GROUP);
  return chatIds;
}

function loadOldPosts() {
  try {
    const data = fs.readFileSync(historyCidsFile, "utf8");
    const parsedData = JSON.parse(data);
    const loadedCids = parsedData.Cids || [];
    processedCids = new Set(loadedCids);
    log.info(`Loaded ${loadedCids.length} previously processed post CIDs from history`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      log.info("No history file found, starting with empty history");
    } else {
      log.warn(
        "Could not load history file, starting with empty history:",
        error instanceof Error ? error.message : String(error),
      );
    }
    processedCids = new Set();
  }
}

function savePosts() {
  try {
    const dataToSave = { Cids: Array.from(processedCids) };
    fs.writeFileSync(historyCidsFile, JSON.stringify(dataToSave, null, 2), "utf8");
  } catch (error) {
    log.error("Error saving history file:", error instanceof Error ? error.message : String(error));
  }
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
    log.error(
      "Error fetching communities:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

export async function startFeedBot(
  tgBotInstance: Telegraf<Scenes.WizardContext>,
  config: BotConfig,
) {
  log.info(`Starting ${config.name} feed bot (${config.clientName})`);

  if (!process.env.FEED_BOT_CHAT && !process.env.FEED_BOT_GROUP) {
    throw new Error("At least one of FEED_BOT_CHAT or FEED_BOT_GROUP must be set");
  }

  if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN not set");
  }

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

    loadOldPosts();
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

            const subInstance: any = await Promise.race([
              plebbit.getSubplebbit(community.address),
              new Promise((_, reject) => {
                setTimeout(
                  () => reject(new Error("Operation timed out after 5 minutes")),
                  5 * 60 * 1000,
                );
              }),
            ]);

            if (isShuttingDown) return { postsFound: 0 };

            if (subInstance.address) {
              const postsBefore = processedCids.size;
              await Promise.race([
                scrollPosts(community, tgBotInstance, plebbit, subInstance, config),
                new Promise((_, reject) => {
                  setTimeout(
                    () =>
                      reject(new Error(`Timed out after 6 minutes of post crawling on ${label}`)),
                    6 * 60 * 1000,
                  );
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

            const isIPNSError = e instanceof Error && e.message.includes("Failed to resolve IPNS");
            const logInterval = isIPNSError ? 15 * 60 * 1000 : SUB_ERROR_LOG_INTERVAL;

            if (now - errorInfo.lastLogged > logInterval) {
              errorInfo.lastLogged = now;

              if (isIPNSError && errorInfo.count === 1) {
                log.warn(`Community ${label} offline (IPNS resolution failed)`);
              } else if (!isIPNSError) {
                log.error(
                  `Error processing ${label}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
            subErrorCounts.set(errorKey, errorInfo);
            return { postsFound: 0 };
          }
        }),
      );

      batchResults.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
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

    log.info("Waiting 30 seconds before next cycle...");
    const CYCLE_DELAY = 30 * 1000;
    const delayChunks = 6;
    const chunkDelay = CYCLE_DELAY / delayChunks;

    for (let i = 0; i < delayChunks && !isShuttingDown; i++) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelay));
    }
  }

  clearInterval(cleanupInterval);
  log.info("Bot feed processing stopped due to shutdown signal");
}
