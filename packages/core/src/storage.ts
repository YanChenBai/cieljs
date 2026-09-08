import { resolve, dirname, join, sep } from 'node:path';
import { platform } from 'node:process';

import type { DefineCielOptions } from './types.ts';

export function investigationStorage(options: DefineCielOptions) {
  return (
    options.investigation ?? {
      dataDir: join(dirname(resolve(options.session.dataDir)), 'investigation'),
    }
  );
}

function storageIdentity(dataDir: string) {
  const identity = resolve(dataDir);

  return platform === 'win32' ? identity.toLocaleLowerCase('en-US') : identity;
}

export function assertDistinctStorage(options: DefineCielOptions) {
  const paths = [
    storageIdentity(options.session.dataDir),
    storageIdentity(options.memory.dataDir),
    storageIdentity(investigationStorage(options).dataDir),
  ];

  if (
    paths.some((path, index) =>
      paths.some(
        (other, otherIndex) =>
          index !== otherIndex && (path === other || path.startsWith(`${other}${sep}`)),
      ),
    )
  ) {
    throw new Error('Session、Memory 与 Investigation 必须使用不同的 dataDir');
  }
}
