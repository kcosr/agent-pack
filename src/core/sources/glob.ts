export const fileGlobOptions = {
  onlyFiles: true,
  dot: true,
  unique: true,
  followSymbolicLinks: false,
} as const;

export function displayGlobMatch(match: string): string {
  return `./${match.replace(/^\.\//, "")}`;
}

export function hasGlobMagic(ref: string): boolean {
  return /[*?[\]{}()!+@]/.test(ref);
}
