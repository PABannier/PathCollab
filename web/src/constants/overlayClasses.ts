/**
 * Default overlay class definitions for cell and tissue classification.
 *
 * These are fallback values used when the overlay manifest doesn't provide
 * class definitions. Ideally, class names and colors should come from the
 * manifest's protobuf definition to support custom domain-specific models.
 */

/** Cell class definition for polygon overlays */
export interface CellClass {
  id: number
  name: string
  color: string
}

/** Tissue class definition for heatmap overlays */
export interface TissueClass {
  id: number
  name: string
  color: string
}

/** Default cell classes (15 types) */
export const DEFAULT_CELL_CLASSES: CellClass[] = [
  { id: 0, name: 'Tumor', color: '#DC2626' },
  { id: 1, name: 'Stroma', color: '#EA580C' },
  { id: 2, name: 'Immune', color: '#CA8A04' },
  { id: 3, name: 'Necrosis', color: '#16A34A' },
  { id: 4, name: 'Other', color: '#0D9488' },
  { id: 5, name: 'Class 5', color: '#0891B2' },
  { id: 6, name: 'Class 6', color: '#2563EB' },
  { id: 7, name: 'Class 7', color: '#7C3AED' },
  { id: 8, name: 'Class 8', color: '#C026D3' },
  { id: 9, name: 'Class 9', color: '#DB2777' },
  { id: 10, name: 'Class 10', color: '#84CC16' },
  { id: 11, name: 'Class 11', color: '#06B6D4' },
  { id: 12, name: 'Class 12', color: '#8B5CF6' },
  { id: 13, name: 'Class 13', color: '#F43F5E' },
  { id: 14, name: 'Class 14', color: '#64748B' },
]

/** Default tissue classes (8 types) */
export const DEFAULT_TISSUE_CLASSES: TissueClass[] = [
  { id: 0, name: 'Tumor', color: '#EF4444' },
  { id: 1, name: 'Stroma', color: '#F59E0B' },
  { id: 2, name: 'Necrosis', color: '#6B7280' },
  { id: 3, name: 'Lymphocytes', color: '#3B82F6' },
  { id: 4, name: 'Mucus', color: '#A855F7' },
  { id: 5, name: 'Smooth Muscle', color: '#EC4899' },
  { id: 6, name: 'Adipose', color: '#FBBF24' },
  { id: 7, name: 'Background', color: '#E5E7EB' },
]
