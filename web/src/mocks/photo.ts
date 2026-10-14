// Stand-in pet photos: a flat colour with a paw, so fixtures need no image files.
export function mockPhoto(background: string, foreground = '#ffffff'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${background}"/><g fill="${foreground}" opacity="0.85"><ellipse cx="200" cy="245" rx="62" ry="52"/><ellipse cx="118" cy="178" rx="26" ry="34"/><ellipse cx="170" cy="128" rx="26" ry="36"/><ellipse cx="230" cy="128" rx="26" ry="36"/><ellipse cx="282" cy="178" rx="26" ry="34"/></g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
