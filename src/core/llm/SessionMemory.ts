/**
 * Session Memory - Tracks evolution history to improve creativity
 *
 * This class maintains a memory of recently generated shaders and their characteristics
 * to help the LLM avoid repetition and be more creative.
 */

export interface MemoryEntry {
  timestamp: number;
  shaderSource: string;
  changelog?: string;
  type: 'mutation' | 'mashup';
  parentInfo: string; // Brief description of the parent(s)
}

export class SessionMemory {
  private static readonly STORAGE_KEY = 'shader-evolution-memory';
  private static readonly MAX_ENTRIES = 50; // Keep last 50 shaders
  private static readonly MAX_AGE_MS = 1000 * 60 * 60 * 2; // 2 hours

  private entries: MemoryEntry[] = [];

  constructor() {
    this.loadFromStorage();
    this.pruneOldEntries();
  }

  /**
   * Add a new shader to memory
   */
  public addEntry(entry: Omit<MemoryEntry, 'timestamp'>): void {
    const fullEntry: MemoryEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    // Keep only the most recent entries
    if (this.entries.length > SessionMemory.MAX_ENTRIES) {
      this.entries = this.entries.slice(-SessionMemory.MAX_ENTRIES);
    }

    this.saveToStorage();
  }

  /**
   * Get recent entries for context
   */
  public getRecentEntries(count: number = 10): MemoryEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get a summary of recent shaders for the LLM prompt
   */
  public getMemorySummary(maxEntries: number = 10): string {
    const recent = this.getRecentEntries(maxEntries);

    if (recent.length === 0) {
      return "No previous evolution history in this session.";
    }

    const summaries = recent.map((entry, index) => {
      const timeAgo = this.formatTimeAgo(Date.now() - entry.timestamp);
      const changelogPreview = entry.changelog
        ? entry.changelog.substring(0, 100) + (entry.changelog.length > 100 ? '...' : '')
        : 'No changelog';

      return `${index + 1}. [${timeAgo} ago, ${entry.type}] ${entry.parentInfo}\n   Changes: ${changelogPreview}`;
    }).join('\n');

    return `RECENT EVOLUTION HISTORY (last ${recent.length} shaders):\n${summaries}\n\nIMPORTANT: Look at what's been tried recently and explore DIFFERENT directions. Be creative and avoid repeating similar patterns or techniques.`;
  }

  /**
   * Clear all memory
   */
  public clear(): void {
    this.entries = [];
    this.saveToStorage();
  }

  /**
   * Get the current number of entries
   */
  public getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Remove entries older than MAX_AGE_MS
   */
  private pruneOldEntries(): void {
    const cutoff = Date.now() - SessionMemory.MAX_AGE_MS;
    const originalLength = this.entries.length;
    this.entries = this.entries.filter(entry => entry.timestamp > cutoff);

    if (this.entries.length < originalLength) {
      console.log(`Pruned ${originalLength - this.entries.length} old memory entries`);
      this.saveToStorage();
    }
  }

  /**
   * Load memory from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(SessionMemory.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
          console.log(`Loaded ${this.entries.length} memory entries from storage`);
        }
      }
    } catch (error) {
      console.warn('Failed to load memory from storage:', error);
      this.entries = [];
    }
  }

  /**
   * Save memory to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(SessionMemory.STORAGE_KEY, JSON.stringify(this.entries));
    } catch (error) {
      console.warn('Failed to save memory to storage:', error);
      // If localStorage is full, try to make space by removing oldest entries
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.log('Storage quota exceeded, removing oldest entries...');
        this.entries = this.entries.slice(-Math.floor(SessionMemory.MAX_ENTRIES / 2));
        try {
          localStorage.setItem(SessionMemory.STORAGE_KEY, JSON.stringify(this.entries));
        } catch (retryError) {
          console.error('Still failed to save after cleanup:', retryError);
        }
      }
    }
  }

  /**
   * Format milliseconds into a human-readable time ago string
   */
  private formatTimeAgo(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }
}
