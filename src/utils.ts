export function getMediaTypeFromUrl(url: string): 'image' | 'video' | 'audio' | 'animation' | 'embeddable' | null {
  try {
    const parsedUrl = new URL(url);

    if (isEmbeddablePlatform(parsedUrl)) {
      return 'embeddable';
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    const extensionMatch = pathname.match(/\.([^.]+)$/);

    if (extensionMatch) {
      const extension = extensionMatch[1];

      const imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'];
      const videoExtensions = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'm4v', '3gp', 'gifv'];
      const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'];
      const animationExtensions = ['gif'];

      if (imageExtensions.includes(extension)) return 'image';
      if (videoExtensions.includes(extension)) return 'video';
      if (audioExtensions.includes(extension)) return 'audio';
      if (animationExtensions.includes(extension)) return 'animation';
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

export function isTwitterVideoUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === 'video.twimg.com' && parsedUrl.pathname.includes('.mp4');
  } catch {
    return false;
  }
}

export function isEmbeddablePlatform(parsedUrl: URL): boolean {
  const embeddableDomains = [
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
  ];

  const hostname = parsedUrl.hostname;

  for (const domain of embeddableDomains) {
    if (hostname === domain) return true;
    if (hostname.endsWith(`.${domain}`) && hostname.split('.').length > domain.split('.').length) return true;
  }

  return hostname.startsWith('yt.') && parsedUrl.searchParams.has('v');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/<spoiler>(.*?)<\/spoiler>/g, '||$1||')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function truncatePost(title: string, content: string, maxLength: number): { title: string; content: string } {
  if (title.length + content.length <= maxLength) return { title, content };

  if (title.length > maxLength) {
    return {
      title: title.substring(0, maxLength - 3) + '...',
      content: content.substring(0, maxLength) + '...',
    };
  }

  const remaining = maxLength - title.length;
  return {
    title,
    content: content.substring(0, remaining - 3) + '...',
  };
}
