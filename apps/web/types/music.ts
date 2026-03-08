export interface SearchResult {
  title: string;
  artist: string;
  url: string;
  cover: string | null;
  trackCount?: number | null;
  service?: string | null;
}

export interface DownloadJob {
  id: string;
  url: string;
  status: string;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error?: string | null;
  trackInfo?: {
    current: number;
    total: number;
    name: string;
  } | null;
  result?: {
    success: boolean;
    albumPath: string;
    album: {
      title: string;
      artist: string;
      tracks: number;
    };
  } | null;
  control?: {
    paused: boolean;
    cancelled: boolean;
  };
}

export interface LibraryAlbum {
  name: string;
  files: string[];
  trackCount: number;
  coverFile: string | null;
  coverUrl: string | null;
}

export interface LibraryArtist {
  name: string;
  albums: LibraryAlbum[];
}

export interface LibraryTrack {
  trackNumber: number | null;
  title: string;
  filename: string;
}

export interface AlbumDetail extends LibraryAlbum {
  artist: string;
  tracks: LibraryTrack[];
}

export interface EnrichedMetadata {
  query: {
    title: string | null;
    artist: string | null;
    album: string | null;
    url: string | null;
  };
  merged: {
    title: string | null;
    artist: string | null;
    album: string | null;
    releaseYear: number | null;
    genres: string[];
    coverArtUrl: string | null;
    sourceIds: Record<string, string | null>;
  };
  sources: Array<{
    source: string;
    status: string;
    message?: string | null;
    data?: any;
  }>;
  enrichedAt: number;
}
