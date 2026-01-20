export interface Point {
  x: number
  y: number
}

export interface CellMask {
  cell_id: number
  cell_type: string
  confidence: number
  coordinates: Point[]
  centroid: Point
}

export interface CellsInRegionResponse {
  cells: CellMask[]
  total_count: number
  region: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface OverlayMetadata {
  id: string
  slide_id: string
  mpp: number
  cell_count: number
  cell_types: string[]
  cell_model_name: string
  tissue_model_name: string
}
