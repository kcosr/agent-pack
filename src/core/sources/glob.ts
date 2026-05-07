export function hasGlobMagic(ref: string): boolean {
  return /[*?[\]{}()!+@]/.test(ref);
}
