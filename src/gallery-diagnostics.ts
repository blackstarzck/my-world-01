// Release builds can retain the separately loaded review panel for deployment
// verification. Normal visits do not load it or enable performance observers.
export const galleryDiagnosticBuild = import.meta.env.DEV || import.meta.env.VITE_GALLERY_DIAGNOSTICS === '1';
export const galleryReviewEnabled = galleryDiagnosticBuild && new URLSearchParams(location.search).get('review') === 'i';
