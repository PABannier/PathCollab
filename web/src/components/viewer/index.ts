// FoveaViewer replaces the OpenSeadragon-based SlideViewer. It is exported under
// the SlideViewer name so existing imports (and the SlideViewerHandle contract)
// keep working unchanged.
export { FoveaViewer as SlideViewer, type SlideInfo, type SlideViewerHandle } from './FoveaViewer'
export { CursorLayer } from './CursorLayer'
export { MinimapOverlay } from './MinimapOverlay'
export { ViewportLoader } from './ViewportLoader'
export { ViewerArea, type ViewerAreaProps, type CursorData } from './ViewerArea'
