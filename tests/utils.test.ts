import { describe, test, expect } from 'vitest';
import { getMediaTypeFromUrl, isTwitterVideoUrl, isEmbeddablePlatform, escapeHtml, truncatePost } from '../src/utils.js';

describe('getMediaTypeFromUrl', () => {
  describe('image extensions', () => {
    test.each(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'])("returns 'image' for .%s", (ext) => {
      expect(getMediaTypeFromUrl(`https://example.com/photo.${ext}`)).toBe('image');
    });
  });

  describe('video extensions', () => {
    test.each(['mp4', 'webm', 'avi', 'mov', 'mkv', 'm4v', '3gp', 'gifv'])("returns 'video' for .%s", (ext) => {
      expect(getMediaTypeFromUrl(`https://example.com/video.${ext}`)).toBe('video');
    });
  });

  describe('audio extensions', () => {
    test.each(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'])("returns 'audio' for .%s", (ext) => {
      expect(getMediaTypeFromUrl(`https://example.com/audio.${ext}`)).toBe('audio');
    });
  });

  test("returns 'animation' for .gif", () => {
    expect(getMediaTypeFromUrl('https://example.com/funny.gif')).toBe('animation');
  });

  describe('embeddable platforms', () => {
    test.each([
      ['https://youtube.com/watch?v=abc', 'youtube.com'],
      ['https://youtu.be/abc', 'youtu.be'],
      ['https://twitter.com/user/status/123', 'twitter.com'],
      ['https://x.com/user/status/123', 'x.com'],
      ['https://tiktok.com/@user/video/123', 'tiktok.com'],
      ['https://instagram.com/p/abc', 'instagram.com'],
      ['https://twitch.tv/user', 'twitch.tv'],
      ['https://reddit.com/r/test/comments/abc', 'reddit.com'],
      ['https://odysee.com/@user/video', 'odysee.com'],
      ['https://bitchute.com/video/abc', 'bitchute.com'],
      ['https://streamable.com/abc', 'streamable.com'],
      ['https://spotify.com/track/abc', 'spotify.com'],
      ['https://soundcloud.com/artist/track', 'soundcloud.com'],
    ])("returns 'embeddable' for %s (%s)", (url) => {
      expect(getMediaTypeFromUrl(url)).toBe('embeddable');
    });
  });

  test('returns null for unknown extension', () => {
    expect(getMediaTypeFromUrl('https://example.com/file.xyz')).toBeNull();
  });

  test('returns null for URL with no extension', () => {
    expect(getMediaTypeFromUrl('https://example.com/page')).toBeNull();
  });

  test('returns null for invalid URL', () => {
    expect(getMediaTypeFromUrl('not a url')).toBeNull();
  });

  test('handles URLs with query parameters', () => {
    expect(getMediaTypeFromUrl('https://example.com/photo.jpg?width=800')).toBe('image');
  });

  test('handles URLs with fragments', () => {
    expect(getMediaTypeFromUrl('https://example.com/video.mp4#t=10')).toBe('video');
  });

  test('handles case-insensitive extensions via pathname lowercase', () => {
    expect(getMediaTypeFromUrl('https://example.com/PHOTO.JPG')).toBe('image');
  });

  test('embeddable takes precedence over file extension', () => {
    expect(getMediaTypeFromUrl('https://youtube.com/video.mp4')).toBe('embeddable');
  });

  test('returns null for empty string', () => {
    expect(getMediaTypeFromUrl('')).toBeNull();
  });
});

