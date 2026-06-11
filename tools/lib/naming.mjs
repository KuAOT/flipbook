export function pad(n) {
  return String(n).padStart(4, '0');
}

export function pageFilename(n) {
  return `${pad(n)}.jpg`;
}
