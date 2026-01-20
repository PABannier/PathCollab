import type { CachedTile, TileBounds } from '../hooks/useTissueOverlay'
import type { TissueOverlayMetadata } from '../types/overlay'

/** Tile with index metadata for spatial queries */
export interface IndexedTile {
  tile: CachedTile
  gridCells: Set<number> // Which grid cells this tile overlaps
}

/** Result from fallback lookup */
export interface FallbackResult {
  tile: CachedTile
  /** Texture coordinates for the portion of the fallback tile to sample */
  texCoords: {
    u0: number
    v0: number
    u1: number
    v1: number
  }
}

/** Viewport bounds in slide coordinates */
export interface ViewportBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const GRID_SIZE = 64 // 64x64 grid for spatial indexing

/**
 * Spatial index for O(k) viewport queries instead of O(n) full iteration.
 * Uses a fixed 64x64 grid that maps to full-resolution slide coordinates.
 */
export class TissueTileIndex {
  private grid: Map<number, Set<IndexedTile>> = new Map()
  private tilesByKey: Map<string, IndexedTile> = new Map()
  private tilesByLevel: Map<number, IndexedTile[]> = new Map()
  private cellWidth: number
  private cellHeight: number

  constructor(_metadata: TissueOverlayMetadata, slideWidth: number, slideHeight: number) {
    this.cellWidth = slideWidth / GRID_SIZE
    this.cellHeight = slideHeight / GRID_SIZE
  }

  /** Generate tile key for lookups */
  private tileKey(level: number, x: number, y: number): string {
    return `${level}-${x}-${y}`
  }

  /** Convert row/col to grid cell index */
  private cellToIndex(row: number, col: number): number {
    return row * GRID_SIZE + col
  }

  /** Get all grid cells that a bounding box overlaps */
  private getOverlappingCells(bounds: TileBounds): Set<number> {
    const cells = new Set<number>()

    const startCol = Math.max(0, Math.floor(bounds.left / this.cellWidth))
    const endCol = Math.min(GRID_SIZE - 1, Math.floor(bounds.right / this.cellWidth))
    const startRow = Math.max(0, Math.floor(bounds.top / this.cellHeight))
    const endRow = Math.min(GRID_SIZE - 1, Math.floor(bounds.bottom / this.cellHeight))

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        cells.add(this.cellToIndex(row, col))
      }
    }

    return cells
  }

  /** Add a tile to the index */
  addTile(tile: CachedTile): IndexedTile {
    const key = this.tileKey(tile.level, tile.x, tile.y)

    // Check if already indexed
    const existing = this.tilesByKey.get(key)
    if (existing) {
      return existing
    }

    // Get grid cells this tile overlaps
    const gridCells = this.getOverlappingCells(tile.bounds)

    const indexedTile: IndexedTile = {
      tile,
      gridCells,
    }

    // Add to key lookup
    this.tilesByKey.set(key, indexedTile)

    // Add to level lookup
    let levelTiles = this.tilesByLevel.get(tile.level)
    if (!levelTiles) {
      levelTiles = []
      this.tilesByLevel.set(tile.level, levelTiles)
    }
    levelTiles.push(indexedTile)

    // Add to grid cells
    for (const cellIndex of gridCells) {
      let cellSet = this.grid.get(cellIndex)
      if (!cellSet) {
        cellSet = new Set()
        this.grid.set(cellIndex, cellSet)
      }
      cellSet.add(indexedTile)
    }

    return indexedTile
  }

  /** Query tiles at a specific level that overlap the viewport */
  queryViewport(level: number, viewportBounds: ViewportBounds): IndexedTile[] {
    const viewportCells = this.getOverlappingCells({
      left: viewportBounds.left,
      top: viewportBounds.top,
      right: viewportBounds.right,
      bottom: viewportBounds.bottom,
    })

    const result: IndexedTile[] = []
    const seen = new Set<string>()

    for (const cellIndex of viewportCells) {
      const cellTiles = this.grid.get(cellIndex)
      if (!cellTiles) continue

      for (const indexedTile of cellTiles) {
        if (indexedTile.tile.level !== level) continue

        const key = this.tileKey(indexedTile.tile.level, indexedTile.tile.x, indexedTile.tile.y)
        if (seen.has(key)) continue
        seen.add(key)

        // Verify actual intersection (grid cells are coarse)
        const bounds = indexedTile.tile.bounds
        if (
          bounds.right > viewportBounds.left &&
          bounds.left < viewportBounds.right &&
          bounds.bottom > viewportBounds.top &&
          bounds.top < viewportBounds.bottom
        ) {
          result.push(indexedTile)
        }
      }
    }

    return result
  }

  /**
   * Find a fallback tile from a coarser level that covers the target area.
   * Returns the tile and texture coordinates for the portion to sample.
   */
  findFallback(
    targetLevel: number,
    _targetX: number,
    _targetY: number,
    targetBounds: TileBounds
  ): FallbackResult | null {
    // Search coarser levels (lower level numbers = coarser)
    for (let level = targetLevel - 1; level >= 0; level--) {
      const levelTiles = this.tilesByLevel.get(level)
      if (!levelTiles) continue

      for (const indexedTile of levelTiles) {
        const tile = indexedTile.tile
        const bounds = tile.bounds

        // Check if this tile fully covers the target area
        if (
          bounds.left <= targetBounds.left &&
          bounds.right >= targetBounds.right &&
          bounds.top <= targetBounds.top &&
          bounds.bottom >= targetBounds.bottom
        ) {
          // Calculate texture coordinates for the portion to sample
          const tileWidth = bounds.right - bounds.left
          const tileHeight = bounds.bottom - bounds.top

          const u0 = (targetBounds.left - bounds.left) / tileWidth
          const v0 = (targetBounds.top - bounds.top) / tileHeight
          const u1 = (targetBounds.right - bounds.left) / tileWidth
          const v1 = (targetBounds.bottom - bounds.top) / tileHeight

          return {
            tile,
            texCoords: { u0, v0, u1, v1 },
          }
        }
      }
    }

    return null
  }

  /** Get a tile by its key */
  getTile(level: number, x: number, y: number): IndexedTile | undefined {
    return this.tilesByKey.get(this.tileKey(level, x, y))
  }

  /** Check if a tile exists in the index */
  hasTile(level: number, x: number, y: number): boolean {
    return this.tilesByKey.has(this.tileKey(level, x, y))
  }

  /** Get all tiles at a specific level */
  getTilesAtLevel(level: number): IndexedTile[] {
    return this.tilesByLevel.get(level) ?? []
  }

  /** Clear all indexed tiles */
  clear(): void {
    this.grid.clear()
    this.tilesByKey.clear()
    this.tilesByLevel.clear()
  }

  /** Get number of indexed tiles */
  get size(): number {
    return this.tilesByKey.size
  }
}