describe('isTwitterVideoUrl', () => {
  test('returns true for video.twimg.com with .mp4 path', () => {
    expect(isTwitterVideoUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/abc.mp4')).toBe(true);
  });

  test('returns false for regular twitter.com URL', () => {
    expect(isTwitterVideoUrl('https://twitter.com/user/status/123')).toBe(false);
  });

  test('returns false for video.twimg.com without .mp4', () => {
    expect(isTwitterVideoUrl('https://video.twimg.com/tweet_video_thumb/abc.jpg')).toBe(false);
  });

  test('returns false for invalid URL', () => {
    expect(isTwitterVideoUrl('not a url')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isTwitterVideoUrl('')).toBe(false);
  });
});

describe('isEmbeddablePlatform', () => {
  test.each([
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'twitter.com',
    'x.com',
    'mobile.twitter.com',
    'tiktok.com',
    'm.tiktok.com',
    'instagram.com',
    'm.instagram.com',
    'twitch.tv',
    'm.twitch.tv',
    'reddit.com',
    'm.reddit.com',
    'odysee.com',
    'bitchute.com',
    'streamable.com',
    'spotify.com',
    'soundcloud.com',
  ])('matches %s', (domain) => {
    expect(isEmbeddablePlatform(new URL(`https://${domain}/path`))).toBe(true);
  });

  test('matches subdomains like www.youtube.com', () => {
    expect(isEmbeddablePlatform(new URL('https://www.youtube.com/watch?v=abc'))).toBe(true);
  });

  test('matches yt.* domain with ?v= parameter', () => {
    expect(isEmbeddablePlatform(new URL('https://yt.be/path?v=abc123'))).toBe(true);
  });

  test('does not match yt.* domain without ?v= parameter', () => {
    expect(isEmbeddablePlatform(new URL('https://yt.be/path'))).toBe(false);
  });

  test('does not match unknown domains', () => {
    expect(isEmbeddablePlatform(new URL('https://example.com/path'))).toBe(false);
  });

  test('does not match partial domain matches', () => {
    expect(isEmbeddablePlatform(new URL('https://notyoutube.com/path'))).toBe(false);
  });
});

describe('escapeHtml', () => {
  test('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('escapes < to &lt;', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  test('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  test('converts spoiler tags to ||...|| before escaping', () => {
    expect(escapeHtml('<spoiler>secret</spoiler>')).toBe('||secret||');
  });

  test('handles mixed content with spoilers and HTML entities', () => {
    expect(escapeHtml('Check <spoiler>this & that</spoiler> out!')).toBe('Check ||this &amp; that|| out!');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('handles string with no special characters', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  test('handles multiple special characters in sequence', () => {
    expect(escapeHtml('<>&')).toBe('&lt;&gt;&amp;');
  });

  test('handles multiple spoiler tags', () => {
    expect(escapeHtml('<spoiler>a</spoiler> and <spoiler>b</spoiler>')).toBe('||a|| and ||b||');
  });
});

describe('truncatePost', () => {
  test('returns unchanged when total length is within limit', () => {
    expect(truncatePost('title', 'content', 100)).toEqual({
      title: 'title',
      content: 'content',
    });
  });

  test('returns unchanged when total length equals limit exactly', () => {
    expect(truncatePost('abc', 'de', 5)).toEqual({
      title: 'abc',
      content: 'de',
    });
  });

  test('truncates content when total exceeds limit', () => {
    const result = truncatePost('title', 'this is a very long content string', 20);
    expect(result.title).toBe('title');
    expect(result.content).toMatch(/\.\.\.$/);
    expect(result.title.length + result.content.length).toBeLessThanOrEqual(20);
  });

  test('truncates both title and content when title alone exceeds limit', () => {
    const result = truncatePost('a very long title that exceeds the limit', 'some content', 10);
    expect(result.title).toMatch(/\.\.\.$/);
    expect(result.title.length).toBe(10);
    expect(result.content).toMatch(/\.\.\.$/);
  });

  test('handles empty title', () => {
    expect(truncatePost('', 'content', 100)).toEqual({
      title: '',
      content: 'content',
    });
  });

  test('handles empty content', () => {
    expect(truncatePost('title', '', 100)).toEqual({
      title: 'title',
      content: '',
    });
  });

  test('handles both empty', () => {
    expect(truncatePost('', '', 100)).toEqual({ title: '', content: '' });
  });

  test('content truncation preserves title intact', () => {
    const result = truncatePost('My Title', 'A'.repeat(1000), 20);
    expect(result.title).toBe('My Title');
    expect(result.content.endsWith('...')).toBe(true);
  });
});
