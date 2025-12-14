import { BuildChunkArtifact, BuildChunkAsset } from '@core/types/plan';

export interface BuildStats {
  timestamp: string;
  duration: number;
  chunks: {
    total: number;
    shared: number;
    entry: number;
    dynamic: number;
  };
  size: {
    code: number;
    map: number;
    assets: number;
    total: number;
  };
  modules: {
    total: number;
    js: number;
    css: number;
    assets: number;
  };
  cacheHits: number;
  cacheMisses: number;
}

export interface ChunkStats {
  id: string;
  isEntry: boolean;
  isShared: boolean;
  size: number;
  modules: number;
  assets: number;
  imports: string[];
  exports: string[];
}

export class BuildAnalyzer {
  private startTime: number;
  private stats: BuildStats;
  private chunkStats: Map<string, ChunkStats>;
  private cacheStats: {hits: number; misses: number};

  constructor() {
    this.startTime = Date.now();
    this.stats = this.createEmptyStats();
    this.chunkStats = new Map();
    this.cacheStats = {hits: 0, misses: 0};
  }

  private createEmptyStats(): BuildStats {
    return {
      timestamp: new Date().toISOString(),
      duration: 0,
      chunks: {
        total: 0,
        shared: 0,
        entry: 0,
        dynamic: 0
      },
      size: {
        code: 0,
        map: 0,
        assets: 0,
        total: 0
      },
      modules: {
        total: 0,
        js: 0,
        css: 0,
        assets: 0
      },
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  recordChunk(artifact: BuildChunkArtifact, isEntry: boolean, isShared: boolean) {
    // Update chunk counts
    this.stats.chunks.total++;
    if (isEntry) this.stats.chunks.entry++;
    if (isShared) this.stats.chunks.shared++;
    if (artifact.id.includes('::dyn')) this.stats.chunks.dynamic++;

    // Update size stats
    this.stats.size.code += artifact.code_bytes; // Match the Rust-generated property name
    this.stats.size.map += artifact.map_bytes;   // Match the Rust-generated property name
    this.stats.size.assets += artifact.assets.reduce((sum: number, asset: BuildChunkAsset) => sum + asset.source.length, 0);
    
    // Record individual chunk stats
    this.chunkStats.set(artifact.id, {
      id: artifact.id,
      isEntry,
      isShared,
      size: artifact.code_bytes + artifact.map_bytes,
      modules: 0, // Will be updated when modules are processed
      assets: artifact.assets.length,
      imports: [], // Will be populated during dependency analysis
      exports: []  // Will be populated during export analysis
    });
  }

  recordCacheEvent(hit: boolean) {
    if (hit) {
      this.stats.cacheHits++;
      this.cacheStats.hits++;
    } else {
      this.stats.cacheMisses++;
      this.cacheStats.misses++;
    }
  }

  finalize(): BuildStats {
    this.stats.duration = Date.now() - this.startTime;
    this.stats.size.total = 
      this.stats.size.code + 
      this.stats.size.map + 
      this.stats.size.assets;

    return this.stats;
  }

  getChunkStats(): ChunkStats[] {
    return Array.from(this.chunkStats.values());
  }

  getCacheEfficiency(): number {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total === 0 ? 0 : (this.cacheStats.hits / total) * 100;
  }
}